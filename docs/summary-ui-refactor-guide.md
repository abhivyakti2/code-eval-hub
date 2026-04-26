# Summary UI Refactor & SHA Tracking — Implementation Guide

This document covers every change needed to implement the summary view, SHA-based staleness tracking, and the revised chat UI. Changes are ordered so each step builds on the previous one.

---

## Overview of what changes

| Area | What changes |
|---|---|
| `prisma/schema.prisma` | Remove FAISS URI fields; add summary text + SHA fields; trim `MessageFeature` enum |
| `app/lib/data.ts` | Add helper to fetch chat with repo + contributors in one query |
| `app/lib/actions.ts` | Add actions for storing summaries, updating viewed-SHA, fetching current GitHub SHA; update ingestion/chat actions |
| `app/dashboard/chat/page.tsx` | Remove standalone `<h1>` (heading moves into `ChatSection`); pass new props |
| `app/ui/dashboard/chat-section.tsx` | Add mode toggle (chat vs summary), 2-button summary panel, staleness banners; remove `repo_summary`/`contributors_summary` from action buttons |

---

## Step 1 — Schema (`prisma/schema.prisma`)

### 1a. Remove FAISS URI fields; add summary + SHA fields

The FAISS index location is derived from `repo_id` + scope by the RAG service itself (`{VECTOR_STORE_PREFIX}/{repo_id}/repo.faiss`, `{VECTOR_STORE_PREFIX}/{repo_id}/{scope}.faiss`), so it does not need to be stored in the database.

```diff
 model Repository {
   id                 String              @id @default(cuid())
   githubId           Int                 @unique
   githubUrl          String
   owner              String
   name               String
   description        String?
   language           String?
   lastCommitSha      String?
-  //should be last ingested sha for clarity
-  repoFaissUri       String?
-  //where embedding is stored?
+  //last ingested commit sha — updated every time /ingest runs successfully
+  repoSummary        String?
+  //latest generated repo summary text; older summaries are not kept
+  lastSummarySha     String?
+  //commit sha at which repoSummary was last generated
   createdAt          DateTime            @default(now())
   ...
 }

 model Contributor {
   id                 String              @id @default(cuid())
   repositoryId       String
   githubLogin        String
   avatarUrl          String?
   totalCommits       Int                 @default(0)
   summary            String?
-  faissUri           String?
+  //latest generated contributor summary text; older summaries are not kept
+  lastSummarySha     String?
+  //commit sha at which summary was last generated
   ...
 }
```

### 1b. Replace `commitSha` with purpose-specific SHA fields in `Chat`; add per-contributor viewed-SHA table

`commitSha` was a single vague field. Replace it with two fields on `Chat` for the two things that are naturally per-chat-session scalars (last chat message SHA, last viewed repo-summary SHA), and model per-contributor viewed SHAs as a separate join table so each contributor can be tracked independently.

```diff
 model Chat {
   id                   String              @id @default(cuid())
   userId               String
   repositoryId         String
-  commitSha            String?
-  // title        String     @default("New Chat"), put repo name w/ owner
+  lastChatSha          String?
+  //sha of the repo at the time user last sent a chat message
+  lastViewedSummarySha String?
+  //sha at which user last viewed the repo summary tab
   createdAt            DateTime            @default(now())
+  chatContribViewedShas ChatContributorViewedSha[]
   ...
 }
+
+// Tracks, per (chat, contributor), the contributor.lastSummarySha that was
+// current the last time the user viewed that contributor's summary.
+// Enables: contributor.lastSummarySha !== chatContribViewedShas[contributorId]
+model ChatContributorViewedSha {
+  chatId        String
+  contributorId String
+  viewedSha     String
+  updatedAt     DateTime    @updatedAt
+  chat          Chat        @relation(fields: [chatId], references: [id], onDelete: Cascade)
+  contributor   Contributor @relation(fields: [contributorId], references: [id], onDelete: Cascade)
+
+  @@id([chatId, contributorId])
+  @@index([chatId])
+}
```

Also add the back-relation on `Contributor`:

```diff
 model Contributor {
   ...
+  chatContribViewedShas ChatContributorViewedSha[]
 }
```

### 1c. Trim `MessageFeature` enum

