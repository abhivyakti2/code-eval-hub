# Performance Optimization Guide — CodeEvalHub

> A step-by-step, professionally recommended guide to eliminate every identified cause of slowness.
> Each issue is labeled by impact tier so you can work highest-ROI fixes first.

---

## Is it just development mode?

**Partially yes, but mostly no.**

| Environment | What is slow |
|---|---|
| `next dev --turbopack` | No bundle minification, no server-side route pre-compilation, hot-module replacement overhead, full Prisma query logging, no edge caching — adds **300–800 ms** of pure dev overhead per navigation |
| Production (`next start`) | The bundle is optimized and pre-compiled, but every architectural issue below still applies in production |

Development mode accounts for roughly 30–40 % of the perceived slowness. The other 60–70 % are real architectural bottlenecks that will hurt you in production too.

---

## Tier 1 — Highest Impact (Fix These First)

### 1. Sequential database queries inside `sendChatMessageWithFeatures` (biggest bottleneck)

**File:** `app/lib/actions.ts` — `sendChatMessageWithFeatures`

**What is happening:**
```
prisma.message.count          ← DB round-trip 1
↓ (if first message)
triggerRepoIngestion           ← full RAG ingest (blocking! can take 10–60 s)
↓
prisma.message.create          ← DB round-trip 2
↓
fetchRepoLastCommitSha         ← DB round-trip 3
↓
prisma.chat.update             ← DB round-trip 4
↓
fetchRepoOwnerName             ← DB round-trip 5
↓
prisma.contributor.findMany    ← DB round-trip 6
↓
RAG API call(s)                ← network + AI inference
↓
prisma.message.create          ← DB round-trip 7
```

Every arrow above is a sequential wait. On a hosted database 1 round-trip ≈ 10–50 ms. You are doing 6–7 before the AI even starts.

**Fix — Parallelize everything that can run concurrently:**

```ts
// Before sending to RAG, gather all needed data in one Promise.all
const [priorUserMsgCount, repoMeta] = await Promise.all([
  prisma.message.count({ where: { chatId, role: "user" } }),
  prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true, lastCommitSha: true },
  }),
]);

const repo = { owner: repoMeta!.owner, name: repoMeta!.name };

// Trigger ingestion non-blocking if first message
const ingestionPromise =
  priorUserMsgCount === 0 ? triggerRepoIngestion(repoId) : Promise.resolve();

// Persist user message and fetch contributors in parallel while ingestion runs
const [, contributors] = await Promise.all([
  prisma.message.create({ data: { chatId, role: "user", content: userText.trim(), features } }),
  prisma.contributor.findMany({
    where: { repositoryId: repoId },
    select: { id: true, githubLogin: true, totalCommits: true },
    orderBy: [{ totalCommits: "desc" }, { githubLogin: "asc" }],
  }),
  ingestionPromise,
]);

// Update chat SHA in background — user doesn't need to wait for this
prisma.chat.update({
  where: { id: chatId },
  data: { lastChatSha: repoMeta!.lastCommitSha ?? undefined },
}).catch(console.error); // fire-and-forget

// Now call RAG
```

**Savings: ~200–400 ms per message send.**

---

### 2. Blocking repo ingestion on first message

**File:** `app/lib/actions.ts` — `sendChatMessageWithFeatures`

**What is happening:**
When the user sends their very first message, `triggerRepoIngestion` runs **synchronously before the message is processed**. The RAG ingestion can take **10–60 seconds** for a moderately sized repo. The user sees a frozen UI.

**Fix — Trigger ingestion in background when the chat is created, not when the first message is sent.**

In `addRepository` (in `actions.ts`), after the redirect URL is calculated and `chatId` is known, fire ingestion asynchronously:

```ts
// After getOrCreateChat — fire ingestion in background, do NOT await
triggerRepoIngestion(createdId).catch((err) =>
  console.error("Background ingestion failed:", err)
);

revalidateTag("repositories", "max");
// ...redirect
```

Then in `sendChatMessageWithFeatures`, remove the `if (priorUserMsgCount === 0) await triggerRepoIngestion(repoId)` block. Instead, verify the RAG service already has embeddings:

