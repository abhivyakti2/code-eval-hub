# GitHub Repository Evaluator — Full Transformation Guide

> **Project:** Transform the Next.js Invoice Dashboard (App Router) into a **GitHub Repository Evaluator with RAG-based Chat + Analysis System**.
>
> **Approach:** Maximise reuse of existing patterns (server actions, routing, layouts, auth, search/pagination, streaming) while replacing domain-specific logic.  Every step is sequential; follow the phases in order.

---

## Table of Contents

1. [Understanding the Existing Project](#1-understanding-the-existing-project)
2. [Target Architecture Overview](#2-target-architecture-overview)
3. [Tech Stack](#3-tech-stack)
4. [RAG Design Decisions](#4-rag-design-decisions)
5. [Database Schema (Prisma ORM)](#5-database-schema-prisma-orm)
6. [Phase 1 — Cleanup & Rename](#phase-1--cleanup--rename)
7. [Phase 2 — GitHub API Integration](#phase-2--github-api-integration)
8. [Phase 3 — Database Changes](#phase-3--database-changes)
9. [Phase 4 — UI Changes](#phase-4--ui-changes)
10. [Phase 5 — Python RAG Service](#phase-5--python-rag-service)
11. [Phase 6 — Chat System](#phase-6--chat-system)
12. [Phase 7 — Optimisation & Caching](#phase-7--optimisation--caching)
13. [Feature Mapping Table](#feature-mapping-table)
14. [TanStack Query Usage Rules](#tanstack-query-usage-rules)
15. [GitHub API Reference](#github-api-reference)

---

## 1. Understanding the Existing Project

### 1.1 Routing Structure

```
app/
├── page.tsx                        ← Public home/landing
├── layout.tsx                      ← Root HTML shell
├── login/page.tsx                  ← Auth page
├── dashboard/
│   ├── layout.tsx                  ← Shared sidebar layout
│   ├── (overview)/page.tsx         ← Dashboard home (streamed cards)
│   ├── customers/page.tsx          ← Customer list
│   └── invoices/
│       ├── page.tsx                ← Invoice list + search + pagination
│       ├── create/page.tsx         ← Create form
│       └── [id]/edit/page.tsx      ← Edit form
├── lib/
│   ├── actions.ts                  ← ALL server actions (create/update/delete/auth)
│   ├── data.ts                     ← ALL read queries (PostgreSQL via Prisma ORM)
│   ├── definitions.ts              ← TypeScript type definitions
│   ├── placeholder-data.ts         ← Seed data
│   └── utils.ts                    ← formatCurrency, generatePagination, etc.
└── ui/
    ├── dashboard/sidenav.tsx       ← Sidebar navigation
    ├── dashboard/nav-links.tsx     ← Nav link items
    ├── invoices/table.tsx          ← Invoices table with search
    ├── invoices/pagination.tsx     ← Reusable pagination component
    └── search.tsx                  ← Debounced search input
```

### 1.2 Best Practices to Reuse / Adapt

| Pattern | Where used | How to reuse |
|---|---|---|
| Server Actions (`'use server'`) | `app/lib/actions.ts` | Replace invoice CRUD with GitHub fetch + RAG trigger actions |
| Prisma ORM (replaces direct SQL) | `app/lib/data.ts` | Keep query shapes but implement with `prisma.*` (drop the `postgres` package entirely) |
| Zod validation | `actions.ts` form validation | Validate GitHub URL input |
| URL-based search params | `invoices/page.tsx` | Drive repo search and pagination via URL params |
| Debounced `<Search />` | `app/ui/search.tsx` | Reuse as-is for repo search input |
| Pagination component | `app/ui/invoices/pagination.tsx` | Reuse as-is for commit browsing |
| Suspense + loading skeletons | `(overview)/loading.tsx` + `skeletons.tsx` | Use for async RAG summary streams |
| `revalidatePath` / `revalidateTag` | `actions.ts` | Trigger after new commit detection |
| `notFound()` / `error.tsx` | `invoices/[id]/edit/` | Reuse for missing repo / API errors |
| NextAuth credentials flow | `auth.ts` + `auth.config.ts` | Keep unchanged — users still log in |
| Dashboard layout (SideNav) | `dashboard/layout.tsx` | Replace nav items with new sections |
| `Promise.all` parallel fetches | `data.ts fetchCardData` | Parallel GitHub API calls |
| `generatePagination` util | `utils.ts` | Reuse pagination logic for commits |

---

## 2. Target Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Browser (Next.js SSR)                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  /dashboard/repos — single-page evaluator UI           │ │
│  │   ├── Repo URL input                                    │ │
│  │   ├── Action buttons (summary / questions / compare)   │ │
│  │   ├── Results panel (streamed via Suspense)             │ │
│  │   └── Chat section + Chat history sidebar              │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────┘
                               │ Server Actions / Route Handlers
          ┌────────────────────┴────────────────────┐
          │         Next.js App Server               │
          │  ┌──────────────────────────────────┐   │
          │  │  app/lib/github.ts               │   │
          │  │  (GitHub REST API calls)          │   │
          │  └──────────────────────────────────┘   │
          │  ┌──────────────────────────────────┐   │
          │  │  app/lib/actions.ts (server)     │   │
          │  │  fetchRepo / triggerRAG / chat   │   │
          │  └──────────────────────────────────┘   │
          └────────┬─────────────────┬──────────────┘
                   │                 │
          ┌────────▼───┐    ┌────────▼────────────┐
          │ PostgreSQL │    │  Python RAG Service  │
          │ (users,    │    │  FastAPI on :8000    │
          │  repos,    │    │  LangChain + FAISS   │
          │  contribs, │    │  + Groq LLM          │
          │  chats,    │    └─────────────────────┘
          │  messages) │
          └────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend / SSR | Next.js 15 (App Router) | Keep existing setup |
| Styling | Tailwind CSS + Heroicons | Keep existing setup |
| Auth | NextAuth v5 beta | Keep unchanged |
| Database | PostgreSQL + Prisma ORM | Replace direct SQL with Prisma Client |
| Validation | Zod | Keep, add GitHub URL schema |
| Server-side data mutations | Next.js Server Actions | Repurpose existing pattern |
| Client-side dynamic fetching | TanStack Query (`@tanstack/react-query`) | Add for chat / question regeneration |
| Python AI service | FastAPI + LangChain + FAISS + Groq | New separate service |
| Embeddings | `all-MiniLM-L6-v2` (HuggingFace) | Stored on disk / DB |
| LLM | Groq `llama-3.3-70b-versatile` | Configurable |

---

## 4. RAG Design Decisions

### What are "documents" in the GitHub context?

Use **per-file documents**, not whole-repo or per-commit.  Each file in the repository tree becomes one or more chunks.  Additionally create:

- **Commit summary documents** — one per contributor, summarising their commit messages.
- **README document** — treated as a special high-priority chunk.

This gives the best retrieval granularity while avoiding token bloat.

### Embedding Strategy

```
Repo ingestion
 └── For each file in file tree:
       └── Chunk file content (1000 chars, 200 overlap)
             └── Embed → FAISS index (repo-level)
 └── For each contributor:
       └── Collect their commit messages + diffs summary
             └── Embed → FAISS index (contributor-level)
             └── Store in: rag_data/{repo_id}/contributors/{login}.faiss
 └── Store repo-level index at: rag_data/{repo_id}/repo.faiss
```

### Avoid recomputing embeddings

- Store a `last_ingested_sha` per repo in PostgreSQL.
- On update: fetch commits newer than `last_ingested_sha`, only re-embed changed files.
- Keep a file-level `file_sha` map (GitHub provides SHA per tree entry); only re-embed if SHA changed.

### Embedding Storage

Store on **disk** (FAISS `.faiss` + `.pkl` files) inside a `rag_data/` directory relative to the Python service.  Record metadata (repo_id, contributor_login, last_sha) in PostgreSQL so Next.js can query freshness.

### Detect Updates

GitHub's `GET /repos/{owner}/{repo}/commits?since={ISO_date}` endpoint returns only new commits.  Compare the latest commit SHA to `last_ingested_sha` stored in the `repositories` table.

---

## 5. Database Schema (Prisma ORM)

> The project currently uses the `postgres` npm package with raw SQL.  We migrate to **Prisma** for type-safe queries, automatic migrations, and generated TypeScript types.

### 5.1 Install Prisma

```bash
pnpm add @prisma/client
pnpm add -D prisma
npx prisma init --datasource-provider postgresql
```

This creates:
- `prisma/schema.prisma` — the schema definition file
- `.env` — with a `DATABASE_URL` placeholder (Prisma reads `.env`, not `.env.local`)

**File:** `.env` — set the connection string:

```bash
# For local development (no SSL required):
DATABASE_URL="postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/code_eval_hub"

# For production / Vercel / hosted Postgres (SSL required):
# DATABASE_URL="postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@host:5432/code_eval_hub?sslmode=require"
```

> **Local vs production:** Only add `?sslmode=require` when connecting to a hosted/production database (e.g., Supabase, Neon, Render, Vercel Postgres).  Omit it for local PostgreSQL to avoid connection errors.
> If deploying to Vercel or another serverless platform, also add `DATABASE_URL` to the environment variables.  For **connection-pooled** databases (e.g., Supabase PgBouncer), append `?pgbouncer=true&connection_limit=1` — this prevents serverless functions from opening too many simultaneous database connections.

### 5.2 Prisma Schema

**File:** `prisma/schema.prisma` — REPLACE the default with:

> **Note:** This schema uses `@default(cuid())` for IDs.  This is for a **fresh project**.  If you are migrating an existing database that already has UUID primary keys (from the original invoice dashboard), change `@id @default(cuid())` to `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` on every model and update all `String` id fields to use `@db.Uuid`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String       @id @default(cuid())
  name         String
  email        String       @unique
  password     String
  repositories Repository[]
  chats        Chat[]
  createdAt    DateTime     @default(now())
}

model Repository {
  id             String        @id @default(cuid())
  userId         String
  githubUrl      String
  owner          String
  name           String
  description    String?
  stars          Int           @default(0)
  forks          Int           @default(0)
  language       String?
  lastCommitSha  String?
  lastIngestedAt DateTime?
  createdAt      DateTime      @default(now())
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  contributors   Contributor[]
  chats          Chat[]

  @@unique([userId, githubUrl])
  // ↑ Prisma auto-names this constraint "userId_githubUrl".
  //   In actions, query it with: prisma.repository.findUnique({ where: { userId_githubUrl: { userId, githubUrl } } })
}

model Contributor {
  id           String              @id @default(cuid())
  repositoryId String
  githubLogin  String
  avatarUrl    String?
  totalCommits Int                 @default(0)
  summary      String?
  createdAt    DateTime            @default(now())
  repository   Repository          @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  questions    GeneratedQuestion[]

  @@unique([repositoryId, githubLogin])
  // ↑ Prisma auto-names this constraint "repositoryId_githubLogin".
  //   In actions, query it with: prisma.contributor.update({ where: { repositoryId_githubLogin: { repositoryId, githubLogin } } })
}

model Chat {
  id           String     @id @default(cuid())
  userId       String
  repositoryId String
  title        String     @default("New Chat")
  createdAt    DateTime   @default(now())
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  messages     Message[]
}

enum MessageRole {
  user
  assistant
}

model Message {
  id        String      @id @default(cuid())
  chatId    String
  role      MessageRole
  content   String
  createdAt DateTime    @default(now())
  chat      Chat        @relation(fields: [chatId], references: [id], onDelete: Cascade)
}

model GeneratedQuestion {
  id            String      @id @default(cuid())
  contributorId String
  questionType  String      @default("general")
  questions     Json
  createdAt     DateTime    @default(now())
  contributor   Contributor @relation(fields: [contributorId], references: [id], onDelete: Cascade)
}
```

### 5.3 Run the Migration

```bash
npx prisma migrate dev --name init
```

This creates the tables in your database and generates the Prisma Client.  Run this once on initial setup; re-run with a new migration name each time the schema changes.

### 5.4 TypeScript Definitions

With Prisma, TypeScript types are **auto-generated** from the schema.  Instead of manually writing types in `definitions.ts`, import them directly from `@prisma/client`:

**File:** `app/lib/definitions.ts` — REPLACE with:

```typescript
// Re-export Prisma-generated types for use across the application.
// These are automatically kept in sync with prisma/schema.prisma.
export type {
  User,
  Repository,
  Contributor,
  Chat,
  Message,
  GeneratedQuestion,
} from '@prisma/client';
```

> After running `npx prisma generate` (or `npx prisma migrate dev`), all model types are available from `@prisma/client` with full TypeScript intellisense.

---

## Phase 1 — Cleanup & Rename

Execute steps in this exact order.

### Step 1.1 — Delete invoice-specific files

```bash
# Run from project root
rm -rf app/dashboard/invoices
rm -rf app/dashboard/customers
rm    app/ui/acme-logo.tsx
rm    app/ui/home.module.css
rm -rf app/ui/invoices
rm -rf app/ui/customers
rm -rf app/ui/dashboard/cards.tsx
rm -rf app/ui/dashboard/revenue-chart.tsx
rm -rf app/ui/dashboard/latest-invoices.tsx
rm    app/lib/placeholder-data.ts
rm -rf public/customers
rm    public/hero-desktop.png
rm    public/hero-mobile.png
```

### Step 1.2 — Keep (do not delete)

- `app/lib/utils.ts` — keep `generatePagination` and add new helpers
- `app/ui/search.tsx` — reuse as-is
- `app/ui/invoices/pagination.tsx` → **RENAME** to `app/ui/pagination.tsx`
- `app/ui/dashboard/sidenav.tsx` — keep, update nav links
- `app/ui/dashboard/nav-links.tsx` — update links
- `app/ui/button.tsx` — keep as-is
- `app/ui/skeletons.tsx` — keep, add new skeleton variants
- `app/lib/actions.ts` — repurpose (remove invoice CRUD, keep auth; swap `postgres` → Prisma)
- `app/lib/data.ts` — repurpose (remove invoice/customer queries; swap `postgres` → Prisma)
- `app/lib/definitions.ts` — replace with Prisma re-exports (see Phase 3)
- `auth.ts` — **MODIFY**: swap `postgres` import for Prisma (see Phase 3)
- `auth.config.ts` — keep unchanged
- `next.config.ts`, `tailwind.config.ts`, `tsconfig.json` — keep unchanged

### Step 1.3 — Rename dashboard overview route

```bash
mv app/dashboard/\(overview\) app/dashboard/\(home\)
```

> This is purely cosmetic — the route still maps to `/dashboard`.

### Step 1.4 — Create new directories

```bash
mkdir -p app/dashboard/repos
mkdir -p app/dashboard/repos/[id]
mkdir -p app/ui/repos
mkdir -p app/lib
```

---

## Phase 2 — GitHub API Integration

### Step 2.1 — Add GitHub token to environment

**File:** `.env.local` — ADD:

```bash
GITHUB_TOKEN=ghp_your_personal_access_token
RAG_SERVICE_URL=http://localhost:8000
```

> Use a GitHub PAT with `repo` and `read:user` scopes.  This prevents rate limiting (60 → 5000 req/hr).

### Step 2.2 — Create GitHub API helper

**File:** `app/lib/github.ts` — CREATE:

```typescript
const GITHUB_API = 'https://api.github.com';

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/** Parse owner and repo name from a GitHub URL */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!match) throw new Error('Invalid GitHub URL');
  return { owner: match[1], repo: match[2] };
}

/** Fetch repository metadata */
export async function fetchRepoMetadata(owner: string, repo: string) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

/** Fetch list of contributors */
export async function fetchContributors(owner: string, repo: string) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=30`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<
    { login: string; avatar_url: string; contributions: number }[]
  >;
}

/** Fetch commits by a specific contributor */
export async function fetchCommitsByContributor(
  owner: string,
  repo: string,
  login: string,
  since?: string
) {
  const url = new URL(`${GITHUB_API}/repos/${owner}/${repo}/commits`);
  url.searchParams.set('author', login);
  url.searchParams.set('per_page', '100');
  if (since) url.searchParams.set('since', since);

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<
    { sha: string; commit: { message: string; author: { date: string } } }[]
  >;
}

/** Fetch full file tree (recursive) */
export async function fetchFileTree(owner: string, repo: string, sha = 'HEAD') {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  // Filter only blobs (files), exclude large files
  return (data.tree as { path: string; type: string; sha: string; size: number }[])
    .filter((item) => item.type === 'blob' && item.size < 500_000);
}

/** Fetch raw file content (base64 decoded) */
export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    { headers }
  );
  if (!res.ok) return '';
  const data = await res.json();
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return data.content ?? '';
}

/** Fetch latest commit SHA on default branch */
export async function fetchLatestCommitSha(owner: string, repo: string): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/HEAD`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.sha as string;
}
```

### Step 2.3 — Add GitHub URL Zod schema

**File:** `app/lib/actions.ts` — ADD at the top (keep existing imports and `authenticate`):

```typescript
const GitHubUrlSchema = z.string().url().refine(
  (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url),
  { message: 'Must be a valid GitHub repository URL.' }
);
```

---

## Phase 3 — Database Changes

> **Key shift:** Every `import postgres from 'postgres'` and `const sql = postgres(...)` is removed.  All DB access goes through the **Prisma Client** singleton.

### Step 3.1 — Install Prisma and initialise (if not done in Section 5)

```bash
# From the Next.js project root
pnpm add @prisma/client
pnpm add -D prisma
npx prisma init --datasource-provider postgresql
```

Set `DATABASE_URL` in `.env` (Prisma reads this file):

```bash
# .env
DATABASE_URL="postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@localhost:5432/code_eval_hub"
```

Also keep your other secrets in `.env.local`:

```bash
# .env.local
GITHUB_TOKEN=ghp_your_personal_access_token
RAG_SERVICE_URL=http://localhost:8000
NEXTAUTH_SECRET=your_nextauth_secret
```

### Step 3.2 — Write the Prisma schema

Copy the full schema from **Section 5.2** above into `prisma/schema.prisma`.

### Step 3.3 — Run the migration

```bash
npx prisma migrate dev --name init
```

This creates the SQL migration file in `prisma/migrations/`, applies it to your database, and runs `prisma generate` to produce the typed Prisma Client.

> On every subsequent schema change, run `npx prisma migrate dev --name <description>`.

### Step 3.4 — Create the Prisma Client singleton

**File:** `app/lib/db.ts` — CREATE (prevents multiple client instances in dev hot-reloads):

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

> Import `prisma` from this file everywhere instead of constructing `new PrismaClient()`.

### Step 3.5 — Update auth.ts to use Prisma

**File:** `auth.ts` — REPLACE the `postgres` block with Prisma:

```typescript
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/app/lib/db';

async function getUser(email: string) {
  try {
    return await prisma.user.findUnique({ where: { email } });
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);
        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        console.log('Invalid credentials');
        return null;
      },
    }),
  ],
});
```

> **Diff from original:** Remove `import postgres from 'postgres'`, remove `const sql = postgres(...)`, replace `sql<User[]>\`SELECT * FROM users WHERE email=${email}\`` with `prisma.user.findUnique({ where: { email } })`.

### Step 3.6 — Replace data.ts with Prisma queries

**File:** `app/lib/data.ts` — REPLACE its full content with:

```typescript
import { prisma } from './db';

// ── Repositories ──────────────────────────────────────────────

export async function fetchRepositoriesByUser(userId: string) {
  try {
    return await prisma.repository.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch repositories.');
  }
}

export async function fetchRepositoryById(id: string) {
  try {
    return await prisma.repository.findUnique({ where: { id } });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch repository.');
  }
}

export async function fetchFilteredRepositories(
  userId: string,
  query: string,
  page: number,
  perPage = 8
) {
  const skip = (page - 1) * perPage;
  try {
    return await prisma.repository.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { owner: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: perPage,
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to search repositories.');
  }
}

export async function fetchRepositoryPages(
  userId: string,
  query: string,
  perPage = 8
): Promise<number> {
  try {
    const count = await prisma.repository.count({
      where: {
        userId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { owner: { contains: query, mode: 'insensitive' } },
        ],
      },
    });
    return Math.ceil(count / perPage);
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to count repositories.');
  }
}

// ── Contributors ──────────────────────────────────────────────

export async function fetchContributorsByRepo(repositoryId: string) {
  try {
    return await prisma.contributor.findMany({
      where: { repositoryId },
      orderBy: { totalCommits: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch contributors.');
  }
}

// ── Chats ─────────────────────────────────────────────────────

export async function fetchChatsByRepo(userId: string, repositoryId: string) {
  try {
    return await prisma.chat.findMany({
      where: { userId, repositoryId },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch chats.');
  }
}

// ── Messages ──────────────────────────────────────────────────

export async function fetchMessagesByChat(chatId: string) {
  try {
    return await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch messages.');
  }
}

// ── Questions ─────────────────────────────────────────────────

export async function fetchLatestQuestions(
  contributorId: string,
  questionType = 'general'
) {
  try {
    return await prisma.generatedQuestion.findFirst({
      where: { contributorId, questionType },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch questions.');
  }
}
```

### Step 3.7 — Replace actions.ts with Prisma mutations

**File:** `app/lib/actions.ts` — REPLACE with:

```typescript
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import { prisma } from '@/app/lib/db';
import {
  parseGitHubUrl,
  fetchRepoMetadata,
  fetchContributors,
  fetchLatestCommitSha,
} from '@/app/lib/github';

// ── Auth ──────────────────────────────────────────────────────

export async function authenticate(
  prevState: string | undefined,
  formData: FormData
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: '/login' });
}

// ── GitHub URL validation ─────────────────────────────────────

const GitHubUrlSchema = z.string().url().refine(
  (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url),
  { message: 'Must be a valid GitHub repository URL.' }
);

// ── Repository Actions ────────────────────────────────────────

export type AddRepoState = { error?: string; repoId?: string };

export async function addRepository(
  userId: string,
  prevState: AddRepoState,
  formData: FormData
): Promise<AddRepoState> {
  const raw = formData.get('github_url') as string;
  const parsed = GitHubUrlSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  try {
    const { owner, repo } = parseGitHubUrl(parsed.data);

    const existing = await prisma.repository.findUnique({
      where: { userId_githubUrl: { userId, githubUrl: parsed.data } },
    });
    if (existing) return { error: 'Repository already added.' };

    const [meta, latestSha] = await Promise.all([
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]);

    const created = await prisma.repository.create({
      data: {
        userId,
        githubUrl: parsed.data,
        owner,
        name: repo,
        description: meta.description ?? null,
        stars: meta.stargazers_count,
        forks: meta.forks_count,
        language: meta.language ?? null,
        lastCommitSha: latestSha,
      },
    });

    // Save contributors — skipDuplicates handles reruns of addRepository gracefully.
    // A duplicate occurs when the same repo URL is submitted a second time before
    // the @@unique([userId, githubUrl]) check catches it, or during retries.
    const contributors = await fetchContributors(owner, repo);
    await prisma.contributor.createMany({
      data: contributors.map((c) => ({
        repositoryId: created.id,
        githubLogin: c.login,
        avatarUrl: c.avatar_url,
        totalCommits: c.contributions,
      })),
      skipDuplicates: true,  // equivalent to ON CONFLICT DO NOTHING in raw SQL
    });

    revalidateTag('repositories');
    revalidatePath('/dashboard/repos');
    return { repoId: created.id };
  } catch (err) {
    console.error(err);
    return { error: 'Failed to fetch repository from GitHub.' };
  }
}

export async function deleteRepository(id: string) {
  await prisma.repository.delete({ where: { id } });
  revalidateTag('repositories');
  revalidatePath('/dashboard/repos');
}

// ── RAG Trigger Actions ───────────────────────────────────────

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:8000';

export async function triggerRepoIngestion(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw new Error('Repository not found.');

  const res = await fetch(`${RAG_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_id: repoId,
      owner: repo.owner,
      repo_name: repo.name,
      last_sha: repo.lastCommitSha,
    }),
  });

  if (!res.ok) throw new Error('RAG ingestion failed.');
  const data = await res.json();

  await prisma.repository.update({
    where: { id: repoId },
    data: { lastIngestedAt: new Date(), lastCommitSha: data.latest_sha },
  });
  revalidateTag(`repo-${repoId}`);
  revalidatePath(`/dashboard/repos/${repoId}`);
}

export async function generateRepoSummary(repoId: string): Promise<string> {
  const res = await fetch(`${RAG_URL}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId }),
  });
  if (!res.ok) throw new Error('Summary generation failed.');
  const data = await res.json();
  return data.summary as string;
}

export async function generateContributorSummary(
  repoId: string,
  contributorLogin: string
): Promise<string> {
  const res = await fetch(`${RAG_URL}/contributor-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, contributor_login: contributorLogin }),
  });
  if (!res.ok) throw new Error('Contributor summary failed.');
  const data = await res.json();

  await prisma.contributor.update({
    where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: contributorLogin } },
    data: { summary: data.summary },
  });
  return data.summary as string;
}

