# RAG Service — Cloud Storage & Deployment Guide

## Quick answers to common questions

| Question | Answer |
|---|---|
| Do I need Docker? | **No.** Render runs Python directly. Skip Docker entirely for now. |
| Do I need local MinIO? | **No.** Use a free hosted cloud bucket instead. |
| Where to deploy RAG? | **Render** (free tier) |
| Where to deploy Next.js? | **Vercel** (free tier) |
| Where to host the DB? | **Neon** (free PostgreSQL) or Vercel Postgres |
| Where to store FAISS? | **Cloudflare R2** (10 GB free, S3-compatible) |

---

## What is MinIO and why are we skipping it?

MinIO is a self-hosted, S3-compatible object storage server. It is great for running a private S3-style bucket on your own machine or server. However:

- Running it locally means the data lives only on your laptop — your Render deployment cannot reach it.
- Hosting MinIO on a cloud VM yourself costs money and maintenance effort.
- **Free hosted alternatives like Cloudflare R2 are S3-compatible** — the same boto3 code works unchanged. So there is no reason to self-host MinIO for a free deployment.

**Recommended free storage: Cloudflare R2**
- 10 GB storage free forever
- 1 million Class-A (write) operations/month free
- 10 million Class-B (read) operations/month free
- S3-compatible API (works with boto3 out of the box)

---

## What changed in the code

Only **three files** were touched. Everything else stays the same.

### 1. `rag-service/storage.py` — REPLACE the entire file

**Remove:** the local `shutil.copytree` stub that copies files around `/tmp`.

**Replace with:** boto3 calls that upload/download to any S3-compatible bucket.

```python
import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from config import (
    S3_ENDPOINT_URL,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
)


def _client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL,       # None for real AWS S3
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_REGION,
    )


def upload_dir(local_path, bucket=None, key=None):
    client = _client()
    for file in Path(local_path).rglob("*"):
        if file.is_file():
            relative = file.relative_to(local_path)
            object_key = f"{key}/{relative}"
            client.upload_file(str(file), bucket, object_key)


def download_dir(bucket=None, key=None, target=None):
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=key):
        for obj in page.get("Contents", []):
            relative = obj["Key"][len(key):].lstrip("/")
            dest = Path(target) / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(bucket, obj["Key"], str(dest))


def object_exists(bucket=None, key=None):
    client = _client()
    try:
        response = client.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
        return response.get("KeyCount", 0) > 0
    except ClientError:
        return False
```

### 2. `rag-service/config.py` — ADD four lines

**Add** these four variables anywhere after the existing `VECTOR_STORE_BUCKET` line:

```python
S3_ENDPOINT_URL      = os.getenv("S3_ENDPOINT_URL")        # blank = real AWS S3
AWS_ACCESS_KEY_ID    = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY= os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION           = os.getenv("AWS_REGION", "auto")      # "auto" works for R2
```

**Remove nothing** from config.py — just add the four lines above.

### 3. `rag-service/requirements.txt` — ADD one line

```
boto3
```

That is the complete change. `vector_store.py` is **not touched** — it already calls `upload_dir`, `download_dir`, and `object_exists` through the storage module abstraction.

---

## Step-by-step: set up Cloudflare R2 (free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and create a free account.
2. In the left sidebar click **R2 Object Storage** → **Create bucket**.
3. Give the bucket a name, e.g. `code-eval-faiss`. Choose any region. Click **Create bucket**.
4. On the R2 overview page, click **Manage R2 API Tokens** → **Create API Token**.
   - Permissions: **Object Read & Write**
   - Scope: **Specific bucket** → select `code-eval-faiss`
   - Click **Create API Token**.
5. Copy the three values shown (you will never see them again):
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** — looks like `https://<account_id>.r2.cloudflarestorage.com`

These map to your environment variables:

```
VECTOR_STORE_BUCKET=code-eval-faiss
S3_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<Access Key ID>
AWS_SECRET_ACCESS_KEY=<Secret Access Key>
AWS_REGION=auto
```

> **Tip for local dev:** Create a `rag-service/.env` file with the five variables above. The code already calls `load_dotenv()` in `config.py`, so it will be picked up automatically. Add `.env` to `.gitignore` so secrets are never committed.

---

## Step-by-step: deploy the RAG service on Render (free)

1. Push your repo to GitHub (your RAG code is at `rag-service/`).
2. Go to [render.com](https://render.com) and sign up (free).
3. Click **New → Web Service** → connect your GitHub repo.
4. Fill in the form:
   - **Name:** `code-eval-rag` (or anything)
   - **Root Directory:** `rag-service`
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
5. Click **Advanced → Add Environment Variable** and add all the secrets:

   | Key | Value |
   |---|---|
   | `GROQ_API_KEY` | your Groq key |
   | `GITHUB_TOKEN` | your GitHub PAT |
   | `VECTOR_STORE_BUCKET` | `code-eval-faiss` |
   | `VECTOR_STORE_PREFIX` | `vector-stores` |
   | `S3_ENDPOINT_URL` | `https://<id>.r2.cloudflarestorage.com` |
   | `AWS_ACCESS_KEY_ID` | R2 access key |
   | `AWS_SECRET_ACCESS_KEY` | R2 secret key |
   | `AWS_REGION` | `auto` |

6. Click **Create Web Service**. Render installs dependencies and starts the server.
7. Your RAG endpoint will be something like `https://code-eval-rag.onrender.com`.

> **Free tier caveat:** Render's free tier spins down after 15 minutes of inactivity and takes ~30 seconds to wake up on the next request. The first request after sleep will be slow. For a personal or demo project this is acceptable.

---

## Step-by-step: deploy the Next.js app on Vercel (free)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project** → import your repo.
3. Vercel auto-detects Next.js. Leave defaults.
4. Under **Environment Variables** add:
   - `RAG_SERVICE_URL` = `https://code-eval-rag.onrender.com` (your Render URL)
   - Any auth/database secrets your Next.js app needs.
5. Click **Deploy**.

---

## Step-by-step: set up the database on Neon (free PostgreSQL)

1. Go to [neon.tech](https://neon.tech) and sign up (free).
2. Create a new project. Neon gives you a PostgreSQL 16 database instantly.
3. Copy the **Connection string** from the dashboard — it looks like:
   `postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Add it as `DATABASE_URL` in Vercel's environment variables and in your local `.env`.
5. Run `npx prisma db push` (or `prisma migrate deploy`) to apply the schema.

---

## Do I need Docker? Can I avoid it?

**Yes, you can completely avoid Docker for this stack.** Here is the full picture:

- **Vercel** builds and deploys Next.js for you with no Docker needed.
- **Render** installs Python dependencies from `requirements.txt` and runs `uvicorn` for you with no Docker needed.
- **Neon** is a fully managed Postgres-as-a-service; no Docker needed.
- **Cloudflare R2** is a managed object store; no Docker needed.

Docker becomes useful only if you want to run everything identically on your local machine, or if you later self-host on a raw VPS. For a free-tier cloud deployment as described above, Docker adds complexity with no benefit.

---

## Architecture summary

```
Browser
  │
  ▼
Vercel (Next.js)  ──────────────────►  Neon (PostgreSQL)
  │
  │ HTTP calls to RAG service
  ▼
Render (FastAPI / uvicorn)
  │                   │
  │ reads/writes       │ reads/writes FAISS index
  ▼                   ▼
Cloudflare R2    /tmp (ephemeral, for index assembly only)
```

Every component is free-tier friendly and requires no Docker or self-hosted infrastructure.
