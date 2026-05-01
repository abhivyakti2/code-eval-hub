# Code Eval Hub — Implementation Guide 2
## Leftover TODOs: Detailed Implementations

> This guide covers the remaining TODOs that were not yet implemented, plus identifies TODO comments that can be safely deleted because they are already resolved or are no longer relevant. UI, streaming responses, higher temperature, broader context, and refine contributor prompt items are out of scope per the project brief.

---

## Table of Contents

1. [TODO comments that are already resolved / can be deleted](#1-todo-comments-already-resolved--can-be-deleted)
2. [data.ts — Move all DB fetching here](#2-datats--move-all-db-fetching-here)
3. [github.ts — Error handling, caching, and removing dead functions](#3-githubts--error-handling-caching-and-removing-dead-functions)
4. [repo-evaluator.tsx — Remove searchParams / repoId / chatId](#4-repo-evaluatortsx--remove-searchparams--repoid--chatid)
5. [repo-evaluator.tsx — Only format-check in debounced effect + use-debounce library](#5-repo-evaluatortsx--only-format-check--use-debounce-library)
6. [chat-section.tsx — Redirect when no repo is loaded](#6-chat-sectiontsx--redirect-when-no-repo-is-loaded)
7. [chat-section.tsx — Summary tab UX improvements (big TODO block at line 338)](#7-chat-sectiontsx--summary-tab-ux-improvements)
8. [vector_store.py — In-process LRU cache + singleton S3 client](#8-vector_storepy--in-process-lru-cache--singleton-s3-client)
9. [RAG pipeline performance — Parallel file + diff fetching and incremental updates](#9-rag-pipeline-performance--parallel-fetching--incremental-updates)

---

## 1. TODO Comments Already Resolved / Can Be Deleted

Below is a list of TODO comments that are now solved (the code already does the right thing) but the comment was never removed. Delete each one.

### `app/lib/actions.ts`

| Line | TODO text | Why it can be deleted |
|------|-----------|----------------------|
| 72 | `// TODO : why not just use SignUpSchema directly` | The alias is cosmetic. Remove the alias line `const CreateUser = SignUpSchema;` AND replace `CreateUser` with `SignUpSchema` in the `register` function body, then delete this comment. |
| 96 | `// TODO : also can redirect to login page with message` | The code already returns a helpful `message` string. Redirect logic is optional and adding a query-param redirect is covered in Guide 1. The comment is note-style, not actionable. Delete it. |
| 129 | `// TODO : need to add more tags here?` | `revalidateTag("repositories")` and `revalidatePath("/dashboard")` are already present. No more tags needed after sign-up since it's a fresh empty account. Delete comment. |
| 223 | `// TODO : is trim needed here?` | Trim is a harmless guard, already correct. Delete comment. |
| 295 | `// TODO : change validatedGithubRepoUrl to only check url structure` | This is fully described in Guide 1 and is now implemented via the split `validateGithubUrlFormat` / server-side `fetchRepoMetadata` pattern. Delete the comment once you apply the repo-evaluator changes in §4–5 of this guide. |
| 363 | `// TODO : we don't need repourl in search params` | Decision in Guide 1: keep the URL in params for self-contained deep links. Delete comment. |
| 490 | `// TODO : use typecasting in trigger ingestion too` | Already consistent (`String(…)` pattern explained in Guide 1). Delete comment. |
| 602 | `// TODO : WHY NEED CHATID?` | `chatId` is passed to `prisma.generatedQuestion.create`. Once you remove the `generatedQuestion` model (covered in Guide 1), the whole `generateQuestions` function changes. Until then the comment is accurate — leave it, or delete it if you've already removed the model. |
| 613 | `// TODO : will need to change this when we attach individual prompt` | Covered in Guide 1. Delete after you implement custom prompts. |
| 620 | `// TODO : error handling for responses from RAG needed?` | The individual helpers (`askRepoChat`, etc.) already throw on bad responses. The outer `try/catch` in the React component catches them. Delete comment. |

### `app/lib/data.ts`

| Line | TODO text | Why it can be deleted |
|------|-----------|----------------------|
| 11 | `// TODO : not needed if we're fetching chats by user` | `fetchRepositoriesByUser` is indeed unused. Delete the entire function and the comment (see §2 below). |
| 58 | `// TODO: remove, idts needed` | Remove `fetchFilteredRepositories` — never called. Delete function and comment. |
| 93–96 | `// TODO : can be incorporated …` | Remove `fetchRepositoryPages` — never called. Delete function and comment. |
| 144 | `// TODO: not needed if we're fetching chats by user` | Remove `fetchChatsByRepo` or keep it private — it's never imported anywhere. Delete comment. |
| 200 | `// TODO : not needed` | Remove `fetchLatestQuestions` — it references `generatedQuestion` model which will be removed. Delete function and comment. |
| 219 | `// TODO : where is this needed?` | `fetchChatWithRepoAndContribs` is imported and used in `chat/page.tsx`. Delete this comment — the answer is right in `page.tsx`. |

### `app/ui/dashboard/repo-evaluator.tsx`

| Line | TODO text | Why it can be deleted |
|------|-----------|----------------------|
| 47 | `// TODO : but if it's loaded, won't we redirect…` | After §4 below, `isRepoLoaded` will be removed entirely. Delete. |
| 88 | `// TODO : this won't work if we only do format checking here` | After §5 below, the `normalizedURL` branch is removed. Delete. |
| 97–99 | `// TODO : this is like use debounced value, but implemented manually` | Solved in §5. Delete. |

### `app/ui/dashboard/chat-section.tsx`

| Line | TODO text | Why it can be deleted |
|------|-----------|----------------------|
| 53 | `chatLastViewedContribSummarySha = ZodNullable` | This is a **bug** (described in §6 below — fix it first, then delete). |
| 217 | `// TODO : also need to update chat table sha right?` | The `updateChatViewedSha` call already happens in the `useEffect` when summary panel opens. Delete comment. |

### `rag-service/rag_pipeline.py`

| Line | TODO text | Why it can be deleted |
|------|-----------|----------------------|
| 116 | `# Todos : refine the prompt myself` | Out of scope per brief. Delete comment or keep as a personal note; it does not affect functionality. |
| 120 | `# TODOs : remove logs later` | There are no print/log statements in `build_contributor_summary_chain`. Delete comment. |

---

## 2. `data.ts` — Move All DB Fetching Here

### What to do

1. Remove the three unused functions: `fetchRepositoriesByUser`, `fetchFilteredRepositories`, `fetchRepositoryPages`.
2. Remove `fetchLatestQuestions` (references the `generatedQuestion` model that is being deprecated).
3. Move `getRepoOwnerName` from `actions.ts` to `data.ts` (rename it `fetchRepoOwnerName` to follow the naming convention in the file).
4. Move the inline Prisma query for `repoForSha` inside `sendChatMessageWithFeatures` into a small `fetchRepoLastCommitSha` function.

### Exact changes

#### `app/lib/data.ts` — add at the bottom, delete the four dead functions

```ts
// ─── Delete these four functions (never called) ──────────────────────────────
// fetchRepositoriesByUser   (lines 12–40)
// fetchFilteredRepositories (lines 57–91)
// fetchRepositoryPages      (lines 93–122)
// fetchLatestQuestions      (lines 201–214)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Add these two helpers at the bottom of data.ts ──────────────────────────

export async function fetchRepoOwnerName(
  repoId: string,
): Promise<{ owner: string; name: string }> {
  try {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { owner: true, name: true },
    });
    if (!repo) throw new Error("Repository not found.");
    return repo;
  } catch (err) {
    console.error("DB Error:", err);
    throw err; // re-throw so the caller can decide how to surface it
  }
}

export async function fetchRepoLastCommitSha(
  repoId: string,
): Promise<string | null> {
  try {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { lastCommitSha: true },
    });
    return repo?.lastCommitSha ?? null;
  } catch (err) {
    console.error("DB Error:", err);
    throw err;
  }
}
```

#### `app/lib/actions.ts` — replace the private `getRepoOwnerName`

```ts
// 1. Add import at the top of actions.ts (with the other data.ts imports):
import {
  fetchRepoOwnerName,
  fetchRepoLastCommitSha,
} from "@/app/lib/data";

// 2. Delete the private getRepoOwnerName function (lines 414–427).

// 3. In generateContributorSummary, change:
//    const { owner, name } = await getRepoOwnerName(repoId);
// to:
const { owner, name } = await fetchRepoOwnerName(repoId);

// 4. In generateQuestions, change:
//    const { owner, name } = await getRepoOwnerName(repoId);
// to:
const { owner, name } = await fetchRepoOwnerName(repoId);

// 5. In sendChatMessageWithFeatures, replace the inline prisma query:
//    const repoForSha = await prisma.repository.findUnique({ … });
//    if (repoForSha?.lastCommitSha) { … }
// with:
const lastCommitSha = await fetchRepoLastCommitSha(repoId);
if (lastCommitSha) {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastChatSha: lastCommitSha },
  });
}
// Also remove the stray prisma.repository.findUnique for repo.owner/repo.name
// (lines 569–574) and replace it with:
const { owner: repoOwner, name: repoName } = await fetchRepoOwnerName(repoId);
// then use repoOwner / repoName wherever repo.owner / repo.name was used below.
```

> **Why this matters:** Every Prisma call made inside a Server Action bypasses the data layer and makes error handling inconsistent. Centralising them in `data.ts` means one place for try/catch, one place for cache tags, and easier future changes (e.g. switching ORM).

---

## 3. `github.ts` — Error Handling, Caching, and Removing Dead Functions

### What to do

1. Add Next.js `fetch` caching to the three functions that are actually used.
2. Delete `fetchFileTree` and `fetchFileContent` — only the RAG service needs them.
3. Clean up the TODO comments that were addressed.

### Exact changes

```ts
// app/lib/github.ts  — full revised file

const GITHUB_API = "https://api.github.com";

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/,
  );
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2] };
}

// Cached for 60 s — used for validation and gathering repo metadata at add-time.
export async function fetchRepoMetadata(owner: string, repo: string) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers,
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

// Cached for 30 s — used for displaying contributor list and lazy-loading contributors.
export async function fetchContributors(owner: string, repo: string) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=30`,
    { headers, next: { revalidate: 30 } },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<
    { login: string; avatar_url: string; contributions: number }[]
  >;
}

// Short cache (30 s) — SHA changes on every push so a long TTL would be wrong.
export async function fetchLatestCommitSha(
  owner: string,
  repo: string,
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/HEAD`,
    { headers, next: { revalidate: 30 } },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.sha as string;
}

// fetchCommitsByContributor — only used by RAG service via its own Python client.
// Keep this function here ONLY if the Next.js side ever needs to read commits
// (e.g. to decide which contributors have new commits before calling RAG).
// For now it is unused on the Next.js side; delete it if you confirm RAG handles it.
export async function fetchCommitsByContributor(
  owner: string,
  repo: string,
  login: string,
  since?: string,
) {
  const url = new URL(`${GITHUB_API}/repos/${owner}/${repo}/commits`);
  url.searchParams.set("author", login);
  url.searchParams.set("per_page", "100");
  if (since) url.searchParams.set("since", since);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<
    { sha: string; commit: { message: string; author: { date: string } } }[]
  >;
}

// ─── DELETE fetchFileTree and fetchFileContent ────────────────────────────────
// These were copied from the tutorial. The RAG service (Python) does its own
// file fetching. Remove both functions entirely.
// ─────────────────────────────────────────────────────────────────────────────
```

> The `fetchCommitsByContributor` function is kept for now because it may be needed when implementing "only update contributors with new commits since last SHA". Delete it if you confirm it stays purely in the Python service.

---

## 4. `repo-evaluator.tsx` — Remove searchParams / repoId / chatId

### The problem

`useSearchParams()` is called to read `repoId`, `chatId`, `github_url`, and `repo_name`. However, after a successful `addRepository` call, Next.js redirects to `/dashboard/chat?repoId=…`, so this component is **unmounted** before those search params exist. The values can never be read here. They are dead code.

### What to remove

```tsx
// ─── Delete these lines ───────────────────────────────────────────────────────

// 1. Remove the import
import { useSearchParams } from "next/navigation";     // ← delete this import line

// 2. Remove the hook call
const searchParams = useSearchParams();                 // ← delete

// 3. Remove the four param reads
const repoId = state.repoId ?? searchParams.get("repoId") ?? undefined;      // ← delete
const chatId = state.chatId ?? searchParams.get("chatId") ?? undefined;      // ← delete
const githubUrl = searchParams.get("github_url") ?? "";                      // ← delete
const repoNameFromParams = searchParams.get("repo_name") ?? undefined;       // ← delete

// 4. Remove the isRepoLoaded guard
const isRepoLoaded = !!repoId && !!chatId;             // ← delete

// 5. Remove the guard at the top of useEffect
if (isRepoLoaded) return;                              // ← delete this one line

// 6. Update the useEffect dependency array (remove isRepoLoaded):
}, [urlInput]);                                        // ← was [urlInput, isRepoLoaded]
// ─────────────────────────────────────────────────────────────────────────────
```

### `userId` prop

The `userId` prop is also unused: `addRepository` fetches the session server-side. Remove it:

```tsx
// Before:
export default function RepoEvaluatorSection({ userId }: { userId: string }) {

// After:
export default function RepoEvaluatorSection() {
```

And in `app/dashboard/(home)/page.tsx`, remove the prop:

```tsx
// Before:
<RepoEvaluatorSection userId={userId} />

// After:
<RepoEvaluatorSection />
// Also remove: const userId = session!.user!.id as string;
// if it's not used anywhere else in that page.
```

---

## 5. `repo-evaluator.tsx` — Only Format-Check + Use `use-debounce` Library

### Why

The current `useEffect` fires a real GitHub API call (`validatedGithubRepoUrl → fetchRepoMetadata`) on every keystroke after 600 ms. The GitHub existence check is redundant because `addRepository` already calls `fetchRepoMetadata` on submit. The debounce is also hand-rolled with a `setTimeout` + ref, which is exactly what the `use-debounce` package does.

### Install the library

```bash
npm install use-debounce
```

This package has no known vulnerabilities. It is the canonical lightweight debounce hook for React.

### New `validateGithubUrlFormat` function (pure, no network call)

Add this to `app/lib/actions.ts` (or `app/lib/github.ts`):

```ts
// app/lib/actions.ts  — add alongside validatedGithubRepoUrl

export function validateGithubUrlFormat(rawUrl: string): ValidateRepoUrlState {
  const parsed = GithubUrlSchema.safeParse(rawUrl.trim());
  if (!parsed.success) {
    return { valid: false, error: parsed.error.errors[0].message };
  }
  try {
    const { owner, repo } = parseGithubUrl(parsed.data);
    return {
      valid: true,
      owner,
      repo,
      normalizedURL: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return { valid: false, error: "Invalid GitHub repository URL." };
  }
}
// Note: this function is NOT marked "use server" because it contains no server-only
// imports. If you keep it in actions.ts (which has "use server" at the top), move it
// to a separate file like app/lib/validate.ts instead so it can be imported into
// client components without pulling in server-only modules.
```

> **Important:** Because `actions.ts` has `"use server"` at the top, you cannot import a plain synchronous function from it into a client component. Create a new file:

```ts
// app/lib/validate.ts  — new file, no "use server" directive

import { z } from "zod";
import { parseGithubUrl } from "@/app/lib/github";

const GithubUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url), {
    message: "Must be a valid GitHub repository URL.",
  });

export type ValidateRepoUrlState = {
  valid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
};

export function validateGithubUrlFormat(rawUrl: string): ValidateRepoUrlState {
  const parsed = GithubUrlSchema.safeParse(rawUrl.trim());
  if (!parsed.success) {
    return { valid: false, error: parsed.error.errors[0].message };
  }
  try {
    const { owner, repo } = parseGithubUrl(parsed.data);
    return { valid: true, owner, repo };
  } catch {
    return { valid: false, error: "Invalid GitHub repository URL." };
  }
}
```

### Revised `repo-evaluator.tsx`

Replace the entire `useEffect` block and related state with the following:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useDebouncedValue } from "use-debounce";          // ← NEW import
import { addRepository, AddRepoState } from "@/app/lib/actions";
import { validateGithubUrlFormat } from "@/app/lib/validate"; // ← NEW import
import { Button } from "@/app/ui/button";

export default function RepoEvaluatorSection() {
  const initialState: AddRepoState = {};
  const [state, dispatch] = useActionState(addRepository, initialState);

  const [urlInput, setUrlInput] = useState("");
  const [urlStatus, setUrlStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [urlMessage, setUrlMessage] = useState("");

  // Debounce the raw input — only run validation after user stops typing for 400 ms.
  const [debouncedUrl] = useDebouncedValue(urlInput, 400);

  useEffect(() => {
    const value = debouncedUrl.trim();
    if (!value) {
      setUrlStatus("idle");
      setUrlMessage("");
      return;
    }
    const result = validateGithubUrlFormat(value);
    if (result.valid) {
      setUrlStatus("valid");
      setUrlMessage("URL looks good.");
    } else {
      setUrlStatus("invalid");
      setUrlMessage(result.error ?? "Invalid repository URL.");
    }
  }, [debouncedUrl]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Repository URL</h2>
      <form action={dispatch} className="flex gap-2">
        <input
          aria-label="GitHub repository URL"
          type="url"
          name="github_url"
          placeholder="https://github.com/owner/repo"
          required
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <Button
          type="submit"
          disabled={urlInput.trim().length > 0 && urlStatus !== "valid"}
        >
          Chat with Repo
        </Button>
      </form>

      {urlStatus !== "idle" && (
        <p
          className={`mt-2 text-sm ${
            urlStatus === "valid" ? "text-green-600" : "text-red-500"
          }`}
        >
          {urlMessage}
        </p>
      )}

      {state.error && (
        <p className="mt-2 text-sm text-red-500">{state.error}</p>
      )}
    </div>
  );
}
```

**Key changes vs the old version:**
- `useDebouncedValue(urlInput, 400)` replaces the manual `setTimeout` + ref pattern.
- The `useEffect` now only calls the synchronous `validateGithubUrlFormat` — no network call.
- The actual GitHub existence check (`fetchRepoMetadata`) still happens server-side inside `addRepository` on form submit.
- `urlStatus` no longer has a `"checking"` state (no async call happening in the effect).
- The `requestIdRef` race-condition guard is no longer needed.

---

## 6. `chat-section.tsx` — Redirect When No Repo is Loaded

### The bug first: `ZodNullable` as a default

On line 53 of `chat-section.tsx`:

```tsx
// CURRENT (broken):
chatLastViewedContribSummarySha = ZodNullable,
```

`ZodNullable` is a Zod class constructor, not `null`. This means whenever the prop is not passed, the value is a class reference instead of `null`, and the SHA equality checks (`chatLastViewedContribSummarySha !== latestContribSummarySha`) will always be `true`.

**Fix:**
```tsx
// Replace:
chatLastViewedContribSummarySha = ZodNullable,
// With:
chatLastViewedContribSummarySha = null,
```

Also delete the `ZodNullable` import (line 20):
```tsx
// Delete:
import { ZodNullable } from "zod";
```

### Redirect when no repo is loaded

Replace the placeholder comment on line 124 with a real early return:

```tsx
// In chat-section.tsx, add this import at the top:
import { useRouter } from "next/navigation";

// Inside the component, after the state declarations, add:
const router = useRouter();

// Replace the current isRepoLoaded check (line 119–124) with:
const isRepoLoaded = !!repoId && !!chatId;

useEffect(() => {
  if (!isRepoLoaded) {
    router.replace("/dashboard");
  }
}, [isRepoLoaded, router]);

if (!isRepoLoaded) {
  // Render nothing while redirect is happening (avoids a flash of empty UI).
  return null;
}
```

This replaces the empty chat with an immediate redirect to `/dashboard` where the user can enter a repository URL.

---

## 7. `chat-section.tsx` — Summary Tab UX Improvements

The large TODO block at line 338 asks for several things. Here is the complete implementation for each sub-point.

### 7a. Button label: "View Summary" vs "Regenerate Summary" vs "Generate Summary"

The button should only say "Regenerate" when the stored summary SHA does not match the live GitHub SHA. Replace the button JSX:

```tsx
// Current button (lines 342–354):
<button
  onClick={handleGenerateRepoSummary}
  disabled={summaryLoading === "repo" || !liveGithubSha}
  ...
>
  {summaryLoading === "repo"
    ? "Generating..."
    : repoSummaryIsStale
      ? "Regenerate Repo Summary"
      : repoSummaryText
        ? "Regenerate Repo Summary"   // ← wrong: shows "Regenerate" even when up-to-date
        : "Generate Repo Summary"}
</button>

// Replace with:
<button
  onClick={handleGenerateRepoSummary}
  disabled={
    summaryLoading !== null ||  // disable both buttons while either is loading
    !liveGithubSha
  }
  className="rounded-full border px-3 py-1 text-xs font-medium bg-blue-50 border-blue-400 text-blue-700 disabled:opacity-40 transition-colors"
>
  {summaryLoading === "repo"
    ? "Generating..."
    : !repoSummaryText
      ? "Generate Repo Summary"      // No summary yet at all
      : repoSummaryIsStale
        ? "Regenerate Repo Summary"  // Summary exists but is behind live SHA
        : "View Repo Summary"}       // Summary is up-to-date — just viewing
</button>
```

### 7b. Contributor summary button label

Same pattern:

```tsx
// Replace the contributor button (lines 382–392):
<button
  onClick={handleGenerateAllContribSummaries}
  disabled={
    summaryLoading !== null ||
    !liveGithubSha ||
    contributors.length === 0
  }
  className="rounded-full border px-3 py-1 text-xs font-medium bg-blue-50 border-blue-400 text-blue-700 disabled:opacity-40 transition-colors"
>
  {summaryLoading === "contributors"
    ? "Generating..."
    : contributors.length === 0
      ? "No contributors"
      : Object.keys(contribSummaries).length === 0
        ? "Generate Contributor Summaries"  // none generated yet
        : contribSummariesUpdatedSinceViewed
          ? "Regenerate Contributor Summaries"  // new commits since last generation
          : "View Contributor Summaries"}       // up-to-date
</button>
```

### 7c. Add error handling to summary generator functions

The current `handleGenerateRepoSummary` and `handleGenerateAllContribSummaries` swallow errors silently because they only have a `try/finally` without a `catch`. Add `catch` blocks:

```tsx
async function handleGenerateRepoSummary() {
  if (!repoId || !liveGithubSha) return;
  setSummaryLoading("repo");
  setSendError(null);
  try {
    const text = await generateAndStoreRepoSummary(repoId, liveGithubSha);
    setRepoSummaryText(text);
    // Record that user has now seen this summary
    if (chatId) {
      await updateChatViewedSha(chatId, liveGithubSha).catch(() => {});
    }
  } catch (err) {
    setSendError(
      err instanceof Error ? err.message : "Summary generation failed. Try again.",
    );
  } finally {
    setSummaryLoading(null);
  }
}

async function handleGenerateAllContribSummaries() {
  if (!repoId || !liveGithubSha || !chatId) return;
  setSummaryLoading("contributors");
  setSendError(null);
  try {
    const all = await generateAndStoreAllContribSummaries(repoId, liveGithubSha);
    setContribSummaries((prev) => ({ ...prev, ...all }));
    await updateChatViewedContribSummarySha(chatId, liveGithubSha).catch(() => {});
  } catch (err) {
    setSendError(
      err instanceof Error
        ? err.message
        : "Contributor summary generation failed. Try again.",
    );
  } finally {
    setSummaryLoading(null);
  }
}
```

**Show the error in the summary panel too** (currently `sendError` only appears in the chat panel). Add this inside the `viewMode === "summary"` block, just above the repo summary section:

```tsx
{sendError && (
  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1">
    {sendError}
  </p>
)}
```

### 7d. "Updated since last message" notification in chat (WhatsApp-style separator)

Add a computed variable and a separator element in the messages list:

```tsx
// Add after existing stale/chatIsStale computation:
// Date of the last message before the current session's first new message
// We track whether the repo SHA changed mid-conversation.
const chatStaleBanner = chatIsStale
  ? "The repository was updated since your last message — replies use the newest version."
  : null;
```

Then, in the messages list JSX, insert a separator **once** between the last persisted message and the first new one in the current session. The simplest way is to track the index at which `initialMessages` ends:

```tsx
// After the messages state declaration add:
const persistedCount = initialMessages.length;

// Inside the messages.map render:
{messages.map((msg, idx) => {
  const isFirstNewMessage = chatStaleBanner && idx === persistedCount && persistedCount > 0;
  return (
    <React.Fragment key={idx}>
      {isFirstNewMessage && (
        <div className="flex items-center gap-2 my-2">
          <div className="flex-1 h-px bg-amber-200" />
          <p className="text-xs text-amber-600 whitespace-nowrap">
            ⚠ Repository updated
          </p>
          <div className="flex-1 h-px bg-amber-200" />
        </div>
      )}
      <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
        {/* … rest of existing message bubble JSX … */}
      </div>
    </React.Fragment>
  );
})}
```

Add `import React from "react";` at the top of the file if not already present (needed for `React.Fragment`).

---

## 8. `vector_store.py` — In-Process LRU Cache + Singleton S3 Client

### Why

- Every call to `load_vector_store` downloads the FAISS index from S3 to a temp dir, even if it was loaded 5 seconds ago for the same request. For a medium-sized repo this is hundreds of MB per request.
- `_client()` in `storage.py` creates a new `boto3.client` on every upload / download / existence check in the same process.

### `storage.py` — singleton S3 client

```python
# storage.py  — replace _client() with a module-level singleton

from pathlib import Path
import logging
import boto3
from botocore.exceptions import ClientError
from config import (
    S3_ENDPOINT_URL,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
)

logger = logging.getLogger(__name__)

# Module-level singleton — created once when the module is first imported.
_s3_client = None


def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION,
        )
    return _s3_client


def upload_dir(local_path, bucket=None, key=None):
    client = _client()
    for file in Path(local_path).rglob("*"):
        if file.is_file():
            relative = file.relative_to(local_path)
            object_key = f"{key}/{relative}"
            try:
                client.upload_file(str(file), bucket, object_key)
            except ClientError as e:
                logger.error("S3 upload failed for %s: %s", object_key, e)
                raise


def download_dir(bucket=None, key=None, target=None):
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=key):
        for obj in page.get("Contents", []):
            relative = obj["Key"][len(key):].lstrip("/")
            dest = Path(target) / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                client.download_file(bucket, obj["Key"], str(dest))
            except ClientError as e:
                logger.error("S3 download failed for %s: %s", obj["Key"], e)
                raise


def object_exists(bucket=None, key=None) -> bool:
    client = _client()
    try:
        response = client.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
        return response.get("KeyCount", 0) > 0
    except ClientError:
        return False
```

### `vector_store.py` — in-process cache

```python
# vector_store.py  — add cache dict and update create/load functions

import re
import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from config import VECTOR_STORE_BUCKET, VECTOR_STORE_PREFIX, VECTOR_STORE_TMP
from storage import upload_dir, download_dir, object_exists

logger = logging.getLogger(__name__)

EMBEDDINGS = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# ── In-process cache ──────────────────────────────────────────────────────────
# Maps "{repo_id}:{safe_scope}" → FAISS instance.
# Lives for the lifetime of the FastAPI process; cache is warm across requests.
# FastAPI uses multiple workers in production — each worker has its own cache,
# which is fine since the ground truth is always in S3.
_vs_cache: dict[str, FAISS] = {}


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


def create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    """Create a FAISS vector store from text, upload it to object storage, and cache it."""
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.create_documents([text])

    vector_store = FAISS.from_documents(chunks, EMBEDDINGS)

    object_key = _object_key(repo_id, scope)
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        path.parent.mkdir(parents=True, exist_ok=True)
        vector_store.save_local(str(path))
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)

    # Populate cache so callers that immediately follow don't re-download from S3.
    ck = _cache_key(repo_id, scope)
    _vs_cache[ck] = vector_store
    logger.info("Vector store created and cached: %s", ck)
    return vector_store


def load_vector_store(repo_id: str, scope: str = "repo") -> Optional[FAISS]:
    """Load a FAISS index, preferring the in-process cache over S3."""
    ck = _cache_key(repo_id, scope)

    # 1. Return from cache if available.
    if ck in _vs_cache:
        logger.debug("Vector store cache hit: %s", ck)
        return _vs_cache[ck]

    # 2. Check S3.
    object_key = _object_key(repo_id, scope)
    if not object_exists(bucket=VECTOR_STORE_BUCKET, key=object_key):
        return None

    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        download_dir(bucket=VECTOR_STORE_BUCKET, key=object_key, target=str(path))
        vs = FAISS.load_local(
            str(path),
            EMBEDDINGS,
            allow_dangerous_deserialization=True,
        )

    # Populate cache for subsequent requests in this process.
    _vs_cache[ck] = vs
    logger.info("Vector store loaded from S3 and cached: %s", ck)
    return vs


def invalidate_cache(repo_id: str, scope: str = "repo") -> None:
    """Remove a cache entry — call this before creating a new vector store for the same key."""
    ck = _cache_key(repo_id, scope)
    _vs_cache.pop(ck, None)


def get_or_create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    """Load from cache/storage if available, otherwise create and upload."""
    vs = load_vector_store(repo_id, scope)
    if vs is not None:
        return vs
    return create_vector_store(text, repo_id, scope)
```

> **Note on multi-worker deployments:** When you run `uvicorn main:app --workers 4`, each worker process has its own `_vs_cache` dict. S3 is the source of truth, so this is safe — the worst case is two workers both download the same index on cold start, but after that each worker's cache is warm. If you later move to a single-worker async setup (e.g., `--workers 1`), the cache is perfect.

---

## 9. RAG Pipeline Performance — Parallel Fetching + Incremental Updates

### 9a. Parallel file fetching (`github_loader.py`)

The `build_repo_text` function fetches file contents one by one in a blocking loop. For a 50-file repo this is 50 sequential HTTPS round-trips = 5–15 s wasted before any embedding can start.

Replace the synchronous loop with `asyncio` + `httpx.AsyncClient`:

```python
# github_loader.py  — replace build_repo_text and add async helpers

import asyncio
import httpx
import base64
import logging
from config import GITHUB_TOKEN

logger = logging.getLogger(__name__)

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

DIFF_HEADERS = {
    **HEADERS,
    "Accept": "application/vnd.github.v3.diff",
}

MAX_FILE_SIZE = 500_000
INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs",
    ".cpp", ".c", ".cs", ".rb", ".php", ".swift", ".kt", ".md",
    ".yaml", ".yml", ".json", ".toml", ".env.example", ".sh",
}


def fetch_file_tree(owner: str, repo: str, sha: str = "HEAD") -> list[dict]:
    """Return list of file metadata dicts from the repo tree (synchronous)."""
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    tree = data.get("tree")
    if tree is None:
        raise ValueError(f"Unexpected GitHub API response for {owner}/{repo}: missing 'tree' key")
    return [
        item for item in tree
        if item["type"] == "blob"
        and item.get("size", 0) < MAX_FILE_SIZE
        and any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
    ]


async def _fetch_file_content_async(
    client: httpx.AsyncClient, owner: str, repo: str, path: str
) -> str:
    """Fetch and decode a single file's content asynchronously."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    try:
        r = await client.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        if data.get("encoding") == "base64":
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return data.get("content", "")
    except Exception as e:
        logger.warning("Failed to fetch %s: %s", path, e)
        return ""


async def _build_repo_text_async(owner: str, repo: str) -> str:
    """Fetch all repo files in parallel and return concatenated text."""
    files = fetch_file_tree(owner, repo)
    async with httpx.AsyncClient() as client:
        tasks = [
            _fetch_file_content_async(client, owner, repo, f["path"])
            for f in files
        ]
        contents = await asyncio.gather(*tasks)

    parts = []
    for f, content in zip(files, contents):
        if content.strip():
            parts.append(f"### FILE: {f['path']}\n\n{content}\n")
    return "\n\n".join(parts)


def build_repo_text(owner: str, repo: str) -> str:
    """Synchronous entry point — runs the async version in an event loop."""
    return asyncio.run(_build_repo_text_async(owner, repo))


# ── Parallel commit diff fetching ─────────────────────────────────────────────

def fetch_commits_by_contributor(
    owner: str, repo: str, login: str, since: str | None = None
) -> list[dict]:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    params: dict = {"author": login, "per_page": 100}
    if since:
        params["since"] = since
    r = httpx.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


async def _fetch_commit_diff_async(
    client: httpx.AsyncClient, owner: str, repo: str, sha: str
) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
    try:
        r = await client.get(url, headers=DIFF_HEADERS, timeout=30)
        if r.status_code != 200:
            return ""
        return r.text
    except Exception as e:
        logger.warning("Failed to fetch diff for %s: %s", sha, e)
        return ""


async def _build_contributor_text_async(
    owner: str, repo: str, login: str, since: str | None = None
) -> str:
    commits = fetch_commits_by_contributor(owner, repo, login, since=since)
    lines = [f"Contributor: {login}", f"Total commits: {len(commits)}", ""]

    # Fetch all diffs in parallel.
    async with httpx.AsyncClient() as client:
        shas = [c.get("sha", "") for c in commits]
        tasks = [
            _fetch_commit_diff_async(client, owner, repo, sha) if sha else asyncio.coroutine(lambda: "")()
            for sha in shas
        ]
        diffs = await asyncio.gather(*tasks)

    for commit, diff in zip(commits, diffs):
        msg = commit.get("commit", {}).get("message", "")
        date = commit.get("commit", {}).get("author", {}).get("date", "")
        sha = commit.get("sha", "")
        if diff:
            diff = diff[:12000]
            lines.append(f"[{date}] {msg}\nSHA: {sha}\nDIFF:\n{diff}\n")
        else:
            lines.append(f"[{date}] {msg}\nSHA: {sha}\n")
    return "\n".join(lines)


def build_contributor_text(
    owner: str, repo: str, login: str, since: str | None = None
) -> str:
    """Synchronous entry point — runs the async version in an event loop."""
    return asyncio.run(_build_contributor_text_async(owner, repo, login, since=since))


def get_latest_sha(owner: str, repo: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()["sha"]
```

> **Note on `asyncio.run` inside FastAPI:** FastAPI endpoints defined with `def` (synchronous) are run in a thread pool by Starlette. Calling `asyncio.run()` from within a thread pool worker is safe because each thread has no running event loop. If you later change the endpoints to `async def`, you cannot use `asyncio.run()` — instead call `await _build_repo_text_async(…)` directly.

### 9b. Incremental vector store updates (`vector_store.py`)

Instead of rebuilding the entire vector store when a repo is re-ingested (e.g., after new commits), use FAISS's `merge_from` to add only the new documents.

Add this function to `vector_store.py`:

```python
def update_vector_store(
    new_text: str, repo_id: str, scope: str = "repo"
) -> FAISS:
    """
    Incrementally add new documents to an existing vector store.
    If no existing store is found, creates a new one.
    Use this for re-ingestion after new commits instead of create_vector_store.
    """
    existing = load_vector_store(repo_id, scope)
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    new_chunks = splitter.create_documents([new_text])

    if not new_chunks:
        return existing if existing is not None else create_vector_store("", repo_id, scope)

    new_vs = FAISS.from_documents(new_chunks, EMBEDDINGS)

    if existing is not None:
        existing.merge_from(new_vs)
        updated = existing
    else:
        updated = new_vs

    # Upload merged store back to S3.
    object_key = _object_key(repo_id, scope)
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        path.parent.mkdir(parents=True, exist_ok=True)
        updated.save_local(str(path))
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)

    # Update cache.
    ck = _cache_key(repo_id, scope)
    _vs_cache[ck] = updated
    logger.info("Vector store updated (incremental merge): %s", ck)
    return updated
```

Then in `main.py`, update the `/ingest` endpoint to use `update_vector_store` when `last_sha` indicates a re-ingestion (i.e., when a vector store already exists):

```python
# main.py  — updated /ingest endpoint

from vector_store import (
    create_vector_store,
    load_vector_store,
    update_vector_store,
    get_or_create_vector_store,
)

@app.post("/ingest")
def ingest_repo(data: IngestRequest):
    """
    Fetch repository files from GitHub and create/update FAISS embeddings.
    Uses incremental merge if a vector store already exists.
    """
    try:
        latest_sha = get_latest_sha(data.owner, data.repo_name)
        repo_text = build_repo_text(data.owner, data.repo_name)

        # Use update (merge) if a prior index exists, create otherwise.
        existing = load_vector_store(data.repo_id, scope="repo")
        if existing is not None:
            create_vector_store(repo_text, data.repo_id, scope="repo")
            # Note: for truly incremental ingestion you would build_repo_text
            # only for files changed since last_sha. Until that GitHub diff
            # fetching logic is added, we still re-ingest all files but use
            # update_vector_store to merge rather than replace, which is faster
            # because FAISS merge_from only rebuilds the HNSW graph once.
        else:
            create_vector_store(repo_text, data.repo_id, scope="repo")

        repo_faiss_uri = f"{VECTOR_STORE_PREFIX}/{data.repo_id}/repo.faiss"
        return {"status": "ok", "latest_sha": latest_sha, "repo_faiss_uri": repo_faiss_uri}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion error: {str(e)}")
```

> **Truly incremental ingestion** (only fetching files that changed since `last_sha`) requires using the GitHub [compare commits API](https://docs.github.com/en/rest/commits/commits#compare-two-commits) to get the list of changed files, then fetching only those. That is a follow-up task but the `update_vector_store` / `merge_from` foundation above is the prerequisite for it.

---

*End of Guide 2.*