export async function generateQuestions(
  repoId: string,
  contributorId: string,
  contributorLogin: string,
  questionType = 'general'
): Promise<string[]> {
  const res = await fetch(`${RAG_URL}/generate-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_id: repoId,
      contributor_login: contributorLogin,
      question_type: questionType,
    }),
  });
  if (!res.ok) throw new Error('Question generation failed.');
  const data = await res.json();

  await prisma.generatedQuestion.create({
    data: {
      contributorId,
      questionType,
      questions: data.questions,
    },
  });
  return data.questions as string[];
}

// ── Chat Actions ──────────────────────────────────────────────
//
// Revalidation strategy used throughout actions.ts:
//   revalidateTag('repositories')         → invalidate all repo list caches
//   revalidateTag(`repo-${repoId}`)       → invalidate single-repo caches
//   revalidatePath('/dashboard/repos')    → force full refresh of list page SSR
//   revalidatePath(`/dashboard/repos/${repoId}`) → force full refresh of detail page SSR
//
// Use BOTH revalidateTag + revalidatePath so that both cached fetches (tagged
// with unstable_cache) and the router cache (page segments) are cleared.

export async function createChat(
  userId: string,
  repositoryId: string,
  title: string
): Promise<string> {
  const chat = await prisma.chat.create({
    data: { userId, repositoryId, title },
  });
  revalidateTag(`repo-${repositoryId}`);
  revalidatePath(`/dashboard/repos/${repositoryId}`);
  return chat.id;
}

export async function sendChatMessage(
  chatId: string,
  repoId: string,
  question: string
): Promise<string> {
  // Save user message
  await prisma.message.create({
    data: { chatId, role: 'user', content: question },
  });

  // Ask RAG service
  const res = await fetch(`${RAG_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, question }),
  });
  if (!res.ok) throw new Error('RAG chat failed.');
  const data = await res.json();

  // Save assistant reply
  await prisma.message.create({
    data: { chatId, role: 'assistant', content: data.answer },
  });

  revalidateTag(`repo-${repoId}`);
  revalidatePath(`/dashboard/repos/${repoId}`);
  return data.answer as string;
}

