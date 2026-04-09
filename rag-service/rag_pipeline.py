"""
Adapted from YouTube RAG rag_pipeline.py.
Changes:
  - Prompts are repo/code-aware instead of transcript-aware.
  - Added separate chains for summary, contributor summary, and questions.
"""

from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from config import GROQ_API_KEY

llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="llama-3.3-70b-versatile",
    temperature=0.2,
)


def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)


# ── Chat (RAG Q&A) ─────────────────────────────────────────────

CHAT_PROMPT = PromptTemplate(
    template="""You are an expert software engineer analysing a GitHub repository.
Answer the question using ONLY the code and files provided below.
If the answer is not in the provided context, say "I don't know based on the available code."

Context (repository files):
{context}

Question: {question}
""",
    input_variables=["context", "question"],
)


def build_chat_chain(vector_store):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 5})
    parallel = RunnableParallel({
        "context": retriever | RunnableLambda(format_docs),
        "question": RunnablePassthrough(),
    })
    return parallel | CHAT_PROMPT | llm | StrOutputParser()


# ── Repo Summary ───────────────────────────────────────────────

SUMMARY_PROMPT = PromptTemplate(
    template="""You are a senior software engineer. Based on the repository code below,
write a concise but comprehensive summary covering:
- Purpose and main functionality
- Tech stack and architecture
- Code quality observations
- Notable patterns or areas of concern

Repository code:
{context}

Write your summary in clear paragraphs.
""",
    input_variables=["context"],
)


def build_summary_chain(vector_store):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 10})
    # For summary we don't need a question passthrough — fetch broad context
    return (
        RunnableLambda(lambda _: "Give me a full overview of this repository")
        | RunnableParallel({"context": retriever | RunnableLambda(format_docs)})
        | SUMMARY_PROMPT
        | llm
        | StrOutputParser()
    )


# ── Contributor Summary ────────────────────────────────────────

CONTRIBUTOR_PROMPT = PromptTemplate(
    template="""You are evaluating a software contributor based on their commit history.
Commit history for {login}:
{context}

Provide a summary covering:
- Areas of the codebase they work on most
- Nature of their contributions (features, bugs, refactors, docs)
- Overall activity level
- Any notable patterns

Be factual and professional.
""",
    input_variables=["context", "login"],
)


def build_contributor_summary_chain(vector_store, login: str):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 8})
    return (
        RunnableLambda(lambda _: login)
        | RunnableParallel({
            "context": retriever | RunnableLambda(format_docs),
            "login": RunnablePassthrough(),
        })
        | CONTRIBUTOR_PROMPT
        | llm
        | StrOutputParser()
    )


# ── Question Generation ────────────────────────────────────────

QUESTION_PROMPT = PromptTemplate(
    template="""You are a technical interviewer. Based on the contributor's commits and the
repository code, generate 5 unique and specific evaluation questions of type: {question_type}.

Guidelines:
- Questions must be specific to THIS contributor's actual work
- Vary difficulty (2 easy, 2 medium, 1 hard)
- For 'scalability': focus on performance and load concerns
- For 'optimization': focus on algorithmic or resource improvements
- For 'ml-usage': focus on ML/AI usage if present, else data processing
- For 'architecture': focus on design decisions
- For 'general': mix of understanding and application

Context:
{context}

Contributor: {login}
Question type: {question_type}

Return ONLY a numbered list of 5 questions, no preamble.
""",
    input_variables=["context", "login", "question_type"],
)


def build_question_chain(vector_store, login: str, question_type: str):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 6})

    def invoke_chain(_):
        docs = retriever.invoke(f"{login} contributions {question_type}")
        context = format_docs(docs)
        prompt_value = QUESTION_PROMPT.format(
            context=context, login=login, question_type=question_type
        )
        result = llm.invoke(prompt_value)
        return StrOutputParser().invoke(result)

    return invoke_chain