`repo_summary` and `contributors_summary` are no longer chat features — they live in their own dedicated summary view. Remove them from the enum so they cannot be attached to `Message` rows.

```diff
 enum MessageFeature {
-  repo_summary
-  contributors_summary
   generate_questions
   repo_chat
 }
```

> **Migration note:** If any existing `Message` rows have `repo_summary` or `contributors_summary` in their `features` array, clear those values before running the migration:
> ```sql
> UPDATE "Message" SET features = array_remove(array_remove(features::text[], 'repo_summary'), 'contributors_summary')::\"MessageFeature\"[] WHERE features && ARRAY['repo_summary','contributors_summary']::"MessageFeature"[];
> ```
> Then run: `npx prisma migrate dev --name sha_tracking_per_contributor_viewed`

---

## Step 2 — Data helper (`app/lib/data.ts`)

Add one new function. Everything else in `data.ts` stays untouched.

```ts
// Fetch a chat together with its repository (including contributors) and the
// per-contributor viewed-SHA records for this chat in one query.
// Used by ChatPage to pass repo summary state + contributor list to ChatSection.
export async function fetchChatWithRepoAndContribs(chatId: string) {
  try {
    return await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        repository: {
          include: {
            contributors: { orderBy: { totalCommits: 'desc' } },
          },
        },
        chatContribViewedShas: true, // per-contributor last-viewed SHA records
      },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch chat context.');
  }
}
```

---

## Step 3 — Server actions (`app/lib/actions.ts`)

### 3a. Expose `fetchLatestCommitSha` as a callable server action

The client (inside `ChatSection`) needs to check whether the live GitHub SHA has moved since the stored one. Export a thin wrapper around the existing `fetchLatestCommitSha` from `github.ts`.

```ts
import { fetchLatestCommitSha } from '@/app/lib/github';

export async function fetchCurrentGithubSha(owner: string, repoName: string): Promise<string> {
  return fetchLatestCommitSha(owner, repoName);
}
```

### 3b. `generateAndStoreRepoSummary` — stores result and SHA

Replaces calling `generateRepoSummary` directly from the client. Calls the existing function, then persists the result so it can be shown without re-generating.

```ts
export async function generateAndStoreRepoSummary(
  repoId: string,
  currentSha: string,
): Promise<string> {
  const summary = await generateRepoSummary(repoId); // existing function unchanged
  await prisma.repository.update({
    where: { id: repoId },
    data: { repoSummary: summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, 'max');
  return summary;
}
```

### 3c. `generateAndStoreContribSummary` — same pattern for contributors

```ts
export async function generateAndStoreContribSummary(
  repoId: string,
  contributorLogin: string,
  currentSha: string,
): Promise<string> {
  const summary = await generateContributorSummary(repoId, contributorLogin); // existing function unchanged
  await prisma.contributor.update({
    where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: contributorLogin } },
    data: { summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, 'max');
  return summary;
}
```

### 3d. `updateChatViewedSha` — record when user views the repo summary

Call this whenever the user opens the summary panel so next time the repo-summary staleness note can be shown accurately.

```ts
export async function updateChatViewedSha(
  chatId: string,
  sha: string,
): Promise<void> {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastViewedSummarySha: sha },
  });
}
```

### 3d-ii. `updateContribViewedSha` — record per-contributor last-viewed SHA

Call this for each contributor whose summary the user views. Uses an upsert so the first open creates the row and subsequent opens update it.

```ts
export async function updateContribViewedSha(
  chatId: string,
  contributorId: string,
  sha: string,
): Promise<void> {
  await prisma.chatContributorViewedSha.upsert({
    where: { chatId_contributorId: { chatId, contributorId } },
    create: { chatId, contributorId, viewedSha: sha },
    update: { viewedSha: sha },
  });
}
```

### 3e. Update `sendChatMessageWithFeatures` — record `lastChatSha`

Inside the existing function, after creating the user message, update `lastChatSha` on the chat row. Add this block right after the `prisma.message.create` call for the user message:

```ts
// After: await prisma.message.create({ data: { chatId, role: 'user', ... } })
// Add:
const repoForSha = await prisma.repository.findUnique({
  where: { id: repoId },
  select: { lastCommitSha: true },
});
if (repoForSha?.lastCommitSha) {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastChatSha: repoForSha.lastCommitSha },
  });
}
```

### 3f. Remove `repo_summary` / `contributors_summary` branches from `sendChatMessageWithFeatures`

Delete the two `if (features.includes('repo_summary'))` and `if (features.includes('contributors_summary'))` blocks entirely. Those features no longer exist in the enum and no longer come through the chat path.

### 3g. Update `triggerRepoIngestion` — remove `repoFaissUri`

The existing update call in `triggerRepoIngestion` only writes `lastCommitSha`, which is already correct. No change needed here beyond verifying that `repoFaissUri` is not referenced anywhere after the schema migration.

---

## Step 4 — Chat page (`app/dashboard/chat/page.tsx`)

The page's `<h1>` moves into `ChatSection` (it needs to change dynamically between "Chat with X" and "X Summary"). Pass new props.

```tsx
import { fetchChatWithRepoAndContribs } from '@/app/lib/data';

// Inside the page component, replace the initialMessages fetch block with:
const [initialMessages, chatContext] = await Promise.all([
  params?.chatId ? fetchMessagesByChat(params.chatId) : Promise.resolve([]),
  params?.chatId ? fetchChatWithRepoAndContribs(params.chatId) : Promise.resolve(null),
]);

// Replace the <main> return:
return (
  <main className="flex h-full min-h-[calc(100vh-5rem)] w-full flex-col">
    {/* h1 and subtitle have moved into ChatSection — remove them from here */}
    <ChatSection
      repoId={params?.repoId}
      chatId={params?.chatId}
      githubUrl={params?.github_url}
      repoName={params?.repo_name}
      userId={userId}
      initialMessages={initialMessages.map((m) => ({
        role: m.role,
        content: m.content,
        features: m.features,
      }))}
      // --- new props ---
      repoOwner={chatContext?.repository.owner}
      repoLastCommitSha={chatContext?.repository.lastCommitSha ?? null}
      repoLastSummarySha={chatContext?.repository.lastSummarySha ?? null}
      repoStoredSummary={chatContext?.repository.repoSummary ?? null}
      chatLastViewedSummarySha={chatContext?.lastViewedSummarySha ?? null}
      chatLastChatSha={chatContext?.lastChatSha ?? null}
      // Map of contributorId → viewedSha, built from the join table rows
      chatContribViewedShas={Object.fromEntries(
        (chatContext?.chatContribViewedShas ?? []).map((r) => [r.contributorId, r.viewedSha])
      )}
      contributors={
        chatContext?.repository.contributors.map((c) => ({
          id: c.id,
          githubLogin: c.githubLogin,
          summary: c.summary ?? null,
          lastSummarySha: c.lastSummarySha ?? null,
        })) ?? []
      }
    />
  </main>
);
```

---

## Step 5 — `ChatSection` (`app/ui/dashboard/chat-section.tsx`)

This is the biggest change. It is structured as minimal surgical additions to the existing component.

### 5a. New imports

```ts
import {
  fetchCurrentGithubSha,
  generateAndStoreRepoSummary,
  generateAndStoreContribSummary,
  updateChatViewedSha,
  updateContribViewedSha,
} from '@/app/lib/actions';
```

### 5b. Update prop interface

```ts
// Add to the existing props destructuring:
{
  repoId,
  chatId,
  userId,
  githubUrl,
  repoName,
  initialMessages = [],
  // new:
  repoOwner,
  repoLastCommitSha,
  repoLastSummarySha,
  repoStoredSummary,
  chatLastViewedSummarySha,
  chatContribViewedShas = {},
  chatLastChatSha,
  contributors = [],
}: {
  // existing types unchanged, plus:
  repoOwner?: string;
  repoLastCommitSha?: string | null;
  repoLastSummarySha?: string | null;
  repoStoredSummary?: string | null;
  chatLastViewedSummarySha?: string | null;
  // contributorId → viewedSha for each contributor the user has viewed
  chatContribViewedShas?: Record<string, string>;
  chatLastChatSha?: string | null;
  contributors?: {
    id: string;
    githubLogin: string;
    summary?: string | null;
    lastSummarySha?: string | null;
  }[];
}
```