// ── Update Detection ──────────────────────────────────────────

export async function checkAndUpdateRepo(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return;

  const latestSha = await fetchLatestCommitSha(repo.owner, repo.name);
  if (latestSha !== repo.lastCommitSha) {
    await triggerRepoIngestion(repoId);
  }
}
```

---

## Phase 4 — UI Changes

### Step 4.1 — Update navigation links

**File:** `app/ui/dashboard/nav-links.tsx` — REPLACE with:

```typescript
'use client';

import {
  HomeIcon,
  CodeBracketIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const links = [
  { name: 'Home',         href: '/dashboard',       icon: HomeIcon },
  { name: 'Repositories', href: '/dashboard/repos',  icon: CodeBracketIcon },
  { name: 'Chats',        href: '/dashboard/chats',  icon: ChatBubbleLeftRightIcon },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {links.map((link) => {
        const LinkIcon = link.icon;
        return (
          <Link
            key={link.name}
            href={link.href}
            className={clsx(
              'flex h-[48px] grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3',
              { 'bg-sky-100 text-blue-600': pathname === link.href || pathname.startsWith(link.href + '/') }
            )}
          >
            <LinkIcon className="w-6" />
            <p className="hidden md:block">{link.name}</p>
          </Link>
        );
      })}
    </>
  );
}
```

### Step 4.2 — Update root layout metadata

**File:** `app/layout.tsx` — REPLACE metadata:

```typescript
export const metadata: Metadata = {
  title: {
    template: '%s | Code Eval Hub',
    default: 'Code Eval Hub',
  },
  description: 'AI-powered GitHub repository evaluator with RAG-based chat.',
  metadataBase: new URL('https://code-eval-hub.vercel.app'),
};
```

### Step 4.3 — Update home page

**File:** `app/page.tsx` — REPLACE with:

```typescript
import Link from 'next/link';
import { ArrowRightIcon, CodeBracketIcon } from '@heroicons/react/24/outline';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <CodeBracketIcon className="h-16 w-16 text-blue-400" />
        <h1 className="text-4xl font-bold text-white">Code Eval Hub</h1>
        <p className="max-w-md text-slate-300">
          AI-powered GitHub repository evaluator. Analyse repos, evaluate
          contributors, and chat with your codebase using RAG.
        </p>
        <Link
          href="/login"
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 text-white hover:bg-blue-400"
        >
          Get Started <ArrowRightIcon className="h-5 w-5" />
        </Link>
      </div>
    </main>
  );
}
```

### Step 4.4 — Update dashboard overview

**File:** `app/dashboard/(home)/page.tsx` — REPLACE with:

```typescript
import { auth } from '@/auth';
import Link from 'next/link';
import { CodeBracketIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

export default async function DashboardPage() {
  const session = await auth();
  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        Welcome back, {session?.user?.name ?? 'User'} 👋
      </h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Link
          href="/dashboard/repos"
          className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:bg-blue-50"
        >
          <CodeBracketIcon className="h-10 w-10 text-blue-500" />
          <div>
            <p className="font-semibold">Repositories</p>
            <p className="text-sm text-gray-500">Analyse and evaluate GitHub repos</p>
          </div>
        </Link>
        <Link
          href="/dashboard/chats"
          className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:bg-blue-50"
        >
          <ChatBubbleLeftRightIcon className="h-10 w-10 text-blue-500" />
          <div>
            <p className="font-semibold">Chats</p>
            <p className="text-sm text-gray-500">RAG-powered repository chat history</p>
          </div>
        </Link>
      </div>
    </main>
  );
}
```

### Step 4.5 — Create repository list page

**File:** `app/dashboard/repos/page.tsx` — CREATE:

```typescript
import { Suspense } from 'react';
import { auth } from '@/auth';
import Search from '@/app/ui/search';
import Pagination from '@/app/ui/pagination';
import RepoTable from '@/app/ui/repos/table';
import RepoTableSkeleton from '@/app/ui/repos/table-skeleton';
import AddRepoForm from '@/app/ui/repos/add-form';
import { fetchRepositoryPages } from '@/app/lib/data';

