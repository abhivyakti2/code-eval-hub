# MinIO Setup for FAISS Vector Store

MinIO is an open-source, S3-compatible object storage server you can run locally or in the cloud.
Here it replaces the current local-filesystem stub in `storage.py` so that FAISS indexes survive
container restarts and can be shared between instances.

---

## 1. What is MinIO and how it fits here

```
FastAPI RAG service
       │
       ├── vector_store.py   ← builds / loads FAISS indexes
       │         │
       │    storage.py       ← upload_dir / download_dir / object_exists
       │         │
       │    MinIO server     ← stores the actual .faiss files as objects
       │         │
       │    bucket: e.g. "code-eval-hub"
       │         └── vector-stores/<repo_id>/repo.faiss/
       │                                      index.faiss
       │                                      index.pkl
```

The current `storage.py` copies files to a local `/tmp` folder — fine for a single machine but
lost on restart. MinIO gives you a persistent, bucket-based store with the same S3 API so the
rest of the code (vector_store.py, main.py) stays **completely unchanged**.

---

## 2. Install MinIO server (local dev)

### Option A — Docker (recommended)
```bash
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio_data:/data \
  quay.io/minio/minio server /data --console-address ":9001"
```

- API endpoint: `http://localhost:9000`  
- Web console:  `http://localhost:9001` (login: `minioadmin` / `minioadmin`)

### Option B — Native binary (Linux / macOS)
```bash
# Linux
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin ./minio server /tmp/minio-data --console-address ":9001"

# macOS (Homebrew)
brew install minio/stable/minio
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin minio server /tmp/minio-data --console-address ":9001"
```

---

## 3. Create the bucket

### Via the web console
1. Open `http://localhost:9001`
2. Log in with `minioadmin` / `minioadmin`
3. Click **Buckets → Create Bucket**
4. Name it `code-eval-hub` (or whatever you'll put in `VECTOR_STORE_BUCKET`)
5. Leave all defaults and click **Create**

### Via the MinIO CLI (`mc`)
```bash
# Install mc
brew install minio/stable/mc          # macOS
# or: wget https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x mc

# Add your local server as an alias
mc alias set local http://localhost:9000 minioadmin minioadmin

# Create the bucket
mc mb local/code-eval-hub
```

---

## 4. Set environment variables

Add these to your `.env` file (next to `rag-service/`) or export them in your shell:

```env
# existing vars
GROQ_API_KEY=your_groq_key
GITHUB_TOKEN=your_github_token

# MinIO / object storage
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
VECTOR_STORE_BUCKET=code-eval-hub
VECTOR_STORE_PREFIX=vector-stores
```

For production MinIO (or AWS S3 / any S3-compatible service), replace the values accordingly.
If you use real AWS S3, set `MINIO_ENDPOINT` to `https://s3.amazonaws.com` and the real key pair.

---

## 5. Code changes (minimal)

### 5a. `requirements.txt` — add boto3

```
boto3
```

Add this line anywhere in `rag-service/requirements.txt`.

### 5b. `config.py` — add MinIO env vars

Append these three lines to the existing `config.py`:

```python
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "http://localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY",  "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY",  "minioadmin")
```

### 5c. `storage.py` — replace the whole file

This is the only file that changes behaviour.  The three public functions
(`upload_dir`, `download_dir`, `object_exists`) keep the exact same signatures
as the current stub, so `vector_store.py` needs **zero changes**.

```python
"""
MinIO (S3-compatible) backend for FAISS object storage.
Drop-in replacement for the local-filesystem stub.
Public API is identical: upload_dir / download_dir / object_exists.
"""

import os
from botocore.exceptions import ClientError
import boto3
from config import MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY


def _client():
    """Return a boto3 S3 client pointed at the MinIO server."""
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
    )


def upload_dir(local_path: str, bucket: str = None, key: str = None) -> None:
    """Upload every file in `local_path` to `bucket` under the prefix `key`."""
    client = _client()
    for root, _dirs, files in os.walk(local_path):
        for filename in files:
            file_path = os.path.join(root, filename)
            relative  = os.path.relpath(file_path, local_path)
            object_key = f"{key}/{relative}"
            client.upload_file(file_path, bucket, object_key)


def download_dir(bucket: str = None, key: str = None, target: str = None) -> None:
    """Download all objects under the prefix `key` from `bucket` into `target`."""
    client = _client()
    os.makedirs(target, exist_ok=True)
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=key):
        for obj in page.get("Contents", []):
            relative = obj["Key"][len(key):].lstrip("/")
            dest = os.path.join(target, relative)
            os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
            client.download_file(bucket, obj["Key"], dest)


def object_exists(bucket: str = None, key: str = None) -> bool:
    """Return True if any object with the given prefix exists in the bucket."""
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=key, MaxKeys=1):
        if page.get("Contents"):
            return True
    return False
```

---

## 6. Install dependencies and run

```bash
cd rag-service
pip install -r requirements.txt   # picks up the new boto3 line
uvicorn main:app --reload --port 8000
```

---

## 7. Verify it works

After hitting `/ingest`, open the MinIO console at `http://localhost:9001` and navigate to
**Buckets → code-eval-hub → vector-stores/** — you should see the uploaded `.faiss` and `.pkl`
files for the ingested repository.

Alternatively from the CLI:
```bash
mc ls local/code-eval-hub/vector-stores/ --recursive
```

---

## 8. Production tips

| Concern | Recommendation |
|---|---|
| Credentials | Use IAM roles (AWS) or MinIO service accounts instead of root keys |
| TLS | Run MinIO behind a reverse proxy (nginx / Caddy) with HTTPS |
| Persistence | Mount a real volume, not `/tmp`, in the Docker run command |
| Bucket policy | Make the bucket private; objects are accessed only by the service |
| Hosted MinIO | MinIO Cloud (`play.min.io`) for quick testing without local setup |