### 5c. New state variables

Add these alongside existing `useState` calls:

```ts
// 'chat' = normal chat view; 'summary' = summary panel
type ViewMode = 'chat' | 'summary';
const [viewMode, setViewMode] = useState<ViewMode>('chat');

// The live SHA fetched from GitHub when summary panel opens
const [liveGithubSha, setLiveGithubSha] = useState<string | null>(null);

// Summary text states — start from stored values so no re-fetch on first open
const [repoSummaryText, setRepoSummaryText] = useState<string | null>(repoStoredSummary ?? null);
const [contribSummaries, setContribSummaries] = useState<Record<string, string>>(
  Object.fromEntries(
    contributors.filter((c) => c.summary).map((c) => [c.githubLogin, c.summary!])
  )
);

const [summaryLoading, setSummaryLoading] = useState<string | null>(null);
// value = 'repo' | contributor login | null
```

### 5d. Fetch live SHA and record viewed-SHA when summary panel opens

```ts
useEffect(() => {
  if (viewMode !== 'summary' || !repoOwner || !repoName) return;

  // Fetch live GitHub SHA once on open
  fetchCurrentGithubSha(repoOwner, repoName).then(setLiveGithubSha);

  // Record that user has viewed the repo summary at the current stored SHA
  if (chatId && repoLastSummarySha) {
    updateChatViewedSha(chatId, repoLastSummarySha);
  }

  // Record per-contributor: for each contributor that has a generated summary,
  // upsert their entry in ChatContributorViewedSha
  if (chatId) {
    contributors
      .filter((c) => c.lastSummarySha)
      .forEach((c) => {
        updateContribViewedSha(chatId, c.id, c.lastSummarySha!);
      });
  }
}, [viewMode]);
```

### 5e. Summary action handlers

```ts
async function handleGenerateRepoSummary() {
  if (!repoId || !liveGithubSha) return;
  setSummaryLoading('repo');
  try {
    const text = await generateAndStoreRepoSummary(repoId, liveGithubSha);
    setRepoSummaryText(text);
  } finally {
    setSummaryLoading(null);
  }
}

async function handleGenerateContribSummary(login: string) {
  if (!repoId || !liveGithubSha || !chatId) return;
  const contrib = contributors.find((c) => c.githubLogin === login);
  if (!contrib) return;
  setSummaryLoading(login);
  try {
    const text = await generateAndStoreContribSummary(repoId, login, liveGithubSha);
    setContribSummaries((prev) => ({ ...prev, [login]: text }));
    // Record that the user has now viewed the freshly generated summary
    await updateContribViewedSha(chatId, contrib.id, liveGithubSha);
  } finally {
    setSummaryLoading(null);
  }
}
```

### 5f. SHA comparison helpers (derived values, not state)

```ts
// Is the repo summary stale compared to live GitHub?
const repoSummaryIsStale =
  liveGithubSha !== null && liveGithubSha !== repoLastSummarySha;

// Did user last view the repo summary at an older SHA?
const repoUpdatedSinceViewed =
  repoLastSummarySha !== null && chatLastViewedSummarySha !== repoLastSummarySha;

// Per-contributor: did the contributor's summary change since user last viewed it?
// contributor.lastSummarySha is what was generated last;
// chatContribViewedShas[contributor.id] is what the user last saw.
function contribUpdatedSinceViewed(c: { id: string; lastSummarySha?: string | null }): boolean {
  return (
    c.lastSummarySha !== null &&
    c.lastSummarySha !== undefined &&
    chatContribViewedShas[c.id] !== c.lastSummarySha
  );
}

// Is chat history using an older repo version?
const chatIsStale =
  liveGithubSha !== null &&
  chatLastChatSha !== null &&
  chatLastChatSha !== liveGithubSha;
```

### 5g. Updated `REPO_ACTIONS` array

Remove `repo_summary` and `contributors_summary`; keep only `generate_questions` and `repo_chat`:

```ts
const REPO_ACTIONS: Array<{ id: RepoAction; label: string }> = [
  { id: "generate_questions", label: "Evaluation Questions" },
  { id: "repo_chat", label: "Ask more about Repository" },
];
```