export default async function ReposPage({
  searchParams,
}: {
  searchParams?: { query?: string; page?: string };
}) {
  const session = await auth();
  const userId = session!.user!.id as string;
  const query = searchParams?.query ?? '';
  const currentPage = Number(searchParams?.page ?? 1);
  const totalPages = await fetchRepositoryPages(userId, query);

  return (
    <div className="w-full">
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">Repositories</h1>
      <AddRepoForm userId={userId} />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Search placeholder="Search repositories..." />
      </div>
      <Suspense key={query + currentPage} fallback={<RepoTableSkeleton />}>
        <RepoTable userId={userId} query={query} currentPage={currentPage} />
      </Suspense>
      <div className="mt-5 flex w-full justify-center">
        <Pagination totalPages={totalPages} />
      </div>
    </div>
  );
}
```

### Step 4.6 — Create repository detail page (single-page evaluator)

**File:** `app/dashboard/repos/[id]/page.tsx` — CREATE:

```typescript
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { fetchRepositoryById, fetchContributorsByRepo, fetchChatsByRepo } from '@/app/lib/data';
import RepoHeader from '@/app/ui/repos/repo-header';
import ContributorPanel from '@/app/ui/repos/contributor-panel';
import ChatSection from '@/app/ui/repos/chat-section';
import ChatSidebar from '@/app/ui/repos/chat-sidebar';

