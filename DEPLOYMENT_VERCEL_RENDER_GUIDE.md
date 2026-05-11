# Deploying `code-eval-hub` with Vercel (web) + Render (RAG)

## Short answer first
- **Yes, same repo is fine** (recommended).
- Keep web app and RAG service in separate folders/services; deploy them independently.
- You can deploy:
  - Next.js app on **Vercel**
  - Python RAG service on **Render**
- You **do not need to split repositories** unless you want separate ownership/release cycles.
- In your current repo, Next app is at root and RAG is in `rag-service/`, which already works for this setup.

---

## Recommended repo structure

Current structure (good):
- Next.js: `/home/runner/work/code-eval-hub/code-eval-hub` (repo root)
- RAG: `/home/runner/work/code-eval-hub/code-eval-hub/rag-service`

If you later move Next into `NEXT/` and RAG into `RAG_SERVICE/`, that is also valid; just set each platform’s **Root Directory** accordingly.

---

## Architecture to use in production

1. Browser talks only to **Vercel Next app**.
2. Next server actions call **Render RAG service** using server-to-server HTTP.
3. RAG service stores vector data in object storage (S3/R2/etc), not local disk.

This avoids browser→RAG direct calls, reduces CORS pain, and keeps keys server-side.

---

## Step-by-step deployment

## 1) Prepare accounts/services

Create/confirm:
- Vercel account
- Render account
- Postgres DB (Neon/Supabase/Render Postgres/etc) for Next app
- Object storage bucket for vector store (AWS S3 or Cloudflare R2 recommended)
- Groq API key
- GitHub token (used by both Next and RAG in this project)

---

## 2) Deploy RAG service to Render

1. In Render: **New + → Web Service**.
2. Connect the same GitHub repo.
3. Set:
   - **Root Directory**: `rag-service`
   - **Runtime**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env vars (full list below in the env table).
5. Deploy.
6. Verify:
   - `GET https://<your-render-service>.onrender.com/` returns `{"message":"API is working"}`.

Notes:
- Render free tier sleeps when idle; first request can be slow (cold start).
- `rag-service` uses temp local path + object storage. Ensure bucket credentials are correct.

---

## 3) Deploy Next app to Vercel

1. In Vercel: **Add New Project**.
2. Import same GitHub repo.
3. Set:
   - **Root Directory**: `.` (repo root, for current layout)
   - Framework: Next.js (auto-detected)
4. Add env vars (full list below).
5. Deploy.

---

## 4) Configure app-to-service connection

In Vercel env:
- `RAG_SERVICE_URL=https://<your-render-service>.onrender.com`

The Next app already reads this in:
- `/home/runner/work/code-eval-hub/code-eval-hub/app/lib/rag-client.ts`

---

## 5) Run DB migrations for production database

After setting `DATABASE_URL` to production DB, run Prisma migrations from a trusted environment:

```bash
npx prisma migrate deploy
```

(Do not skip this; app depends on Prisma schema.)

---

## 6) Smoke test flows

1. Sign up/login
2. Add a repo
3. Trigger ingestion
4. Ask repo chat
5. Generate summary/questions

If ingestion/chat fail, check:
- Vercel logs (server action errors)
- Render logs (RAG endpoint errors)
- Bucket access permissions

---

## Environment variables: exact mapping

## Vercel (Next app)

Required:
- `DATABASE_URL` = your production Postgres connection string
- `GITHUB_TOKEN` = GitHub token for API calls
- `RAG_SERVICE_URL` = Render service base URL (no trailing slash preferred)
- `AUTH_SECRET` = random secret for NextAuth v5

Recommended:
- `AUTH_URL` = your Vercel app URL (e.g., `https://your-app.vercel.app`)
- `AUTH_TRUST_HOST=true`
- `RAG_INTERNAL_API_KEY` = shared secret if you add internal API auth (snippet below)

---

## Render (RAG service)

Required:
- `GROQ_API_KEY`
- `GITHUB_TOKEN`
- `VECTOR_STORE_BUCKET`
- `VECTOR_STORE_PREFIX` (example: `vector-stores`)
- `S3_ENDPOINT_URL` (blank for AWS S3, set for R2/MinIO)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (for R2 often `auto`)

