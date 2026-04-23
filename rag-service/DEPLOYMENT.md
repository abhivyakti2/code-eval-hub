# RAG Service — Cloud Storage & Deployment Guide

## Quick answers to common questions

| Question | Answer |
|---|---|
| Do I need Docker? | **No.** Render runs Python directly. Skip Docker entirely for now. |
| Do I need local MinIO? | **No.** Use a free hosted cloud bucket instead. |
| Where to deploy RAG? | **Render** (free tier) |
| Where to deploy Next.js? | **Vercel** (free tier) |
| Where to host the DB? | **Neon** (free PostgreSQL) or Vercel Postgres |
| Where to store FAISS? | **Supabase Storage** (free tier, S3-compatible) |

---

## What is MinIO and why are we skipping it?

MinIO is a self-hosted, S3-compatible object storage server. It is great for running a private S3-style bucket on your own machine or server. However:

- Running it locally means the data lives only on your laptop — your Render deployment cannot reach it.
- Hosting MinIO on a cloud VM yourself costs money and maintenance effort.
- **Free hosted alternatives like Supabase Storage are S3-compatible** — the same boto3 code works unchanged. So there is no reason to self-host MinIO for a free deployment.

**Recommended free storage: Supabase Storage**
- 1 GB storage free forever on the free tier
- S3-compatible API (works with boto3 out of the box — no new library needed)
- You likely already have a Supabase project if you are using Supabase for your database
- Simple dashboard UI to browse uploaded files

---

## What changed in the code

Only **three files** were touched. Everything else stays the same.

### 1. `rag-service/storage.py` — REPLACE the entire file

**Remove:** the local `shutil.copytree` stub that copies files around `/tmp`.

**Replace with:** boto3 calls that upload/download to any S3-compatible bucket (including Supabase Storage).

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
        endpoint_url=S3_ENDPOINT_URL,       # https://<project>.supabase.co/storage/v1/s3
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_REGION,             # always "us-east-1" for Supabase
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
S3_ENDPOINT_URL       = os.getenv("S3_ENDPOINT_URL")       # https://<project>.supabase.co/storage/v1/s3
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")      # Supabase Storage access key
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")  # Supabase Storage secret key
AWS_REGION            = os.getenv("AWS_REGION", "us-east-1")  # Supabase always uses us-east-1
```

**Remove nothing** from config.py — just add the four lines above.

### 3. `rag-service/requirements.txt` — ADD one line

```
boto3
```

That is the complete change. `vector_store.py` is **not touched** — it already calls `upload_dir`, `download_dir`, and `object_exists` through the storage module abstraction.

---

## Step-by-step: set up Supabase Storage (free)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up for a free account (sign in with GitHub is easiest).
2. Click **New project**.
3. Fill in a **Project name** (e.g. `code-eval-hub`), set a **Database Password** (save it somewhere), choose the **Region** closest to you, and click **Create new project**.
4. Wait ~1 minute for the project to provision.

### 2. Create a Storage bucket

1. In the left sidebar, click **Storage**.
2. Click **New bucket**.
3. Name it `faiss-indexes` (or anything you like — you will put this in `VECTOR_STORE_BUCKET`).
4. Leave **Public bucket** unchecked (keep it private).
5. Click **Save**.

### 3. Get the S3-compatible credentials

Supabase exposes every Storage bucket as an S3-compatible endpoint. Here is how to get the credentials:

1. In the left sidebar, click **Project Settings** (the gear icon at the bottom).
2. Click **Storage** in the settings menu.
3. Scroll down to the **S3 Connection** section.
4. Click **Enable S3 access** if it is not already enabled.
5. Click **New access key** to generate a key pair.
6. Copy both values shown — **Access Key ID** and **Secret Access Key** (you will not see the secret again).
7. Also note the **Endpoint URL** shown in the same section — it looks like:
   `https://<project-ref>.supabase.co/storage/v1/s3`

These map to your environment variables:

```
VECTOR_STORE_BUCKET=faiss-indexes
VECTOR_STORE_PREFIX=vector-stores
S3_ENDPOINT_URL=https://<project-ref>.supabase.co/storage/v1/s3
AWS_ACCESS_KEY_ID=<Access Key ID>
AWS_SECRET_ACCESS_KEY=<Secret Access Key>
AWS_REGION=us-east-1
```

> **Important:** Supabase Storage always requires the region to be `us-east-1` in the boto3 client, regardless of the actual geographic region you chose for the project. If you set it to anything else, requests will fail with a signature mismatch error.

> **Tip for local dev:** Create a `rag-service/.env` file with the six variables above. The code already calls `load_dotenv()` in `config.py`, so it will be picked up automatically. Add `rag-service/.env` to `.gitignore` so secrets are never committed.

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
   | `VECTOR_STORE_BUCKET` | `faiss-indexes` |
   | `VECTOR_STORE_PREFIX` | `vector-stores` |
   | `S3_ENDPOINT_URL` | `https://<project-ref>.supabase.co/storage/v1/s3` |
   | `AWS_ACCESS_KEY_ID` | Supabase Storage access key |
   | `AWS_SECRET_ACCESS_KEY` | Supabase Storage secret key |
   | `AWS_REGION` | `us-east-1` |

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

> **Alternative:** If you prefer a single vendor, you can use Supabase for your PostgreSQL database too — the same project you created for Storage will have a Postgres database built in. The connection string is under **Project Settings → Database → Connection string**.

---

## Do I need Docker? Can I avoid it?

**Yes, you can completely avoid Docker for this stack.** Here is the full picture:

- **Vercel** builds and deploys Next.js for you with no Docker needed.
- **Render** installs Python dependencies from `requirements.txt` and runs `uvicorn` for you with no Docker needed.
- **Neon / Supabase** are fully managed Postgres-as-a-service; no Docker needed.
- **Supabase Storage** is a managed object store; no Docker needed.

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
  │                        │
  │ reads/writes            │ reads/writes FAISS index
  ▼                        ▼
Supabase Storage      /tmp (ephemeral, for index assembly only)
```

Every component is free-tier friendly and requires no Docker or self-hosted infrastructure.