export default async function RepoDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session!.user!.id as string;

  const [repo, contributors, chats] = await Promise.all([
    fetchRepositoryById(params.id),
    fetchContributorsByRepo(params.id),
    fetchChatsByRepo(userId, params.id),
  ]);

  if (!repo) notFound();

  return (
    <div className="flex h-full gap-4">
      {/* Chat history sidebar */}
      <aside className="hidden w-64 flex-shrink-0 md:block">
        <ChatSidebar chats={chats} repoId={repo.id} userId={userId} />
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <RepoHeader repo={repo} />
        <ContributorPanel
          repoId={repo.id}
          contributors={contributors}
          userId={userId}
        />
        <ChatSection repoId={repo.id} userId={userId} chats={chats} />
      </div>
    </div>
  );
}
```

### Step 4.7 — Create UI components for repos

Create the following files with the code below.

---

**File:** `app/ui/repos/add-form.tsx` — CREATE:

```typescript
'use client';

import { useActionState } from 'react';
import { addRepository, AddRepoState } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';

export default function AddRepoForm({ userId }: { userId: string }) {
  const addRepoWithUser = addRepository.bind(null, userId);
  const [state, dispatch] = useActionState<AddRepoState, FormData>(
    addRepoWithUser,
    {}
  );

  return (
    <form action={dispatch} className="flex gap-2">
      <input
        type="url"
        name="github_url"
        placeholder="https://github.com/owner/repo"
        required
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <Button type="submit">Add Repo</Button>
      {state.error && (
        <p className="mt-1 text-sm text-red-500">{state.error}</p>
      )}
    </form>
  );
}
```

---

**File:** `app/ui/repos/table.tsx` — CREATE:

```typescript
import Link from 'next/link';
import { fetchFilteredRepositories } from '@/app/lib/data';
import DeleteRepoButton from './delete-button';
import { StarIcon, CodeBracketIcon } from '@heroicons/react/24/outline';