```ts
// If RAG returns 400 "not ingested", trigger ingestion once and retry — this is already handled in askRepoChat/generateRepoSummary
```

This way the user navigates to the chat page while ingestion runs in parallel. By the time they type their first message, ingestion is often already done.

**Savings: 10–60 seconds eliminated from first message send.**

---

### 3. Contributor summaries generated sequentially

**File:** `app/lib/actions.ts` — `generateAndStoreAllContribSummaries`

**What is happening:**
```ts
for (const c of contributors) {
  const summary = await generateContributorSummary(repoId, c.githubLogin); // waits for each one
  await prisma.contributor.update(...);
  out[c.githubLogin] = summary;
}
```

For a repo with 10 contributors, each summary takes 3–10 s → **30–100 s total**.

**Fix — Run all contributor summary generations in parallel:**

```ts
const results = await Promise.all(
  contributors.map(async (c) => {
    const summary = await generateContributorSummary(repoId, c.githubLogin);
    await prisma.contributor.update({
      where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: c.githubLogin } },
      data: { summary, lastSummarySha: currentSha },
    });
    return [c.githubLogin, summary] as const;
  })
);

const out = Object.fromEntries(results);
```

**Savings: (N-1) × summary_time, typically 20–90 seconds.**

---

### 4. No streaming for AI responses — user waits in silence

**File:** `app/ui/dashboard/chat-section.tsx` — `handleSend`

**What is happening:**
The entire AI response is generated server-side and only sent to the client once 100 % complete. The user sees "Generating…" for 5–30 seconds with no feedback.

**Fix — Use a streaming API route with the Web Streams API.**

Step 1: Create `app/api/chat/route.ts`:
```ts
import { auth } from "@/auth";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { chatId, repoId, userText, selectedFeatures } = await req.json();

  // Create a ReadableStream that yields tokens as they arrive from the RAG service
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const ragRes = await fetch(`${process.env.RAG_SERVICE_URL}/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo_id: repoId, question: userText }),
        });
        const reader = ragRes.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

Step 2: In `handleSend`, use `fetch` + `ReadableStream` reader to update the assistant message token-by-token.

If your RAG service does not yet support streaming, the minimal improvement is to add an **optimistic "Generating…" placeholder** that is replaced once the full response arrives (which is already done), combined with the other parallelization fixes above to reduce total wait time.

**Savings: Perceived latency drops from "wait 15 s then see everything" to "see first tokens in < 1 s".**

---

### 5. `addRepository` — fetching contributors blocks the redirect

**File:** `app/lib/actions.ts` — `addRepository`

**What is happening:**
```ts
const contributors = await fetchContributors(owner, repo); // GitHub API call — 500–2000 ms
await prisma.contributor.createMany(...);
```
This blocks the user from reaching the chat page while we fetch up to 30 contributors from GitHub.

**Fix — Defer contributor fetching to background after redirect.**

Option A (simplest): Do not insert contributors at `addRepository` time. Instead, fetch and insert them lazily when they are first needed (before summary or question generation):

```ts
// In sendChatMessageWithFeatures, before generating questions:
const contributorCount = await prisma.contributor.count({ where: { repositoryId: repoId } });
if (contributorCount === 0) {
  const { owner, name } = await fetchRepoOwnerName(repoId);
  const ghContribs = await fetchContributors(owner, name);
  await prisma.contributor.createMany({
    data: ghContribs.map((c) => ({
      repositoryId: repoId,
      githubLogin: c.login,
      avatarUrl: c.avatar_url,
      totalCommits: c.contributions,
    })),
    skipDuplicates: true,
  });
}
```

**Savings: 500–2000 ms off the "Creating chat…" button press.**

---

### 6. `generateAndStoreRepoSummary` — two separate DB reads

**File:** `app/lib/actions.ts` — `generateAndStoreRepoSummary`

**What is happening:**
```ts
const repo = await prisma.repository.findUnique({ select: { lastSummarySha: true } });
if (repo?.lastSummarySha === currentSha) {
  const stored = await prisma.repository.findUnique({ select: { repoSummary: true } }); // second round-trip
  return stored?.repoSummary ?? "";
}
```

