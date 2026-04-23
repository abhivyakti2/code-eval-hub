# MinIO Setup Guide for FAISS Cloud Storage

This guide explains what MinIO is, how to set it up **without Docker**, which code to change, and how to deploy everything.

---

## What is MinIO?

MinIO is a self-hosted, S3-compatible object storage server. "Object storage" means you store files (blobs) by a key name inside a bucket, like folders in S3. Because MinIO speaks the same API as Amazon S3, any boto3/S3 code works against it unchanged — you just point the endpoint at `localhost:9000` during development instead of AWS.

In this project MinIO stores the FAISS index files (`index.faiss` + `index.pkl`) so they survive restarts and can be shared between multiple instances of the RAG service.

---

## Do You Need Docker?

**No.** MinIO ships as a single binary with zero dependencies — you download it, run it, done. Docker is completely optional. You only need Docker if you want to containerise the whole app for deployment, which you can skip for now.

---

## 1 — Download & Run MinIO (no Docker)

### macOS

```bash
brew install minio/stable/minio
mkdir -p ~/minio-data
minio server ~/minio-data --console-address ":9001"
```

### Linux

```bash
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
mkdir -p ~/minio-data
./minio server ~/minio-data --console-address ":9001"
```

### Windows

Download `minio.exe` from https://dl.min.io/server/minio/release/windows-amd64/minio.exe, then:

```powershell
mkdir C:\minio-data
.\minio.exe server C:\minio-data --console-address ":9001"
```

Once running:
- **S3 API** → `http://localhost:9000`
- **Web console** → `http://localhost:9001`
- Default credentials: `minioadmin` / `minioadmin`

---

## 2 — Create a Bucket

Open the web console at `http://localhost:9001`, log in with `minioadmin` / `minioadmin`, click **Buckets → Create Bucket**, and name it `faiss-store` (or any name you like).

Or use the MinIO CLI (`mc`):

```bash
# Install mc
brew install minio/stable/mc          # macOS
# or: wget https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x mc

mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/faiss-store
```

---

## 3 — Environment Variables

Create a `.env` file inside `rag-service/` (it is already loaded by `config.py`):

```env
# existing vars
GROQ_API_KEY=your_groq_key
GITHUB_TOKEN=your_github_token

# MinIO (new)
VECTOR_STORE_BUCKET=faiss-store
VECTOR_STORE_PREFIX=vector-stores

MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_SECURE=false          # set to true when using HTTPS in production
```

---

## 4 — Code Changes

### 4a — `requirements.txt` (add one line)

```
boto3
```

No other dependency changes needed.

---

### 4b — `config.py` (add 4 lines, keep everything else)

Add these lines **after** the existing `VECTOR_STORE_TMP` line:

```python
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY",  "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY",  "minioadmin")
MINIO_SECURE     = os.getenv("MINIO_SECURE", "false").lower() == "true"
```

---

### 4c — `storage.py` (full replacement)

The current file is a local-filesystem mock. **Delete its entire contents** and replace with:

```python
"""
Object storage backend using MinIO (S3-compatible) via boto3.
Replaces the local-filesystem mock.  The public interface
(upload_dir / download_dir / object_exists) is identical, so
vector_store.py requires no changes.
"""

import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from config import (
    MINIO_ENDPOINT,
    MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY,
    MINIO_SECURE,
)


def _s3():
    """Return a boto3 S3 client pointed at MinIO."""
    scheme = "https" if MINIO_SECURE else "http"
    return boto3.client(
        "s3",
        endpoint_url=f"{scheme}://{MINIO_ENDPOINT}",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
    )


def upload_dir(local_path, bucket=None, key=None):
    """Upload every file in local_path to bucket under the prefix key/."""
    s3 = _s3()
    for file in Path(local_path).rglob("*"):
        if file.is_file():
            relative = file.relative_to(local_path)
            s3_key = f"{key}/{relative}"
            s3.upload_file(str(file), bucket, s3_key)


def download_dir(bucket=None, key=None, target=None):
    """Download all objects whose key starts with key/ into target directory."""
    s3 = _s3()
    paginator = s3.get_paginator("list_objects_v2")
    prefix = key + "/"
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            relative = obj["Key"][len(prefix):]
            dest = Path(target) / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, obj["Key"], str(dest))


def object_exists(bucket=None, key=None):
    """Return True if any object with prefix key/ exists in bucket."""
    s3 = _s3()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=key + "/"):
        if page.get("Contents"):
            return True
    return False
```

