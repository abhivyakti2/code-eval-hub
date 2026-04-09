"""
Adapted from the YouTube RAG vector_store.py — but stores FAISS in object
storage (no long-lived local disk). Accepts repo or contributor text.
"""

import os
import tempfile
from pathlib import Path
from typing import Optional
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from config import VECTOR_STORE_BUCKET, VECTOR_STORE_PREFIX, VECTOR_STORE_TMP
from storage import upload_dir, download_dir, object_exists  # implement with boto3/gcsfs/azure-sdk


EMBEDDINGS = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


def _object_key(repo_id: str, scope: str) -> str:
    """Return the object-storage key for a given repo + scope."""
    return f"{VECTOR_STORE_PREFIX}/{repo_id}/{scope}.faiss"


def create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    """
    Create a FAISS vector store from text, then upload it to object storage.
    `scope` is either 'repo' or a contributor login like 'octocat'.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = splitter.create_documents([text])

    vector_store = FAISS.from_documents(chunks, EMBEDDINGS)

    object_key = _object_key(repo_id, scope)
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        path.parent.mkdir(parents=True, exist_ok=True)
        vector_store.save_local(str(path))
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)

    return vector_store


def load_vector_store(repo_id: str, scope: str = "repo") -> Optional[FAISS]:
    """Load a FAISS index from object storage, or return None if missing."""
    object_key = _object_key(repo_id, scope)

    if not object_exists(bucket=VECTOR_STORE_BUCKET, key=object_key):
        return None
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        download_dir(bucket=VECTOR_STORE_BUCKET, key=object_key, target=str(path))
        return FAISS.load_local(
            str(path),
            EMBEDDINGS,
            allow_dangerous_deserialization=True,
        )


def get_or_create_vector_store(
    text: str, repo_id: str, scope: str = "repo"
) -> FAISS:
    """Load from storage if available, otherwise create and upload."""
    vs = load_vector_store(repo_id, scope)
    if vs is not None:
        return vs
    return create_vector_store(text, repo_id, scope)