### 5h. Replace the heading in the JSX

The `<h1>` in `page.tsx` is removed. Add this at the very top of the `ChatSection` return, outside the bordered card div:

```tsx
{/* Heading row — lives outside the chat card */}
<div className="mb-4 flex items-center gap-3">
  <h1 className="text-xl font-semibold md:text-2xl">
    {viewMode === 'summary'
      ? `${repoName ?? 'Repository'} Summary`
      : `Chat with ${repoName ?? 'Repository'}`}
  </h1>
  {isRepoLoaded && (
    viewMode === 'chat' ? (
      <button
        onClick={() => setViewMode('summary')}
        className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        {repoSummaryIsStale || !repoLastSummarySha ? 'Generate Summary' : 'View Summary'}
      </button>
    ) : (
      <button
        onClick={() => setViewMode('chat')}
        className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        Chat with Repo
      </button>
    )
  )}
</div>
```

### 5i. Summary panel JSX (shown instead of message list + input when `viewMode === 'summary'`)

Inside the bordered card div, replace the current single `<div>` containing messages + input with a conditional:

```tsx
{viewMode === 'summary' ? (
  /* ── Summary panel ──────────────────────────────────────── */
  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">

    {/* Staleness note for repo summary */}
    {repoUpdatedSinceViewed && (
      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1">
        ⚠ The repository has been updated since you last viewed this summary.
      </p>
    )}

    {/* Repo Summary button + output */}
    <div className="space-y-2">
      <button
        onClick={handleGenerateRepoSummary}
        disabled={summaryLoading === 'repo' || !liveGithubSha}
        className="rounded-full border px-3 py-1 text-xs font-medium bg-blue-50 border-blue-400 text-blue-700 disabled:opacity-40 transition-colors"
      >
        {summaryLoading === 'repo'
          ? 'Generating...'
          : repoSummaryIsStale
          ? 'Regenerate Repo Summary'
          : repoSummaryText
          ? 'Regenerate Repo Summary'
          : 'Generate Repo Summary'}
      </button>
      {repoSummaryText && (
        /* Displayed exactly like an assistant message bubble */
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 text-gray-900">
            <p className="text-xs font-medium text-gray-500 mb-1">Repository Summary</p>
            <p className="text-sm whitespace-pre-wrap">{repoSummaryText}</p>
          </div>
        </div>
      )}
    </div>

    {/* Contributor Summaries button + per-contributor output */}
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        Contributor Summaries
      </p>
      {contributors.length === 0 ? (
        <p className="text-sm text-gray-400">No contributors found.</p>
      ) : (
        contributors.map((c) => {
          const contribIsStale =
            liveGithubSha !== null && liveGithubSha !== c.lastSummarySha;
          const contribText = contribSummaries[c.githubLogin];
          // Has the stored contributor summary changed since user last viewed it in this chat?
          const contribNewSinceViewed = contribUpdatedSinceViewed(c);
          return (
            <div key={c.githubLogin} className="space-y-1">
              {/* Per-contributor staleness note — shown when summary was regenerated since last view */}
              {contribNewSinceViewed && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1">
                  ⚠ @{c.githubLogin}&apos;s summary has been updated since you last viewed it.
                </p>
              )}
              <button
                onClick={() => handleGenerateContribSummary(c.githubLogin)}
                disabled={summaryLoading === c.githubLogin || !liveGithubSha}
                className="rounded-full border px-3 py-1 text-xs font-medium bg-blue-50 border-blue-400 text-blue-700 disabled:opacity-40 transition-colors"
              >
                {summaryLoading === c.githubLogin
                  ? 'Generating...'
                  : contribIsStale || !contribText
                  ? `Generate @${c.githubLogin}`
                  : `Regenerate @${c.githubLogin}`}
              </button>
              {contribText && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 text-gray-900">
                    <p className="text-xs font-medium text-gray-500 mb-1">@{c.githubLogin}</p>
                    <p className="text-sm whitespace-pre-wrap">{contribText}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  </div>
) : (
  /* ── Chat panel (existing UI, unchanged) ──────────────────── */
  <>
    {/* Staleness note when returning to chat */}
    {chatIsStale && (
      <div className="px-4 pt-3">
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1">
          ⚠ The repository has been updated since your last message. Replies will use the latest ingested version.
        </p>
      </div>
    )}

    {/* Messages — existing code unchanged */}
    <div
      className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4"
      style={{ minHeight: "300px", maxHeight: "500px" }}
    >
      {/* ...existing messages JSX... */}
    </div>

    {/* Input area — existing code, but REPO_ACTIONS now only has generate_questions */}
    <div className="border-t border-gray-200 p-4 pt-3 pb-1">
      {/* Remove the "Repository Actions" <p> heading */}
      <div className="flex flex-wrap gap-2">
        {/* Only generate_questions button remains here */}
        {REPO_ACTIONS.map((action) => (
          // ...existing button JSX unchanged...
        ))}
      </div>
      {/* ...existing input + send button unchanged... */}
    </div>
  </>
)}
```