**`vector_store.py` stays completely unchanged** — it already imports `upload_dir`, `download_dir`, `object_exists` from `storage`, and those names are preserved.

---

## 5 — How the Pieces Fit Together

```
Next.js  POST /ingest
    │
    ▼
FastAPI  (rag-service)
  create_vector_store()
    │  saves index.faiss + index.pkl to a temp dir
    │
    ▼
MinIO  bucket: faiss-store
  key: vector-stores/{repo_id}/repo.faiss/index.faiss
  key: vector-stores/{repo_id}/repo.faiss/index.pkl

Later calls to load_vector_store() download those two files
back to a fresh temp dir and load them with FAISS.load_local().
```

---

## 6 — Deploying Everything

### Part A — Next.js app + Database → Vercel

1. Push to GitHub and import the repo in [vercel.com](https://vercel.com).
2. For the database, use one of these Vercel-integrated options (all have free tiers):
   - **Vercel Postgres** (powered by Neon) — easiest, one-click from the Vercel dashboard
   - **Neon** (neon.tech) — generous free tier, works with Prisma out of the box
   - **Supabase** — also works well with Prisma
3. Set your environment variables in the Vercel dashboard (same as your `.env.local`).
4. Run `prisma migrate deploy` as a build step or via Vercel's CLI.

### Part B — RAG service (FastAPI Python) → Render or Railway

Vercel does **not** support long-running Python servers. Use one of:

| Platform | Free tier | Notes |
|----------|-----------|-------|
| **Render** | Yes (spins down after 15 min idle) | Easiest — connect GitHub, set start command |
| **Railway** | $5 credit/month | Slightly faster cold starts |
| **Fly.io** | Yes | Good for always-on |
| **Modal** | Yes | Serverless Python, great for ML workloads |

**Render example**:
1. Create a new **Web Service** from your GitHub repo.
2. Set **Root Directory** to `rag-service`.
3. Set **Build Command**: `pip install -r requirements.txt`
4. Set **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables (GROQ_API_KEY, GITHUB_TOKEN, MINIO_* vars).

### Part C — MinIO in production

In production you have three realistic options:

| Option | Cost | Effort |
|--------|------|--------|
| **Self-host MinIO on the same Render/Railway service** | Free (same VM) | Low — add startup script, but data is ephemeral on free tiers |
| **MinIO Cloud** (min.io/cloud) | Paid | Zero ops |
| **Cloudflare R2** | Free up to 10 GB/month | Zero ops, S3-compatible — just change `MINIO_ENDPOINT` to your R2 endpoint |
| **AWS S3** | ~$0.023/GB | S3 directly, no endpoint change needed — remove `endpoint_url` from `_s3()` |
| **Backblaze B2** | Free up to 10 GB | S3-compatible |

**Recommended for this project**: **Cloudflare R2** — free tier is generous, S3-compatible, no egress fees. You only need to change `MINIO_ENDPOINT` in your env vars to the R2 endpoint URL Cloudflare gives you.

For Cloudflare R2:
1. Create a free Cloudflare account → R2 → Create bucket.
2. Generate an API token (R2 → Manage R2 API tokens).
3. Set:
   ```env
   MINIO_ENDPOINT=<account-id>.r2.cloudflarestorage.com
   MINIO_ACCESS_KEY=<r2-access-key-id>
   MINIO_SECRET_KEY=<r2-secret-access-key>
   MINIO_SECURE=true
   VECTOR_STORE_BUCKET=faiss-store
   ```
   The `storage.py` code above works with R2 unchanged.

---

## 7 — Quick-start Summary (local dev)

```bash
# 1. Start MinIO
minio server ~/minio-data --console-address ":9001"

# 2. Create bucket via console at http://localhost:9001
#    bucket name: faiss-store

# 3. Install deps
cd rag-service
pip install -r requirements.txt   # now includes boto3

# 4. Copy .env and fill in values
cp .env.example .env

# 5. Start RAG service
uvicorn main:app --reload --port 8000

# 6. In another terminal, start Next.js
cd ..
pnpm dev
```