**Fix — Fetch both fields in a single query:**

```ts
const repo = await prisma.repository.findUnique({
  where: { id: repoId },
  select: { lastSummarySha: true, repoSummary: true },
});

if (repo?.lastSummarySha === currentSha) {
  return repo.repoSummary ?? "";
}
```

**Savings: 1 DB round-trip eliminated (~20–50 ms).**

---

## Tier 2 — Medium Impact

### 7. `ChatHistory` uses `useSearchParams` — blocks SSR

**File:** `app/ui/dashboard/chat-history.tsx`

**What is happening:**
`useSearchParams()` causes React to suspend the entire sidenav during client-side hydration unless wrapped in `<Suspense>`. Without a Suspense boundary, Next.js falls back to rendering the full layout on the client, losing the SSR speedup.

**Fix — Wrap `ChatHistory` in a Suspense boundary inside `SideNav`:**

```tsx
// app/ui/dashboard/sidenav.tsx
import { Suspense } from "react";

// Inside the JSX where ChatHistory is rendered:
<Suspense fallback={<p className="px-3 py-2 text-sm text-slate-400">Loading…</p>}>
  <ChatHistory chats={chats} />
</Suspense>
```

This allows the rest of the sidenav to paint immediately while the active-chat highlight resolves client-side.

---

### 8. `auth()` called three times per page load

**Files:** `app/ui/dashboard/sidenav.tsx`, `app/dashboard/(home)/page.tsx`, `app/dashboard/chat/page.tsx`

**What is happening:**
When the dashboard layout renders, `auth()` is called in `SideNav` (server component inside layout) **and** in the page component. That is two session lookups per page load. Both are database/JWT reads.

**Fix — Call `auth()` once in the layout and pass `userId` down as a prop:**

```tsx
// app/dashboard/layout.tsx
import { auth } from "@/auth";

export default async function Layout({ children }) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  return (
    <>
      <InactivityGuard />
      <div className="flex h-screen flex-col md:flex-row md:overflow-hidden">
        <div className="w-full flex-none md:w-64">
          <SideNav userId={userId} />
        </div>
        <div className="grow p-6 min-h-0 overflow-hidden md:p-12">{children}</div>
      </div>
    </>
  );
}
```

Pass `userId` to `SideNav` as a prop. Pages can still call `auth()` if they need more session data, but the repeated session lookup in `SideNav` is eliminated.

---

### 9. `fetchChatWithRepoAndContribs` has no caching

**File:** `app/lib/data.ts` — `fetchChatWithRepoAndContribs`

**What is happening:**
Every time the `/dashboard/chat` page loads it does a full Prisma join across `Chat → Repository → Contributor[]` with no `unstable_cache` wrapper.

**Fix — Add caching with a per-chat tag:**

```ts
export async function fetchChatWithRepoAndContribs(chatId: string) {
  return unstable_cache(
    async () =>
      prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          repository: {
            include: { contributors: { orderBy: { totalCommits: "desc" } } },
          },
        },
      }),
    ["chat-context", chatId],
    { tags: [`chat-${chatId}`] },
  )();
}
```

Revalidate `chat-${chatId}` wherever chat data changes (e.g., after `sendChatMessageWithFeatures`).

---

### 10. `fetchMessagesByChat` has no caching

**File:** `app/lib/data.ts` — `fetchMessagesByChat`

**What is happening:**
Chat messages are fetched fresh on every page load.

**Fix:**

```ts
export async function fetchMessagesByChat(chatId: string) {
  return unstable_cache(
    async () =>
      prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
      }),
    ["messages-by-chat", chatId],
    { tags: [`chat-${chatId}`] },
  )();
}
```

After `sendChatMessageWithFeatures` completes, call `revalidateTag(`chat-${chatId}`)` so the cache is invalidated and fresh messages are fetched on next load.

---

### 11. `revalidatePath("/dashboard")` called on every mutation — affects all users

**Files:** `app/lib/actions.ts`, `app/lib/rag-client.ts`

