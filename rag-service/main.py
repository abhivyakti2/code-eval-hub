"""
FastAPI RAG service — adapted from YouTube RAG main.py.
New endpoints:
  POST /ingest             ← ingest a GitHub repo
  POST /summarize          ← generate repo summary
  POST /contributor-summary ← generate contributor summary
  POST /generate-questions  ← generate evaluation questions
  POST /chat               ← RAG Q&A
"""

import re
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from config import VECTOR_STORE_PREFIX  # add this import near top


from github_loader import (
    build_repo_text,
    build_contributor_text,
    get_latest_sha,
)
from vector_store import create_vector_store, load_vector_store, get_or_create_vector_store
from rag_pipeline import (
    build_chat_chain,
    build_summary_chain,
    build_contributor_summary_chain,
    build_question_chain,
)

app = FastAPI(title="Code Eval Hub — RAG Service")


# ── Request / Response models ──────────────────────────────────

class IngestRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    last_sha: str | None = None


class SummarizeRequest(BaseModel):
    repo_id: str


class ContributorRequest(BaseModel):
    repo_id: str
    contributor_login: str


class QuestionRequest(BaseModel):
    repo_id: str
    contributor_login: str
    question_type: str = "general"


class ChatRequest(BaseModel):
    repo_id: str
    question: str


# ── Helpers ────────────────────────────────────────────────────

def _get_owner_repo(repo_id: str) -> tuple[str, str]:
    """
    Look up owner/repo from PostgreSQL (repositories table). Pseudocode shown;
    replace with your DB client of choice.
    """
    return "facebook", "react"
    row = db.fetch_one(
        "SELECT owner, name FROM \"Repository\" WHERE id = %s",
        (repo_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Repo not ingested yet.")
    return row["owner"], row["name"]


def _update_repo_metadata(repo_id: str, latest_sha: str, faiss_uri: str):
    """
    Persist storage location + sha to PostgreSQL (repositories table).
    """
    db.execute(
        """
        UPDATE "Repository"
        SET "lastCommitSha" = %s,
            "lastIngestedAt" = NOW(),
            "repoFaissUri" = %s,
            "repoFaissUploadedAt" = NOW()
        WHERE id = %s
        """,
        (latest_sha, faiss_uri, repo_id),
    )


# ── Endpoints ──────────────────────────────────────────────────


@app.post("/ingest")
def ingest_repo(data: IngestRequest):
    """
    Fetch all repository files from GitHub and create FAISS embeddings.
    """
    try:
        latest_sha = get_latest_sha(data.owner, data.repo_name)
        repo_text = build_repo_text(data.owner, data.repo_name)
        create_vector_store(repo_text, data.repo_id, scope="repo")
        repo_faiss_uri = f"{VECTOR_STORE_PREFIX}/{data.repo_id}/repo.faiss"

        # Metadata is handled by Next.js action (triggerRepoIngestion),
        # so do not call placeholder db code here.
        return {"status": "ok", "latest_sha": latest_sha, "repo_faiss_uri": repo_faiss_uri}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion error: {str(e)}")

@app.post("/summarize")
def summarize_repo(data: SummarizeRequest):
    owner, repo_name = _get_owner_repo(data.repo_id)
    vs = load_vector_store(data.repo_id, "repo")
    if vs is None:
        raise HTTPException(status_code=400, detail="Repo not ingested. Call /ingest first.")
    chain = build_summary_chain(vs)
    summary = chain.invoke(None)
    return {"summary": summary}


@app.post("/contributor-summary")
def contributor_summary(data: ContributorRequest):
    owner, repo_name = _get_owner_repo(data.repo_id)
    contributor_text = build_contributor_text(owner, repo_name, data.contributor_login)
    vs = get_or_create_vector_store(
        contributor_text, data.repo_id, scope=data.contributor_login
    )
    chain = build_contributor_summary_chain(vs, data.contributor_login)
    summary = chain.invoke(None)
    return {"summary": summary}


@app.post("/generate-questions")
def generate_questions(data: QuestionRequest):
    owner, repo_name = _get_owner_repo(data.repo_id)

    # Load repo-level + contributor-level vectors, combine context
    repo_vs = load_vector_store(data.repo_id, "repo")
    if repo_vs is None:
        raise HTTPException(status_code=400, detail="Repo not ingested.")

    contributor_text = build_contributor_text(owner, repo_name, data.contributor_login)
    contrib_vs = get_or_create_vector_store(
        contributor_text, data.repo_id, scope=data.contributor_login
    )

    chain_fn = build_question_chain(contrib_vs, data.contributor_login, data.question_type)
    raw = chain_fn(None)

    # Parse numbered list into array
    questions = [
        re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        for line in raw.strip().split("\n")
        if line.strip() and re.match(r"^\d+", line.strip())
    ]
    return {"questions": questions[:5]}


@app.post("/chat")
def chat_with_repo(data: ChatRequest):
    """
    Core RAG Q&A — direct adaptation of the original /ask endpoint.
    Instead of youtube_url + question, takes repo_id + question.
    """
    vs = load_vector_store(data.repo_id, "repo")
    if vs is None:
        raise HTTPException(status_code=400, detail="Repo not ingested.")

    chain = build_chat_chain(vs)
    answer = chain.invoke(data.question)
    return {"answer": answer}


# ── Run ────────────────────────────────────────────────────────
# Start with: uvicorn main:app --reload --port 8000