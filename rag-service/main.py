"""
FastAPI RAG service
Endpoints:
  POST /ingest             ← ingest a GitHub repo
  POST /summarize          ← generate repo summary
  POST /contributor-summary ← generate contributor summary
  POST /generate-questions  ← generate evaluation questions
  POST /chat               ← RAG Q&A
"""
# where are we ingesting contributor commit diffs? 
# take text prompt corresponding to the action just selected, show like a [selected option] and user types after it. so prompts can be dynamic based on what user selects, and we can have some default prompts for each action that can be customized by the user if they want. for example, for summarize repo action, default prompt can be "Summarize the main purpose and functionality of this repository in a few sentences.", but user can edit it to be more specific like "Summarize the main purpose and functionality of this repository, and also mention any unique features or technologies used." or "Summarize the main purpose and functionality of this repository, and also mention any potential use cases or applications." etc. we can have a textarea input where user can edit the prompt before submitting the request, and we can show the default prompt as placeholder text in that textarea.
import re
# re is used in general for parsing numbered lists in the /generate-questions endpoint, but feel free to remove if not needed in your implementation.
from fastapi import FastAPI, HTTPException
# fastapi is the web framework used to create the API endpoints.
# HTTPException is used to return error responses with specific status codes and messages.
from pydantic import BaseModel
# Pydantic's BaseModel allows us to define the expected structure of the data we receive in API requests. 
# It automatically checks that the incoming data matches this structure and converts received json data into Python objects, 
# making it easier to work with in our code.
from config import VECTOR_STORE_PREFIX  # understand config vs env?
# VECTOR_STORE_PREFIX is a configuration variable that specifies the base URI for where the FAISS vector stores are located.

from github_loader import (
    build_repo_text,
    build_contributor_text,
    get_latest_sha,
)
# TODOs : but we can fetch sha's in next.js itself and send it in request body to avoid extra latency from these calls in python. 

from vector_store import (
    create_vector_store,
    load_vector_store,
    get_or_create_vector_store
)

# Later files could be in form of contributor commit diff embeddings, that way we don't duplicate repo text embeddings in both repo-level and contributor-level vector stores, we can just have contributor-level vector stores that contain embeddings of the contributor text, which includes the relevant repo text for that contributor, and then when we want to generate a summary or answer questions, we can just use the contributor-level vector store for the relevant contributor, which will have all the necessary context. this way we avoid duplicating repo text embeddings in multiple vector stores and save storage space and reduce ingestion time.
# combined code i.e repo level questions can use all contributor embeddings together.
from rag_pipeline import (
    build_chat_chain,
    build_summary_chain,
    build_contributor_summary_chain,
    build_question_chain,
)


app = FastAPI(title="Code Eval Hub — RAG Service")
# Initialize the FastAPI application with a title, FastAPI() is a class provided by the FastAPI library. When you call FastAPI(), you are creating an instance of this class, which represents your web application. This instance is used to define your API endpoints and their behavior. The title parameter is an optional argument that sets the title of the API, which is displayed in the automatically generated documentation.
# we're not using title in any functional way in the code, but it can be 
# helpful for documentation and clarity when the API is running.
# When you run the FastAPI application, it automatically generates interactive API documentation using Swagger UI.
# This documentation is accessible by navigating to http://localhost:8000/docs in your web browser (assuming you're running the app locally on port 8000).
# The title you set in FastAPI will be displayed at the top of this documentation page,


# ── Request / Response models ──────────────────────────────────

class IngestRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    last_sha: str | None = None
# The (BaseModel) syntax means that IngestRequest is a Pydantic model(i.e., it inherits from BaseModel),
# which will automatically validate incoming data to ensure it has the correct fields and types.


class SummarizeRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str


class ContributorRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    contributor_login: str
# Todo : again we get all contributors info together, and then we can run loop one them one by one to generate their summaries one by one, and send back combned summary together.


class QuestionRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    contributor_login: str
    question_type: str = "general"
#  TODOs : we're going to remove question type, instead get a user prompt if they want to give, and we're going to get a single request with all contributors, we can then generate their questions one by one and send back combined questions together. so we can have a list of contributor logins instead of a single contributor login, and then we can loop through that list to generate questions for each contributor and combine them together in the response.


class ChatRequest(BaseModel):
    repo_id: str
    question: str


# ── Helpers ────────────────────────────────────────────────────
# TODOs : we should send this kind of info in next.js request body instead 
# of looking up in DB, to avoid extra latency from DB calls.
# why _ at start of function name? In Python, a leading underscore in a function
#  or variable name is a convention that indicates it is intended for internal use 
# within the module or class. It is a way to signal to other developers that this 
# function or variable is not part of the public API and should not be accessed 
# directly from outside the module or class. However, this is just a convention 
# and does not enforce any actual access restrictions; it is still possible to access 
# these functions or variables from outside, but it is generally discouraged.
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

@app.get("/")
def read_root():
    return {"message": "API is working"}
# syntax of fastapi endpoint definition: @app.<http method>("path") defines an endpoint that listens for HTTP requests with the specified method (e.g., GET, POST) at the given path. 
# The function that follows is the handler for that endpoint, which will be called whenever a request is made to that path with the specified method. In this case, when a GET request is made to the root path ("/"), the read_root function will be executed, 
# and it will return a JSON response with the message "API is working". How is this dict sent as json response? FastAPI automatically converts the returned dictionary into a JSON response when sending it back to the client. So when you return {"message": "API is working"}, FastAPI will serialize this dictionary into JSON format and include it in the HTTP response body that is sent back to the client making the request.


