# Code Eval Hub: GitHub Repository Semantic Analyzer — Hash Maps, FAISS Vector Indexing, and RAG Pipeline Orchestration

A full-stack application that fetches GitHub repository data via the GitHub API, builds semantic vector embeddings using FAISS, and enables AI-powered code Q&A, repository summarization, and contributor evaluation through a Retrieval-Augmented Generation (RAG) pipeline.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Data Structures Currently in Use](#data-structures-currently-in-use)
4. [Algorithms Currently in Use](#algorithms-currently-in-use)
5. [Are the Chosen Data Structures the Best Fit?](#are-the-chosen-data-structures-the-best-fit)
6. [Suggestions for Better-Suited Data Structures](#suggestions-for-better-suited-data-structures)

---

## Project Overview

Code Eval Hub allows a user to submit any public GitHub repository URL. The system then:

- Fetches all source files and commit diffs from the GitHub REST API.
- Builds a FAISS-backed semantic vector store from the repository content.
- Lets the user ask natural-language questions about the code, generate a repository summary, and evaluate contributors — all powered by a LLaMA-based LLM via the Groq API.

Commits and file trees are fetched entirely through the GitHub API. The project does **not** manually traverse git history locally.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Auth | NextAuth.js v5 (Credentials provider) |
| Database | PostgreSQL via Prisma ORM |
| RAG Service | Python, FastAPI, LangChain, FAISS, HuggingFace |
| LLM | LLaMA 3.3 70B via Groq API |
| Cache | Next.js `unstable_cache` with tag-based invalidation |

---

## Data Structures Currently in Use

### 1. Hash Map (`Map` in TypeScript)

**Location:** `app/lib/data.ts` — `fetchRepositoriesByUser`

```ts
const dedup = new Map(chats.map((c) => [c.repository.id, c.repository]));
return Array.from(dedup.values());
```

A `Map` is built with `repository.id` as the key to **deduplicate repositories** fetched through chat join results. Because multiple chats can reference the same repository, iterating the raw array would produce duplicates. The Map's O(1) key-lookup guarantees that only the last-seen entry for each ID survives, and `Array.from(dedup.values())` converts it back to a deduplicated list.

**Why it fits:** Deduplication of keyed objects is the canonical use case for a hash map.

---

### 2. Set (Python `set`)

**Location:** `rag-service/github_loader.py` — `INCLUDE_EXTENSIONS`

```python
INCLUDE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ...}
...
any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
```

A Python `set` stores the list of allowed file extensions. Every file in the GitHub tree is tested against this set. Set membership testing is O(1) on average, whereas a list would be O(n) per lookup.

**Why it fits:** Membership testing with no ordering requirements is the textbook use case for a set.

---

### 3. Array / List

**Used across:** virtually every module — commits, file metadata, text chunks, messages, questions, contributors.

Arrays are the default sequential container for ordered collections. They appear as:

- `list[dict]` for file tree results and commit lists (Python).
- `string[]` / `T[]` for TypeScript API response types.
- The `questions` array built by parsing the LLM's numbered output in `main.py`.

---

### 4. FAISS Vector Index (Approximate Nearest Neighbor Index)

**Location:** `rag-service/vector_store.py`

This is the most algorithmically rich data structure in the project. FAISS (Facebook AI Similarity Search) is an **Inverted File Index with Product Quantization** (IVF-PQ) under the hood. Each source file chunk is converted into a 384-dimensional float vector by the `all-MiniLM-L6-v2` HuggingFace embedding model, then inserted into the FAISS index.

At query time:

```python
retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 5})
```

FAISS performs an **Approximate Nearest Neighbor (ANN)** search to return the k most semantically similar chunks to the query vector. This powers the entire RAG pipeline.

**Why it fits:** Exact nearest-neighbor search in 384 dimensions would be O(n·d) (brute-force). FAISS's ANN index reduces this to approximately O(√n · d) with a controlled accuracy trade-off — the only practical choice for semantic search at this scale.

---

### 5. Sliding-Window Text Chunks (Overlapping Array Segments)

**Location:** `rag-service/vector_store.py` — `RecursiveCharacterTextSplitter`

```python
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
chunks = splitter.create_documents([text])
```

The splitter recursively divides text using a priority list of separators (`\n\n`, `\n`, ` `, `""`) and produces fixed-size chunks with a 200-character overlap between consecutive chunks. The overlap is a **sliding window** strategy to ensure that context crossing a chunk boundary is not lost.

Each chunk becomes one document in the FAISS index.

**Why it fits:** Embedding models have a token limit. Chunking is mandatory. Overlapping chunks prevent context loss at boundaries, which directly improves retrieval quality.

---

### 6. Hash / Checksum

**Two distinct uses:**

**a) SHA-1 hash for storage key disambiguation (`rag-service/vector_store.py`):**

```python
suffix = hashlib.sha1(scope.encode("utf-8")).hexdigest()[:8]
return f"{base_}_{suffix}"
```

When contributor login names are sanitized for use as object storage keys, a SHA-1 digest of the original name is appended to prevent key collisions between names that sanitize to the same string (e.g., `"a[b]"` and `"a(b)"`).

**b) bcrypt hash for password storage (`app/lib/actions.ts`):**

```ts
const hashedPassword = await bcrypt.hash(password, 10);
```

bcrypt is a one-way adaptive hash function with a configurable cost factor (`10` rounds here). It is the industry standard for password storage.

---

### 7. LangChain Runnable Pipeline (Directed Acyclic Graph)

**Location:** `rag-service/rag_pipeline.py`

```python
parallel = RunnableParallel({
    "context": retriever | RunnableLambda(format_docs),
    "question": RunnablePassthrough(),
})
return parallel | CHAT_PROMPT | llm | StrOutputParser()
```

The `|` operator composes `Runnable` objects into a **Directed Acyclic Graph (DAG)** of computation steps. `RunnableParallel` runs the retriever and passthrough concurrently, then feeds the merged result into the prompt template, then into the LLM, then into the output parser.

This is structurally a pipeline / computation graph, analogous to Unix pipe chains or stream processing DAGs.

**Why it fits:** The RAG flow has both sequential dependencies (retrieval → prompt → LLM → parse) and parallel steps (context retrieval + question passthrough happening simultaneously). A DAG captures this cleanly.

---

### 8. Tag-Based Cache (Memoization Table with Invalidation Groups)

**Location:** `app/lib/data.ts` — every `unstable_cache(...)` call

```ts
return await unstable_cache(
  async () => prisma.repository.findUnique({ where: { id } }),
  ['repositories-by-id', id],
  { tags: ['repositories', `repo-${id}`] }
)();
```

Next.js `unstable_cache` wraps async data fetches in a server-side memoization table. The **cache key** (array of strings) uniquely identifies a cached result. The **tags** group related cache entries so they can all be invalidated together with a single `revalidateTag(...)` call. This is equivalent to a hash map from key → cached value, with a side-table mapping tag → set of keys.

---

### 9. Relational / Graph Data Model (Prisma Schema)

**Location:** `prisma/schema.prisma`

The database schema models an entity-relationship graph:

```
User ──< Chat >── Repository ──< Contributor
                     |
                     └──< GeneratedQuestion
Chat ──< Message
```

Relations are expressed as foreign keys with cascade-delete rules. Database indexes (`@@index`) are B-tree structures maintained by PostgreSQL for O(log n) lookups on indexed columns.

---

### 10. Pagination State (Offset / Page-Based)

**Location:** `app/lib/utils.ts` — `generatePagination`; `app/lib/data.ts` — `fetchFilteredRepositories`

```ts
const skip = (page - 1) * perPage;
```

The pagination state is a simple integer-pair `(page, perPage)` that maps to SQL `OFFSET / LIMIT` (Prisma `skip/take`). The `generatePagination` function produces the array of page numbers shown in the UI, using an ellipsis (`'...'`) to collapse large page ranges — a standard windowed-pagination algorithm.

---

## Algorithms Currently in Use

| Algorithm | Location | Purpose |
|---|---|---|
| Approximate Nearest Neighbor (ANN) search | FAISS in `vector_store.py` | Semantic similarity retrieval |
| Recursive divide-and-conquer text splitting | `RecursiveCharacterTextSplitter` | Chunk documents for embedding |
| Sliding-window overlap | `chunk_overlap=200` in splitter | Preserve context across chunk boundaries |
| SHA-1 hash | `vector_store.py` `_sanitize_scope` | Deterministic, collision-resistant key generation |
| bcrypt adaptive hashing | `actions.ts` | Secure password storage |
| Regex parsing | `github.ts`, `main.py`, `vector_store.py` | URL parsing, numbered list parsing, key sanitization |
| Offset-based pagination | `data.ts`, `utils.ts` | Page navigation |
| Parallel promise resolution | `actions.ts` `Promise.all(...)` | Concurrent GitHub API calls |
| Tag-based cache invalidation | `data.ts` | Efficient cache purging on data change |

---

## Are the Chosen Data Structures the Best Fit?

| Data Structure | Use | Assessment |
|---|---|---|
| `Map` for deduplication | `fetchRepositoriesByUser` | ✅ Optimal — O(1) insertion and lookup |
| Python `set` for extension filter | `github_loader.py` | ✅ Optimal — O(1) membership test |
| FAISS ANN Index | Semantic search | ✅ Optimal — only practical approach for high-dimensional vector search |
| Overlapping chunks (sliding window) | Text splitting | ✅ Well-suited — standard RAG practice |
| SHA-1 for key disambiguation | `_sanitize_scope` | ✅ Well-suited — deterministic and collision-resistant |
| bcrypt | Password hashing | ✅ Best practice — adaptive cost, resistant to GPU attacks |
| LangChain DAG pipeline | RAG chain | ✅ Well-suited — models both sequential and parallel steps |
| Tag-based cache | `unstable_cache` | ✅ Well-suited — fine-grained invalidation without full flush |
| Offset pagination | `fetchFilteredRepositories` | ⚠️ Adequate — cursor-based pagination would be more stable for large datasets |
| Plain `Array` for commit/file lists | Throughout | ⚠️ Adequate — a priority queue could improve ordering logic |

---

## Suggestions for Better-Suited Data Structures

### 1. Min-Heap / Priority Queue → replace SQL `ORDER BY totalCommits DESC` in application layer

**Where:** `data.ts` `fetchContributorsByRepo` currently relies on PostgreSQL `ORDER BY` to rank contributors.  
**Suggestion:** If contributor ranking logic ever moves to application code (e.g., weighted scoring across multiple metrics), a **min-heap** (`heapq` in Python, or a binary heap) would maintain the top-k contributors in O(n log k) time, better than sorting the full list in O(n log n).

---

### 2. Trie → replace SQL `ILIKE '%query%'` for repository search

**Where:** `data.ts` `fetchFilteredRepositories` uses `contains` (SQL `ILIKE`) for prefix/substring search on repo names.  
**Suggestion:** A **Trie (prefix tree)** indexed on repo `name` and `owner` fields would reduce prefix search from O(n) scan to O(m) where m is the query length. For a large number of repositories per user this would significantly outperform a full-table scan.

---

### 3. LRU Cache → manage in-memory vector store lifecycle

**Where:** `vector_store.py` — every request downloads a FAISS index from object storage and discards it after use. There is no in-process reuse.  
**Suggestion:** An **LRU (Least Recently Used) Cache** (Python `functools.lru_cache` or a doubly-linked-list + hash map implementation) keyed by `(repo_id, scope)` would keep recently-used FAISS indexes in memory. Subsequent requests for the same repo would skip the object-storage round-trip entirely, cutting latency significantly for active repositories.

---

### 4. Cursor-Based Pagination → replace offset/skip pagination

**Where:** `data.ts` `fetchFilteredRepositories` uses `skip = (page-1) * perPage`.  
**Suggestion:** Offset pagination becomes inconsistent when rows are inserted or deleted between page fetches (a user on page 3 may see duplicates or skip rows). **Cursor-based pagination** uses the last-seen record's `createdAt` or `id` as the starting point for the next page, producing stable results regardless of concurrent writes. Prisma supports this natively via `cursor`.

---

### 5. Bloom Filter → fast "already ingested?" check before DB query

**Where:** `main.py` — before calling `load_vector_store`, the service could first check whether a repo has ever been ingested.  
**Suggestion:** A **Bloom filter** is a probabilistic set membership structure that answers "is this repo_id definitely NOT ingested?" in O(1) with zero false negatives. It avoids unnecessary object-storage lookups entirely for repos that have never been ingested, at the cost of a small false-positive rate (which can be calibrated).

---

### 6. Deque → bounded chat message history window for LLM context

**Where:** `rag_pipeline.py` — `build_chat_chain` currently retrieves only document chunks; it does not maintain a rolling conversation history.  
**Suggestion:** A **deque (double-ended queue)** with a fixed `maxlen` would maintain the last N messages of a conversation in O(1) append and O(1) eviction from the left. This is the standard approach for a bounded LLM conversation memory buffer (LangChain's `ConversationBufferWindowMemory` uses this pattern internally).