**What is happening:**
`revalidatePath("/dashboard")` invalidates the **full-route server cache for the entire dashboard for every user** every time any user adds a repo, sends a message, or triggers ingestion. This is overly broad and forces unnecessary re-renders.

**Fix — Replace `revalidatePath` with targeted `revalidateTag` calls:**

```ts
// Instead of:
revalidatePath("/dashboard");

// Use targeted tags:
revalidateTag(`user-${userId}-repositories`); // only affects current user's sidebar
revalidateTag(`chat-${chatId}`);              // only affects this specific chat
revalidateTag(`repo-${repoId}`);              // only affects this repo's data
```

Reserve `revalidatePath` for cases where page structure genuinely changes for all users (rare).

---

### 12. Live GitHub SHA fetched twice per summary view

**File:** `app/ui/dashboard/chat-section.tsx`

**What is happening:**
There are two `useEffect` hooks that can independently call `fetchCurrentGithubSha`:

```ts
// Effect 1: on component mount (if liveGithubSha is null)
useEffect(() => {
  if (!repoOwner || !repoName || liveGithubSha) return;
  void fetchCurrentGithubSha(repoOwner, repoName)...
}, [repoOwner, repoName, liveGithubSha]);

// Effect 2: on entering summary view
useEffect(() => {
  if (viewMode !== "summary" || !repoOwner || !repoName) return;
  void fetchCurrentGithubSha(repoOwner, repoName)...
}, [viewMode, repoOwner, repoName]);
```

Effect 1 runs on mount and Effect 2 runs when summary view is opened, potentially firing twice within milliseconds.

**Fix — Consolidate into a single effect:**

```ts
useEffect(() => {
  if (!repoOwner || !repoName) return;
  if (liveGithubSha) return; // already have it
  void fetchCurrentGithubSha(repoOwner, repoName)
    .then(setLiveGithubSha)
    .catch(() => {});
}, [repoOwner, repoName]); // only run when repo changes
```

Remove the second effect that re-fetches in summary view. The SHA is already being fetched on mount.

---

### 13. Missing database index on `Chat.userId`

**File:** `prisma/schema.prisma`

**What is happening:**
`fetchChatHistoryByUser` queries `prisma.chat.findMany({ where: { userId } })`. The `Chat` model only has `@@index([repositoryId])`. Without a `userId` index, Postgres does a full table scan for every sidebar load.

**Fix — Add the missing index:**

```prisma
model Chat {
  // ... existing fields ...
  @@unique([userId, repositoryId])
  @@index([repositoryId])
  @@index([userId])          // ← ADD THIS
}
```

Then run:
```bash
npx prisma migrate dev --name add_chat_userid_index
```

**Savings: Full table scan → index seek. Grows more important as the database fills up.**

---

### 14. `InactivityGuard` re-creates event listeners on every render

**File:** `app/ui/inactivity-guard.tsx`

**What is happening:**
The `reset` function is a plain `function` inside the component body. On every render a new reference is created. The `useEffect` cleanup/setup cycle removes and re-adds all four event listeners unnecessarily.

**Fix — Memoize with `useCallback`:**

```ts
const reset = useCallback(() => {
  if (timer.current) clearTimeout(timer.current);
  timer.current = setTimeout(() => signOut({ callbackUrl: "/login" }), IDLE_MS);
}, []);
```

Also move the `IDLE_MS` constant outside the component to prevent the closure capturing a new value each render.

---

### 15. `next.config.ts` is empty — missing critical build optimizations

**File:** `next.config.ts`

**What is happening:**
The config object is completely empty. Several free performance wins are left on the table.

**Fix:**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minify server-side output for smaller bundles
  compress: true,

  // Strict mode catches effects running twice in dev — better to find re-render bugs early
  reactStrictMode: true,

  // Avoid shipping the full Prisma engine to the client bundle
  serverExternalPackages: ["@prisma/client", "prisma"],

  // Image optimization (if you ever add images)
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Reduce logging noise in production
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },
};