@app.post("/ingest")
def ingest_repo(data: IngestRequest):
    """
    Fetch all repository files from GitHub and create FAISS embeddings.
    """
    # what is this """...""" syntax? This is a docstring in Python, which is a string literal that occurs as the first statement in a module, function, class, or method definition. It is used to document the purpose and behavior of the code it describes.
    try:
        # TODOs : all this info should come from request body. checking if repo 
        # embedding is outdated can be checked in next itself.
        latest_sha = get_latest_sha(data.owner, data.repo_name)
        repo_text = build_repo_text(data.owner, data.repo_name)
        create_vector_store(repo_text, data.repo_id, scope="repo")
        repo_faiss_uri = f"{VECTOR_STORE_PREFIX}/{data.repo_id}/repo.faiss"

        # Metadata is handled by Next.js action (triggerRepoIngestion),
        # so do not call placeholder db code here.
        return {"status": "ok", "latest_sha": latest_sha, "repo_faiss_uri": repo_faiss_uri}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion error: {str(e)}")
    # this error too will get sent back as json? yes, when you raise an 
    # HTTPException in FastAPI, it will automatically generate a JSON response 
    # that includes the status code and the detail message you provided. So in 
    # this case, if an exception occurs during the ingestion process, the 
    # client will receive a JSON response with a 500 status code and a message like {"detail": "Ingestion error: <error message>"}.


@app.post("/summarize")
def summarize_repo(data: SummarizeRequest):
    vs = load_vector_store(data.repo_id, "repo")
    # vs object shape is : {"index": <faiss index object>, "metadata": {"repo_id": ..., "scope": ...}}
    if vs is None:
        try:
            # TODOs : check last commit sha in next app itself
            # latest_sha = get_latest_sha(data.owner, data.repo_name)
            repo_text = build_repo_text(data.owner, data.repo_name)
            create_vector_store(repo_text, data.repo_id, scope="repo")
            vs = load_vector_store(data.repo_id, "repo")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Auto-ingestion failed: {str(e)}")

    if vs is None:
        raise HTTPException(status_code=500, detail="Vector store not available after ingestion.")

    chain = build_summary_chain(vs)
    # where are we giving prompt? The prompt is defined within the build_summary_chain function in the rag_pipeline module. When we build the summary chain, we create a retriever from the vector store and then use that retriever to fetch relevant documents based on a query. The retrieved documents are then formatted and passed as context to the SUMMARY_PROMPT, which is used by the language model to generate the summary. So, while we don't explicitly pass a prompt in the summarize_repo endpoint, the prompt is implicitly used within the chain that we build using the vector store.
    #  TODOs : add custom prompt handling.
    summary = chain.invoke(None)
    return {"summary": summary}


@app.post("/contributor-summary")
def contributor_summary(data: ContributorRequest):
    contributor_text = build_contributor_text(
        data.owner, data.repo_name, data.contributor_login
    )

    vs = get_or_create_vector_store(
        contributor_text, data.repo_id, scope=data.contributor_login
    )

    chain = build_contributor_summary_chain(vs, data.contributor_login)

    summary = chain.invoke(None)

    return {"summary": summary}


@app.post("/generate-questions")
def generate_questions(data: QuestionRequest):
    # Load repo-level + contributor-level vectors, combine context
    repo_vs = load_vector_store(data.repo_id, "repo")
    if repo_vs is None:
        raise HTTPException(status_code=400, detail="Repo not ingested.")

    contributor_text = build_contributor_text(data.owner, data.repo_name, data.contributor_login)
    contrib_vs = get_or_create_vector_store(
        contributor_text, data.repo_id, scope=data.contributor_login
    )

    chain_fn = build_question_chain(contrib_vs, data.contributor_login, data.question_type)
    raw = chain_fn(None)   #None because the prompt is already defined in the chain, and we don't have any additional input to provide at this time. The chain will use the context from the vector store and the predefined prompt to generate the questions. If we had a dynamic prompt or additional input from the user, we could pass that in place of None when invoking the chain. But in this case, since we're using a static prompt defined within the chain, we can simply pass None to indicate that there is no additional input needed for generating the questions.
    # TODOs : enable sending custom prompt from next.js, and then pass that prompt here in collaboration with the static prompt defined in the chain. this way we can have more flexibility and allow users to specify their own prompts for question generation, which can lead to more relevant and tailored questions based on their specific needs or areas of interest.

    # Parse numbered list into array
    questions = [
        re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        for line in raw.strip().split("\n")
        if line.strip() and re.match(r"^\d+", line.strip())
    ]
    return {"questions": questions[:5]} # return top 5 questions
# TODo: ensure only 5(or whayever fixed threshold we want, 5 is good for now) are generated as well so we're not doing extra work for generating more questions that we won't return.


@app.post("/chat")
def chat_with_repo(data: ChatRequest):
    """
    Core RAG Q&A — direct adaptation of the original /ask endpoint, takes repo_id + question.
    """
    vs = load_vector_store(data.repo_id, "repo")
    if vs is None:
        raise HTTPException(status_code=400, detail="Repo not ingested.")

    chain = build_chat_chain(vs)
    answer = chain.invoke(data.question)
    return {"answer": answer}


# TODOs : how is update made? in prior embeddings? shouldn't we modify older embedding and add new changes to it and store this updated one? making new vector stores is necessary or we can do updates in old embeddings easily?

# ── Run ────────────────────────────────────────────────────────
# Start with: uvicorn main:app --reload --port 8000