> **Key point:** When `generate_questions` is toggled on in the chat tab, the input placeholder becomes `'Optional: focus area for questions (e.g. "authentication flow")'`. This already works via the existing ternary in the placeholder prop — just update the condition to check `generate_questions` instead of the now-removed `repo_summary`.

### 5j. Update input placeholder ternary

Replace the existing placeholder chain:

```ts
// Before:
selectedActions.includes("repo_summary")
  ? "Optional: add notes (or click Send to ingest now)"
  : selectedActions.includes("generate_questions")
    ? 'Optional: focus area (e.g. "authentication flow")'
    : "Ask a question..."

// After (repo_summary no longer exists):
selectedActions.includes("generate_questions")
  ? 'Optional: focus area for questions (e.g. "authentication flow")'
  : "Ask a question..."
```

---

## Step 6 — Remove dead code

After all changes, search for and delete any remaining references to:
- `repoFaissUri` (Repository model field)
- `faissUri` (Contributor model field)
- `repo_summary` and `contributors_summary` feature enum values
- The old `commitSha` field on Chat
- The `generateContributorQuestions` export in `feature-buttons.tsx` (that file becomes unused since its functionality is absorbed into `ChatSection`)

---

## SHA comparison reference

| Comparison | Meaning | Where shown |
|---|---|---|
| `liveGithubSha !== repoLastSummarySha` | Repo summary is out of date | Button label becomes "Regenerate" |
| `repoLastSummarySha !== chatLastViewedSummarySha` | User hasn't seen the latest repo summary | Amber note in summary panel (repo section) |
| `liveGithubSha !== contributor.lastSummarySha` | Contributor summary is out of date vs live repo | Per-contributor button label becomes "Generate/Regenerate" |
| `contributor.lastSummarySha !== chatContribViewedShas[contributor.id]` | User hasn't seen the latest contributor summary | Per-contributor amber note in summary panel |
| `liveGithubSha !== chatLastChatSha` | Chat messages were sent against older code | Amber note in chat panel |
| `liveGithubSha !== repoLastCommitSha` | Repo embeddings are stale (ingestion needed) | Handled automatically in `sendChatMessageWithFeatures` (already triggers ingestion on first message) |

---

## Sequence — first time a user opens Summary panel

1. `setViewMode('summary')` triggers `useEffect`
2. `fetchCurrentGithubSha` call → `liveGithubSha` set
3. `repoSummaryIsStale` computed: if `repoLastSummarySha` is null → button shows "Generate Repo Summary"
4. User clicks → `generateAndStoreRepoSummary(repoId, liveGithubSha)` → calls existing `/summarize` RAG endpoint → stores result → `repoSummaryText` state updated → summary shown as gray bubble
5. On next open, stored summary displays instantly; button shows "Regenerate" if SHA has moved

## Sequence — returning user whose repo has new commits

1. Open Summary panel → `liveGithubSha` ≠ `repoLastSummarySha` → button shows "Regenerate Repo Summary"
2. Amber note (repo): `repoLastSummarySha !== chatLastViewedSummarySha` → "Repository has been updated since you last viewed this summary"
3. Per contributor: `contributor.lastSummarySha !== chatContribViewedShas[contributor.id]` → individual amber note for each contributor whose summary was regenerated since the user last viewed it