export default nextConfig;
```

---

## Tier 3 — Refinements & Polish

### 16. Prisma query logging is on in development — slows down hot-reload and DB round-trips

**File:** `app/lib/db.ts`

**What is happening:**
```ts
log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
```
Logging every query adds latency in development, making it hard to distinguish real slowness from dev overhead.

**Fix — Use event-based logging only when explicitly requested:**

```ts
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.PRISMA_LOG === 'verbose'
    ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
    : ['warn', 'error'],
});
```

Run with `PRISMA_LOG=verbose npm run dev` when you want to debug queries.

---

### 17. No connection pooling — cold-start connections for every serverless invocation

**Files:** `app/lib/db.ts`, `prisma.config.ts`

**What is happening:**
Every server-side rendering invocation creates a new Prisma Client that opens a fresh connection to Postgres. In a serverless or edge environment this means a TCP handshake + TLS negotiation + Postgres auth on every cold start (~100–300 ms).

**Fix — Use Prisma Accelerate or an external connection pooler (PgBouncer).**

Option A (Prisma Accelerate — zero infrastructure change):
```bash
npm install @prisma/extension-accelerate
```
```ts
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

export const prisma = (globalForPrisma.prisma ?? new PrismaClient()).
  $extends(withAccelerate());
```
Set `DATABASE_URL` to your Prisma Accelerate connection string.

Option B (PgBouncer in transaction mode): Set up PgBouncer pointing to your Postgres, update `DATABASE_URL` to the PgBouncer endpoint.

---

### 18. `ChatPage` always passes `initialLiveGithubSha={null}` — always forces client fetch

**File:** `app/dashboard/chat/page.tsx` line 63

**What is happening:**
```tsx
initialLiveGithubSha={null}
```
This is hardcoded to `null`. The comment says "GitHub API call moved to client-side to unblock initial page render." While the intent is correct (don't block SSR), the result is that the client always fires an extra fetch on mount.

**Fix — Fetch the SHA server-side concurrently with the other data, then pass it down:**

```tsx
// In ChatPage:
const [initialMessages, chatContext, initialLiveGithubSha] = await Promise.all([
  params?.chatId ? fetchMessagesByChat(params.chatId) : Promise.resolve([]),
  params?.chatId ? fetchChatWithRepoAndContribs(params.chatId) : Promise.resolve(null),
  owner && repo ? fetchLatestCommitSha(owner, repo).catch(() => null) : Promise.resolve(null),
]);
```

Since these three run in parallel, the extra GitHub API call adds zero wall-clock time to the page load. The client no longer needs to fetch the SHA separately.

---

### 19. `generateQuestions` calls `fetchRepoOwnerName` per contributor — redundant DB reads

**File:** `app/lib/rag-client.ts` — `generateQuestions`

**What is happening:**
```ts
const { owner, name } = await fetchRepoOwnerName(repoId); // called for every contributor
```
If 10 contributors each trigger `generateQuestions`, that is 10 identical DB reads for the same repo's owner/name.

**Fix — Fetch owner/name once in `sendChatMessageWithFeatures` and pass it in:**

```ts
// sendChatMessageWithFeatures already fetches repo — pass owner/name to generateQuestions
const questions = await generateQuestions(repoId, c.id, c.githubLogin, chatId, "contributor", "general", { owner: repo.owner, name: repo.name });
```

Update `generateQuestions` signature to accept an optional `repoMeta` parameter and skip the DB read if provided.

---

### 20. Messages rendered with array index as key — forces full re-render on every new message

**File:** `app/ui/dashboard/chat-section.tsx` line ~557

**What is happening:**
```tsx
messages.map((msg, idx) => (
  <div key={idx} ...>
```

Using array index as key means React re-renders every existing message element whenever a new message is added (because all indices shift conceptually even though position doesn't change). For long chat histories this means many DOM reconciliations.

**Fix — Use a stable unique identifier:**

```ts
// ChatMessage definition — add an id field
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  features?: MessageFeature[];
};

// When adding messages client-side:
import { randomUUID } from "crypto"; // or use crypto.randomUUID() in browser
setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: userMessage, features: selected }]);