Recommended:
- `RAG_INTERNAL_API_KEY` (same value as Vercel if using internal API auth)
- `ALLOWED_ORIGINS` (if enabling CORS policy snippet)

---

## Do you need proxy/CORS?

## Case A (recommended, current app pattern): Next server calls RAG
- **Proxy not required**.
- **CORS not required for browser** because browser is not calling Render directly.
- Best practice: add service-to-service API key auth.

## Case B (browser directly calls Render)
- You must enable strict CORS in RAG service.
- Avoid this unless necessary.

---

## Code snippets to add (recommended hardening)

## 1) Add internal API key between Vercel and Render

### A. Next side
File: `/home/runner/work/code-eval-hub/code-eval-hub/app/lib/rag-client.ts`

Add header helper and use it in all RAG fetch calls:

```ts
const RAG_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";
const RAG_INTERNAL_API_KEY = process.env.RAG_INTERNAL_API_KEY;

function ragHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (RAG_INTERNAL_API_KEY) {
    headers["x-internal-api-key"] = RAG_INTERNAL_API_KEY;
  }
  return headers;
}
```

Then replace request headers from:

```ts
headers: { "Content-Type": "application/json" }
```

to:

```ts
headers: ragHeaders()
```

in all fetches to `/ingest`, `/chat`, `/summarize`, `/contributor-summary`, `/generate-questions`.

### B. RAG side
File: `/home/runner/work/code-eval-hub/code-eval-hub/rag-service/main.py`

Add near imports:

```py
import os
from fastapi import Header
```

Add helper:

```py
def verify_internal_api_key(x_internal_api_key: str | None):
    expected = os.getenv("RAG_INTERNAL_API_KEY")
    if not expected:
        return
    if x_internal_api_key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")
```

Then in each POST endpoint signature, add header input and check at start:

```py
@app.post("/chat")
def chat_with_repo(data: ChatRequest, x_internal_api_key: str | None = Header(default=None)):
    verify_internal_api_key(x_internal_api_key)
    ...
```

Do same for `/ingest`, `/summarize`, `/contributor-summary`, `/generate-questions`, `/batch-contributor-questions`.

---

## 2) Add CORS only if direct browser access to Render is needed

File: `/home/runner/work/code-eval-hub/code-eval-hub/rag-service/main.py`

```py
import os
from fastapi.middleware.cors import CORSMiddleware

allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
```

Set `ALLOWED_ORIGINS=https://your-app.vercel.app` on Render.

---

## 3) Fail fast if `RAG_SERVICE_URL` missing in production

File: `/home/runner/work/code-eval-hub/code-eval-hub/app/lib/rag-client.ts`

```ts
const RAG_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";

if (process.env.NODE_ENV === "production" && !process.env.RAG_SERVICE_URL) {
  throw new Error("RAG_SERVICE_URL is required in production");
}
```

This prevents silent production calls to localhost.

---

## Red flags / best-practice issues in current project

1. **Unpinned core deps in Next app**
   - `next`, `react`, `react-dom` are set to `latest` in `package.json`.
   - Risk: non-reproducible deploys and sudden breakages.
   - Fix: pin exact versions.

2. **No service-to-service auth between Next and RAG**
   - RAG endpoints are callable publicly if URL is known.
   - Fix: add `RAG_INTERNAL_API_KEY` flow above.

3. **Potential env misconfig hidden by localhost fallback**
   - `RAG_SERVICE_URL` fallback can hide config errors in prod.
   - Fix: fail fast in production.

4. **No explicit CORS policy (if ever called from browser)**
   - Add strict `ALLOWED_ORIGINS` middleware if direct browser access is introduced.

5. **Default README does not document this architecture**
   - Add a deployment section referencing this file.

---

## Should you split the repo?

Only split if you need:
- separate team ownership,
- separate CI pipelines with strict isolation,
- different release cadence.

For your current goal (free Render + free Vercel), **single repo with two services is the best path**.