export default async function RepoTable({
  userId,
  query,
  currentPage,
}: {
  userId: string;
  query: string;
  currentPage: number;
}) {
  const repos = await fetchFilteredRepositories(userId, query, currentPage);

  return (
    <div className="mt-6 flow-root">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Repository</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Language</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Stars</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Added</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {repos.map((repo) => (
              <tr key={repo.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/repos/${repo.id}`} className="font-medium text-blue-600 hover:underline">
                    {repo.owner}/{repo.name}
                  </Link>
                  {repo.description && (
                    <p className="text-xs text-gray-500 truncate max-w-xs">{repo.description}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {repo.language ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <StarIcon className="h-4 w-4 text-yellow-400" />
                    {repo.stars}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(repo.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <DeleteRepoButton id={repo.id} />
                </td>
              </tr>
            ))}
            {repos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No repositories found. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

**File:** `app/ui/repos/delete-button.tsx` — CREATE:

```typescript
'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import { deleteRepository } from '@/app/lib/actions';

export default function DeleteRepoButton({ id }: { id: string }) {
  const deleteWithId = deleteRepository.bind(null, id);
  return (
    <form action={deleteWithId}>
      <button
        type="submit"
        className="rounded-md p-2 text-red-500 hover:bg-red-50"
        aria-label="Delete repository"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </form>
  );
}
```

---

**File:** `app/ui/repos/table-skeleton.tsx` — CREATE:

```typescript
export default function RepoTableSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-md bg-gray-100 p-4">
          <div className="h-4 w-48 rounded bg-gray-300" />
          <div className="h-4 w-20 rounded bg-gray-300" />
          <div className="h-4 w-12 rounded bg-gray-300" />
        </div>
      ))}
    </div>
  );
}
```

---

**File:** `app/ui/repos/repo-header.tsx` — CREATE:

```typescript
'use client';

import { useState } from 'react';
import { Repository } from '@/app/lib/definitions';
import { triggerRepoIngestion, generateRepoSummary, checkAndUpdateRepo } from '@/app/lib/actions';
import { ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline';

export default function RepoHeader({ repo }: { repo: Repository }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSummarise() {
    setLoading(true);
    try {
      await triggerRepoIngestion(repo.id);
      const result = await generateRepoSummary(repo.id);
      setSummary(result);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckUpdates() {
    setLoading(true);
    try {
      await checkAndUpdateRepo(repo.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">
            <a href={repo.github_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {repo.owner}/{repo.name}
            </a>
          </h2>
          {repo.description && <p className="mt-1 text-sm text-gray-600">{repo.description}</p>}
          <div className="mt-2 flex gap-4 text-sm text-gray-500">
            <span>⭐ {repo.stars}</span>
            <span>🍴 {repo.forks}</span>
            {repo.language && <span>💻 {repo.language}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCheckUpdates}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Check Updates
          </button>
          <button
            onClick={handleSummarise}
            disabled={loading}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <SparklesIcon className="h-4 w-4" />
            {loading ? 'Analysing…' : 'Generate Summary'}
          </button>
        </div>
      </div>
      {summary && (
        <div className="mt-4 rounded-md bg-blue-50 p-4 text-sm text-gray-700">
          <p className="font-semibold text-blue-700 mb-1">Repository Summary</p>
          <p className="whitespace-pre-wrap">{summary}</p>
        </div>
      )}
    </div>
  );
}
```

---

**File:** `app/ui/repos/contributor-panel.tsx` — CREATE:

```typescript
'use client';

import { useState } from 'react';
import { Contributor } from '@/app/lib/definitions';
import {
  generateContributorSummary,
  generateQuestions,
} from '@/app/lib/actions';
import { SparklesIcon, QuestionMarkCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const QUESTION_TYPES = ['general', 'scalability', 'optimization', 'ml-usage', 'architecture'];

export default function ContributorPanel({
  repoId,
  contributors,
  userId,
}: {
  repoId: string;
  contributors: Contributor[];
  userId: string;
}) {
  const [selected, setSelected] = useState<Contributor | null>(contributors[0] ?? null);
  const [summary, setSummary] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [qType, setQType] = useState('general');
  const [loading, setLoading] = useState(false);

  async function handleSummary() {
    if (!selected) return;
    setLoading(true);
    try {
      const result = await generateContributorSummary(repoId, selected.github_login);
      setSummary(result);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuestions() {
    if (!selected) return;
    setLoading(true);
    try {
      const result = await generateQuestions(repoId, selected.id, selected.github_login, qType);
      setQuestions(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 font-semibold">Contributors</h3>
      <div className="flex gap-4">
        {/* Contributor list */}
        <ul className="w-40 space-y-1 border-r pr-4">
          {contributors.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => { setSelected(c); setSummary(null); setQuestions([]); }}
                className={`w-full rounded-md px-2 py-1 text-left text-sm hover:bg-gray-100 ${selected?.id === c.id ? 'bg-blue-50 font-medium text-blue-700' : ''}`}
              >
                {c.github_login}
                <span className="ml-1 text-xs text-gray-400">({c.total_commits})</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Contributor detail */}
        {selected && (
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3" aria-label={`Contributor: ${selected.github_login}, ${selected.total_commits} commits`}>
              {selected.avatar_url && (
                <img src={selected.avatar_url} alt={`${selected.github_login}'s avatar`} className="h-10 w-10 rounded-full" />
              )}
              <div>
                <p className="font-medium" aria-label="GitHub username">{selected.github_login}</p>
                <p className="text-sm text-gray-500"><span className="sr-only">Total commits: </span>{selected.total_commits} commits</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSummary}
                disabled={loading}
                className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <SparklesIcon className="h-4 w-4" />
                Contributor Summary
              </button>

              <select
                value={qType}
                onChange={(e) => setQType(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <button
                onClick={handleQuestions}
                disabled={loading}
                className="flex items-center gap-1 rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                <QuestionMarkCircleIcon className="h-4 w-4" />
                {loading ? 'Generating…' : 'Generate Questions'}
              </button>

              {questions.length > 0 && (
                <button
                  onClick={handleQuestions}
                  disabled={loading}
                  className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Regenerate
                </button>
              )}
            </div>

            {summary && (
              <div className="rounded-md bg-green-50 p-4 text-sm text-gray-700">
                <p className="font-semibold text-green-700 mb-1">Summary for {selected.github_login}</p>
                <p className="whitespace-pre-wrap">{summary}</p>
              </div>
            )}

            {questions.length > 0 && (
              <div className="rounded-md bg-yellow-50 p-4 text-sm text-gray-700">
                <p className="font-semibold text-yellow-700 mb-2">Evaluation Questions ({qType})</p>
                <ol className="list-decimal list-inside space-y-1">
                  {questions.map((q, i) => <li key={i}>{q}</li>)}
                </ol>
                <button
                  onClick={() => navigator.clipboard.writeText(questions.join('\n'))}
                  className="mt-3 rounded-md border border-yellow-300 px-3 py-1 text-xs hover:bg-yellow-100"
                >
                  Copy Questions
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

**File:** `app/ui/repos/chat-section.tsx` — CREATE:

```typescript
'use client';

import { useState } from 'react';
import { Chat, Message } from '@/app/lib/definitions';
import { createChat, sendChatMessage } from '@/app/lib/actions';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';

export default function ChatSection({
  repoId,
  userId,
  chats,
}: {
  repoId: string;
  userId: string;
  chats: Chat[];
}) {
  const [activeChatId, setActiveChatId] = useState<string | null>(
    chats[0]?.id ?? null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function handleNewChat() {
    const chatId = await createChat(userId, repoId, 'New Chat');
    setActiveChatId(chatId);
    setMessages([]);
  }

  async function handleSend() {
    if (!input.trim() || !activeChatId) return;
    const question = input.trim();
    setInput('');
    setSending(true);

    // Optimistic user message
    setMessages((prev) => [
      ...prev,
      { id: 'tmp', chat_id: activeChatId, role: 'user', content: question, created_at: new Date().toISOString() },
    ]);

    try {
      const answer = await sendChatMessage(activeChatId, repoId, question);
      setMessages((prev) => [
        ...prev,
        { id: 'tmp2', chat_id: activeChatId, role: 'assistant', content: answer, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">Chat with Repository</h3>
        <button
          onClick={handleNewChat}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          + New Chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ minHeight: 200, maxHeight: 400 }}>
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            Ask anything about this repository…
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-prose rounded-2xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-400">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask a question about this repo…"
            disabled={!activeChatId || sending}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={!activeChatId || sending || !input.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <PaperAirplaneIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

**File:** `app/ui/repos/chat-sidebar.tsx` — CREATE:

```typescript
'use client';

import { useState } from 'react';
import { Chat } from '@/app/lib/definitions';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export default function ChatSidebar({
  chats,
  repoId,
  userId,
}: {
  chats: Chat[];
  repoId: string;
  userId: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(chats[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Chat History
      </p>
      {chats.length === 0 && (
        <p className="text-xs text-gray-400">No chats yet.</p>
      )}
      <ul className="space-y-1 overflow-y-auto">
        {chats.map((chat) => (
          <li key={chat.id}>
            <button
              onClick={() => setActiveId(chat.id)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100',
                { 'bg-blue-50 text-blue-700 font-medium': activeId === chat.id }
              )}
            >
              <ChatBubbleLeftIcon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{chat.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Step 4.8 — Move pagination component

```bash
cp app/ui/invoices/pagination.tsx app/ui/pagination.tsx
```

> Update the import in `app/dashboard/repos/page.tsx` to `@/app/ui/pagination`.  No code changes needed — the component is generic.

---

## Phase 5 — Python RAG Service

Create a separate directory `rag-service/` at the **project root** (sibling to `app/`).

### Step 5.1 — Directory structure

```
rag-service/
├── requirements.txt
├── .env
├── config.py
├── github_loader.py        ← replaces transcript_loader.py
├── vector_store.py         ← adapted (same logic, different input)
├── rag_pipeline.py         ← adapted prompts
└── main.py                 ← FastAPI server with new endpoints
```

### Step 5.2 — requirements.txt

**File:** `rag-service/requirements.txt` — CREATE:

```
langchain
langchain_core
langchain-community
langchain-groq
langchain-huggingface
faiss-cpu
tiktoken
python-dotenv
sentence-transformers
fastapi
uvicorn
httpx
PyGithub
```

### Step 5.3 — config.py

**File:** `rag-service/config.py` — CREATE:

```python
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
RAG_DATA_DIR = os.getenv("RAG_DATA_DIR", "./rag_data")
```

### Step 5.4 — github_loader.py (replaces transcript_loader.py)

**File:** `rag-service/github_loader.py` — CREATE:

```python
"""
Adapts transcript_loader.py for GitHub repositories.
Instead of fetching a YouTube transcript (a single text),
we fetch all code files from a GitHub repo and return them
as a list of (path, content) tuples — the equivalent of
document chunks at the source level.
"""

import httpx
import base64
from config import GITHUB_TOKEN

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

MAX_FILE_SIZE = 500_000  # 500 KB — skip very large files

# File extensions to include (source code only)
INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs",
    ".cpp", ".c", ".cs", ".rb", ".php", ".swift", ".kt", ".md",
    ".yaml", ".yml", ".json", ".toml", ".env.example", ".sh",
}


def fetch_file_tree(owner: str, repo: str, sha: str = "HEAD") -> list[dict]:
    """Return list of file metadata dicts from the repo tree."""
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    return [
        item for item in data.get("tree", [])
        if item["type"] == "blob"
        and item.get("size", 0) < MAX_FILE_SIZE
        and any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
    ]


def fetch_file_content(owner: str, repo: str, path: str) -> str:
    """Fetch and decode a single file's content."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")


def fetch_commits_by_contributor(
    owner: str, repo: str, login: str, since: str | None = None
) -> list[dict]:
    """Fetch commit messages for a contributor — equivalent of transcript for that person."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    params = {"author": login, "per_page": 100}
    if since:
        params["since"] = since
    r = httpx.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def build_repo_text(owner: str, repo: str) -> str:
    """
    Build a single concatenated text from all source files.
    This is the GitHub equivalent of a YouTube transcript.
    Each file is prefixed with its path so the LLM understands context.
    """
    files = fetch_file_tree(owner, repo)
    parts = []
    for f in files:
        content = fetch_file_content(owner, repo, f["path"])
        if content.strip():
            parts.append(f"### FILE: {f['path']}\n\n{content}\n")
    return "\n\n".join(parts)


def build_contributor_text(owner: str, repo: str, login: str) -> str:
    """
    Build contributor-specific text from their commit messages.
    Equivalent of a transcript scoped to one contributor.
    """
    commits = fetch_commits_by_contributor(owner, repo, login)
    lines = [f"Contributor: {login}", f"Total commits: {len(commits)}", ""]
    for commit in commits:
        msg = commit.get("commit", {}).get("message", "")
        date = commit.get("commit", {}).get("author", {}).get("date", "")
        lines.append(f"[{date}] {msg}")
    return "\n".join(lines)


def get_latest_sha(owner: str, repo: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()["sha"]
```

### Step 5.5 — vector_store.py (adapted — minimal changes)

**File:** `rag-service/vector_store.py` — CREATE:

```python
"""
Adapted from the YouTube RAG vector_store.py.
Key change: accepts any text string (repo content or contributor text)
and optionally persists / loads the FAISS index to avoid recomputation.
"""

import os
import pickle
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from config import RAG_DATA_DIR


EMBEDDINGS = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


def _index_path(repo_id: str, scope: str) -> str:
    """Return the FAISS index file path for a given repo + scope."""
    return os.path.join(RAG_DATA_DIR, repo_id, f"{scope}.faiss")


def create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    """
    Create and persist a FAISS vector store from text.
    `scope` is either 'repo' or a contributor login like 'octocat'.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = splitter.create_documents([text])

    vector_store = FAISS.from_documents(chunks, EMBEDDINGS)

    # Persist to disk
    path = _index_path(repo_id, scope)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    vector_store.save_local(path)

    return vector_store


def load_vector_store(repo_id: str, scope: str = "repo") -> FAISS | None:
    """Load a persisted FAISS index, or return None if it doesn't exist."""
    path = _index_path(repo_id, scope)
    if not os.path.exists(path):
        return None
    return FAISS.load_local(path, EMBEDDINGS, allow_dangerous_deserialization=True)


def get_or_create_vector_store(
    text: str, repo_id: str, scope: str = "repo"
) -> FAISS:
    """Load from disk if available, otherwise create and save."""
    vs = load_vector_store(repo_id, scope)
    if vs is not None:
        return vs
    return create_vector_store(text, repo_id, scope)
```

### Step 5.6 — rag_pipeline.py (adapted prompts)

**File:** `rag-service/rag_pipeline.py` — CREATE:

```python
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
```

### Step 5.7 — main.py (FastAPI server with all endpoints)

**File:** `rag-service/main.py` — CREATE:

```python
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
    In a real implementation, look this up from a shared DB or cache.
    Here we embed owner/repo in the index directory metadata file.
    """
    import os, json
    meta_path = f"./rag_data/{repo_id}/meta.json"
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Repo not ingested yet.")
    with open(meta_path) as f:
        meta = json.load(f)
    return meta["owner"], meta["repo_name"]


def _save_meta(repo_id: str, owner: str, repo_name: str):
    import os, json
    os.makedirs(f"./rag_data/{repo_id}", exist_ok=True)
    with open(f"./rag_data/{repo_id}/meta.json", "w") as f:
        json.dump({"owner": owner, "repo_name": repo_name}, f)


# ── Endpoints ──────────────────────────────────────────────────

@app.post("/ingest")
def ingest_repo(data: IngestRequest):
    """
    Fetch all repository files from GitHub and create FAISS embeddings.
    Equivalent of fetch_transcript() → create_vector_store() in original pipeline.
    """
    latest_sha = get_latest_sha(data.owner, data.repo_name)
    repo_text = build_repo_text(data.owner, data.repo_name)
    create_vector_store(repo_text, data.repo_id, scope="repo")
    _save_meta(data.repo_id, data.owner, data.repo_name)
    return {"status": "ok", "latest_sha": latest_sha}


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
```

### Step 5.8 — Environment file for RAG service

**File:** `rag-service/.env` — CREATE:

```bash
GROQ_API_KEY=your_groq_api_key_here
GITHUB_TOKEN=your_github_pat_here
RAG_DATA_DIR=./rag_data
```

### Step 5.9 — Start the RAG service

```bash
cd rag-service
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## Phase 6 — Chat System

The chat system is built across multiple layers already described above.  This phase adds TanStack Query for the dynamic parts.

### Step 6.1 — Install TanStack Query

```bash
pnpm add @tanstack/react-query @tanstack/react-query-devtools
```

### Step 6.2 — Add QueryClient provider

**File:** `app/providers.tsx` — CREATE:

```typescript
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,  // 30 seconds
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

**File:** `app/layout.tsx` — WRAP children:

```typescript
import { Providers } from './providers';

// Inside the body:
<body className={`${inter.className} antialiased`}>
  <Providers>{children}</Providers>
</body>
```

### Step 6.3 — TanStack Query hooks

**File:** `app/hooks/use-chat.ts` — CREATE:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

/** Mutation hook for sending chat messages via the server action */
export function useSendMessage(chatId: string, repoId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (question: string) => {
      const { sendChatMessage } = await import('@/app/lib/actions');
      return sendChatMessage(chatId, repoId, question);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', chatId] });
    },
  });
}

/** Mutation hook for regenerating questions */
export function useRegenerateQuestions(
  repoId: string,
  contributorId: string,
  contributorLogin: string
) {
  return useMutation({
    mutationFn: async (questionType: string) => {
      const { generateQuestions } = await import('@/app/lib/actions');
      return generateQuestions(repoId, contributorId, contributorLogin, questionType);
    },
  });
}
```

> **Where to use TanStack Query hooks:**
> - `useSendMessage` → replace direct server action call in `ChatSection` to get loading/error states automatically.
> - `useRegenerateQuestions` → replace the questions button in `ContributorPanel`.

---

## Phase 7 — Optimisation & Caching

### Step 7.1 — Revalidation tags

**File:** `app/lib/actions.ts` — already uses `revalidatePath`.  For finer control, add tags:

```typescript
import { revalidateTag } from 'next/cache';

// In addRepository:
revalidateTag('repositories');

// In triggerRepoIngestion:
revalidateTag(`repo-${repoId}`);
```

**File:** `app/lib/data.ts` — Tag fetch calls:

**File:** `app/lib/data.ts` — Tag Prisma fetch calls with `unstable_cache`:

```typescript
import { unstable_cache } from 'next/cache';
import { prisma } from './db';

export const fetchRepositoriesByUser = unstable_cache(
  async (userId: string) => {
    return prisma.repository.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  },
  ['repositories'],
  { tags: ['repositories'], revalidate: 60 }
);
```

### Step 7.2 — Incremental embedding updates

Already handled in `rag-service/main.py` via the `/ingest` endpoint — it always fetches the latest SHA and rebuilds only if needed (via `get_or_create_vector_store`).

For **file-level incremental updates**, extend `/ingest`:

```python
# In rag-service/main.py — replace the ingest body with:

@app.post("/ingest")
def ingest_repo(data: IngestRequest):
    import os, json

    latest_sha = get_latest_sha(data.owner, data.repo_name)

    # Skip if already up to date
    meta_path = f"./rag_data/{data.repo_id}/meta.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
        if meta.get("last_sha") == latest_sha:
            return {"status": "up_to_date", "latest_sha": latest_sha}

    # Re-ingest
    repo_text = build_repo_text(data.owner, data.repo_name)
    create_vector_store(repo_text, data.repo_id, scope="repo")

    _save_meta(data.repo_id, data.owner, data.repo_name, latest_sha)
    return {"status": "ok", "latest_sha": latest_sha}
```

Update `_save_meta` to accept the SHA:

```python
def _save_meta(repo_id: str, owner: str, repo_name: str, last_sha: str = ""):
    import os, json
    os.makedirs(f"./rag_data/{repo_id}", exist_ok=True)
    with open(f"./rag_data/{repo_id}/meta.json", "w") as f:
        json.dump({"owner": owner, "repo_name": repo_name, "last_sha": last_sha}, f)
```

### Step 7.3 — HTTP caching for GitHub API calls

**File:** `app/lib/github.ts` — Add Next.js fetch cache options:

```typescript
// For infrequently changing data (metadata):
const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
  headers,
  next: { revalidate: 3600 },  // cache 1 hour
});

// For contributor list (changes rarely):
const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=30`, {
  headers,
  next: { revalidate: 1800 },  // cache 30 min
});

// For latest SHA (must be fresh):
const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/HEAD`, {
  headers,
  cache: 'no-store',
});
```

---

## Feature Mapping Table

| Existing (Invoice Dashboard) | New (GitHub Evaluator) | File |
|---|---|---|
| `/dashboard/invoices` | `/dashboard/repos` | `app/dashboard/repos/page.tsx` |
| `/dashboard/invoices/[id]/edit` | `/dashboard/repos/[id]` (detail) | `app/dashboard/repos/[id]/page.tsx` |
| `/dashboard/customers` | (merged into repo detail) | removed |
| `fetchFilteredInvoices()` | `fetchFilteredRepositories()` | `app/lib/data.ts` |
| `fetchInvoicesPages()` | `fetchRepositoryPages()` | `app/lib/data.ts` |
| `fetchCustomers()` | `fetchContributorsByRepo()` | `app/lib/data.ts` |
| `createInvoice()` server action | `addRepository()` server action | `app/lib/actions.ts` |
| `deleteInvoice()` server action | `deleteRepository()` server action | `app/lib/actions.ts` |
| `<InvoicesTable />` | `<RepoTable />` | `app/ui/repos/table.tsx` |
| `<Search />` | `<Search />` (reused as-is) | `app/ui/search.tsx` |
| `<Pagination />` | `<Pagination />` (reused as-is) | `app/ui/pagination.tsx` |
| `<SideNav />` | `<SideNav />` (reused, new links) | `app/ui/dashboard/sidenav.tsx` |
| `InvoiceForm` type | `Repository`, `Contributor` types | `app/lib/definitions.ts` |
| `customers` table | `contributors` table | Prisma migration |
| `invoices` table | `repositories` table | Prisma migration |
| Revenue chart streaming | Summary streaming via Suspense | `app/dashboard/repos/[id]/page.tsx` |
| `loading.tsx` skeleton | `RepoTableSkeleton` | `app/ui/repos/table-skeleton.tsx` |
| `error.tsx` | `error.tsx` per route | `app/dashboard/repos/[id]/error.tsx` |
| `notFound()` | `notFound()` (same pattern) | same pattern |
| `authenticate()` | `authenticate()` (unchanged) | `app/lib/actions.ts` |
| `revalidatePath` | `revalidatePath` + `revalidateTag` | same pattern |
| `generatePagination()` util | `generatePagination()` (reused) | `app/lib/utils.ts` |

---

## TanStack Query Usage Rules

### ✅ USE TanStack Query for:

| Feature | Why |
|---|---|
| Chat message sending | Need optimistic updates, loading state, error retry |
| Question regeneration | Stateful mutation with pending/error feedback |
| Contributor switching | Client-side re-fetch of contributor data |
| Repo comparison (future) | Parallel queries across two repos |

### ❌ DO NOT use TanStack Query for:

| Feature | Why |
|---|---|
| Initial repo list fetch | Server component — no client hydration needed |
| Repo metadata on detail page | Server component with `async/await` |
| Contributor list | Fetched once per page load in server component |
| Static summaries | Cached server action results |
| Authentication | NextAuth handles this |

---

## GitHub API Reference

| Data | Endpoint | Used in |
|---|---|---|
| Repo metadata | `GET /repos/{owner}/{repo}` | `fetchRepoMetadata()` |
| Contributors | `GET /repos/{owner}/{repo}/contributors` | `fetchContributors()` |
| Commits by contributor | `GET /repos/{owner}/{repo}/commits?author={login}` | `fetchCommitsByContributor()` |
| File tree | `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` | `fetchFileTree()` |
| File content | `GET /repos/{owner}/{repo}/contents/{path}` | `fetchFileContent()` |
| Latest SHA | `GET /repos/{owner}/{repo}/commits/HEAD` | `fetchLatestCommitSha()` |

> Rate limits: 60 req/hr unauthenticated → 5000 req/hr with GitHub PAT.  Always use a token.

---

## Comparison Feature (Future Extension)

Add a comparison page at `/dashboard/compare`:

1. Accept two GitHub URLs.
2. Call `GET /repos/{owner}/{repo}` for both in parallel (`Promise.all`).
3. Generate embeddings for both via `/ingest` on the Python service.
4. Add a `/compare` endpoint to the Python service that retrieves top-k chunks from both FAISS indexes and passes them to the LLM with a comparison prompt.
5. Display side-by-side diff UI reusing Tailwind grid layout.

---

## Summary: Execution Order

```
Phase 1: Cleanup           → delete/rename files
Phase 2: GitHub lib        → create app/lib/github.ts
Phase 3: Database          → Prisma setup + schema + migrate + db.ts + auth.ts + data.ts + actions.ts
Phase 4: UI                → nav, pages, repo components
Phase 5: Python RAG        → rag-service/ directory + all Python files
Phase 6: Chat + TanStack   → providers, hooks
Phase 7: Optimisation      → cache tags, incremental embeddings, HTTP cache
```

> Follow phases strictly.  Each phase depends on the previous one being complete.
> After Phase 3, run `npx prisma migrate dev --name init` to create database tables and generate the Prisma Client.
> After Phase 5, start the Python service before testing RAG features.
