"""
Stores FAISS in object storage (no long-lived local disk).
Memory optimisations for free-tier (512 MB):
  - Uses HuggingFace Inference API for embeddings — no local model, no torch, no sentence-transformers.
  - Embedding client is lazy-initialised on first use.
  - In-process cache capped at MAX_CACHED_STORES entries (LRU eviction).
"""

import re
import hashlib
import os
import tempfile
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceInferenceAPIEmbeddings
from langchain_community.vectorstores import FAISS

from config import VECTOR_STORE_BUCKET, VECTOR_STORE_PREFIX, VECTOR_STORE_TMP
from storage import upload_dir, download_dir, object_exists

HF_TOKEN = os.getenv("HF_TOKEN")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # runs on HF servers, not here

MAX_CACHED_STORES = 2

# ── Lazy embedding singleton ───────────────────────────────────

_embeddings: Optional[HuggingFaceInferenceAPIEmbeddings] = None


def _get_embeddings() -> HuggingFaceInferenceAPIEmbeddings:
    global _embeddings
    if _embeddings is None:
        if not HF_TOKEN:
            raise RuntimeError("HF_TOKEN env var is not set.")
        _embeddings = HuggingFaceInferenceAPIEmbeddings(
            api_key=HF_TOKEN,
            model_name=EMBEDDING_MODEL,
        )
    return _embeddings


# ── LRU in-process cache ───────────────────────────────────────

_vs_cache: OrderedDict[str, FAISS] = OrderedDict()


def _sanitize_scope(scope: str) -> str:
    base = re.sub(r"[^0-9A-Za-z._-]+", "_", scope).strip("._-").lower()
    if not base:
        base = "user"
    suffix = hashlib.sha1(scope.encode("utf-8")).hexdigest()[:8]
    return f"{base}_{suffix}"


def _object_key(repo_id: str, scope: str) -> str:
    safe_scope = scope if scope == "repo" else _sanitize_scope(scope)
    return f"{VECTOR_STORE_PREFIX}/{repo_id}/{safe_scope}.faiss"


def _cache_key(repo_id: str, scope: str) -> str:
    safe_scope = scope if scope == "repo" else _sanitize_scope(scope)
    return f"{repo_id}:{safe_scope}"


def _cache_get(repo_id: str, scope: str) -> Optional[FAISS]:
    ck = _cache_key(repo_id, scope)
    if ck in _vs_cache:
        _vs_cache.move_to_end(ck)
        return _vs_cache[ck]
    return None


def _cache_put(repo_id: str, scope: str, vs: FAISS) -> None:
    ck = _cache_key(repo_id, scope)
    _vs_cache[ck] = vs
    _vs_cache.move_to_end(ck)
    while len(_vs_cache) > MAX_CACHED_STORES:
        _vs_cache.popitem(last=False)


def invalidate_cache(repo_id: str, scope: str = "repo") -> None:
    _vs_cache.pop(_cache_key(repo_id, scope), None)


# ── Core helpers ───────────────────────────────────────────────

def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)


def _save_and_upload(vs: FAISS, object_key: str) -> None:
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        path.mkdir(parents=True, exist_ok=True)
        vs.save_local(str(path))
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)


def _download_and_load(object_key: str) -> FAISS:
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        download_dir(bucket=VECTOR_STORE_BUCKET, key=object_key, target=str(path))
        return FAISS.load_local(
            str(path),
            _get_embeddings(),
            allow_dangerous_deserialization=True,
        )


# ── Public API ─────────────────────────────────────────────────

def create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    chunks = _splitter().create_documents([text])
    vs = FAISS.from_documents(chunks, _get_embeddings())
    _save_and_upload(vs, _object_key(repo_id, scope))
    _cache_put(repo_id, scope, vs)
    return vs


def load_vector_store(repo_id: str, scope: str = "repo") -> Optional[FAISS]:
    cached = _cache_get(repo_id, scope)
    if cached is not None:
        return cached
    object_key = _object_key(repo_id, scope)
    if not object_exists(bucket=VECTOR_STORE_BUCKET, key=object_key):
        return None
    vs = _download_and_load(object_key)
    _cache_put(repo_id, scope, vs)
    return vs


def get_or_create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    vs = load_vector_store(repo_id, scope)
    if vs is not None:
        return vs
    return create_vector_store(text, repo_id, scope)


def update_vector_store(new_text: str, repo_id: str, scope: str = "repo") -> FAISS:
    existing = load_vector_store(repo_id, scope)
    new_chunks = _splitter().create_documents([new_text])
    if not new_chunks:
        return existing
    new_vs = FAISS.from_documents(new_chunks, _get_embeddings())
    if existing is not None:
        existing.merge_from(new_vs)
        updated = existing
    else:
        updated = new_vs
    _save_and_upload(updated, _object_key(repo_id, scope))
    _cache_put(repo_id, scope, updated)
    return updated