// In JSX:
messages.map((msg) => (
  <div key={msg.id} ...>
```

---

### 21. `revalidateTag` called with wrong overload syntax

**File:** `app/lib/actions.ts` line 108 and 287

**What is happening:**
```ts
revalidateTag("repositories", "max"); // ← "max" is not a valid second argument
```
`revalidateTag` accepts only one argument (the tag string). The `"max"` argument is silently ignored but indicates confusion with the old stale-while-revalidate API. It adds no benefit.

**Fix:**
```ts
revalidateTag("repositories");
revalidateTag(`repo-${createdId}`);
```

---

## Summary Table — All Fixes by Savings

| # | Fix | Estimated Savings | Effort |
|---|---|---|---|
| 1 | Parallelize DB queries in `sendChatMessageWithFeatures` | 200–400 ms/message | Medium |
| 2 | Background ingestion on chat creation | **10–60 s** off first message | Medium |
| 3 | Parallel contributor summary generation | 20–90 s | Small |
| 4 | Stream AI responses | Perceived latency -90 % | Large |
| 5 | Defer contributor fetch from `addRepository` | 500–2000 ms off chat creation | Small |
| 6 | Single DB read in `generateAndStoreRepoSummary` | 20–50 ms | Trivial |
| 7 | Suspense boundary around `ChatHistory` | Faster paint | Trivial |
| 8 | Call `auth()` once in layout | 1 session lookup saved | Small |
| 9 | Cache `fetchChatWithRepoAndContribs` | 50–200 ms on chat open | Small |
| 10 | Cache `fetchMessagesByChat` | 50–200 ms on chat open | Small |
| 11 | Replace broad `revalidatePath` with targeted tags | Prevents cache stampede | Small |
| 12 | Deduplicate live SHA fetch | 1 GitHub API call saved | Trivial |
| 13 | Add `@@index([userId])` to `Chat` | Scales well | Trivial |
| 14 | `useCallback` in `InactivityGuard` | Minor re-render reduction | Trivial |
| 15 | Fill `next.config.ts` | Bundle size reduction | Trivial |
| 16 | Reduce Prisma dev logging | Dev-only noise reduction | Trivial |
| 17 | Connection pooling (Prisma Accelerate) | 100–300 ms off cold starts | Medium |
| 18 | Fetch live SHA server-side in `ChatPage` | 1 client waterfall eliminated | Small |
| 19 | Pass `repoMeta` to avoid per-contributor DB reads | N × 20 ms | Small |
| 20 | Stable message keys | Fewer DOM reconciliations | Trivial |
| 21 | Fix `revalidateTag` call syntax | Correctness | Trivial |

---

## Recommended Implementation Order

```
Week 1 — Quick wins (all trivial/small effort)
  ✓ Fix 2  — Background ingestion
  ✓ Fix 1  — Parallelize DB queries in sendChatMessageWithFeatures
  ✓ Fix 3  — Parallel contributor summaries (Promise.all)
  ✓ Fix 6  — Single DB read in generateAndStoreRepoSummary
  ✓ Fix 11 — Targeted revalidateTag instead of revalidatePath
  ✓ Fix 12 — Deduplicate live SHA useEffect
  ✓ Fix 13 — Add userId index to Chat model
  ✓ Fix 15 — Fill next.config.ts
  ✓ Fix 21 — Fix revalidateTag syntax

Week 2 — Medium effort
  ✓ Fix 5  — Defer contributor fetch from addRepository
  ✓ Fix 9  — Cache fetchChatWithRepoAndContribs
  ✓ Fix 10 — Cache fetchMessagesByChat
  ✓ Fix 18 — Server-side live SHA fetch in ChatPage
  ✓ Fix 8  — Single auth() call in layout
  ✓ Fix 17 — Add connection pooling

Week 3 — Large effort (most user-visible improvement)
  ✓ Fix 4  — Streaming AI responses
```

---

## A Note on Dev vs Production

Even after all fixes above, development mode will still be noticeably slower than production because:

- Turbopack does JIT compilation on every module import
- React runs in development mode with extra checks and double-invocation of effects
- No route pre-rendering or static optimization
- Prisma hot-reload connection churn

Always benchmark your changes with `npm run build && npm run start` before declaring a fix effective. A rule of thumb: if something feels 2× slow in dev, it may only be 1.2× slow in production.
