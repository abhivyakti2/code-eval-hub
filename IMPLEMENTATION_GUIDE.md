# Code Eval Hub — Implementation Guide

> This guide evaluates every `TODO` comment across the codebase, provides best-practice recommendations with exact code snippets, covers the remaining UI consistency work, and analyses the RAG pipeline bottlenecks.

---

## Table of Contents

1. [auth.ts TODOs](#1-authts-todos)
2. [app/lib/actions.ts TODOs](#2-applibactionsts-todos)
3. [app/lib/data.ts TODOs](#3-applibdatats-todos)
4. [app/lib/github.ts TODOs](#4-applibgithubts-todos)
5. [app/lib/utils.ts & definitions.ts TODOs](#5-applibutils-and-definitionsts-todos)
6. [app/ui/button.tsx TODOs](#6-appuibuttontsx-todos)
7. [app/ui/login-form.tsx & signup-form.tsx TODOs](#7-forms-todos)
8. [app/ui/skeletons.tsx TODOs](#8-appuiskeletonsts-todos)
9. [app/ui/dashboard/sidenav.tsx TODOs](#9-dashboard-sidenav-todos)
10. [app/ui/dashboard/repo-evaluator.tsx TODOs](#10-repo-evaluator-todos)
11. [app/ui/dashboard/chat-section.tsx TODOs](#11-chat-section-todos)
12. [app/ui/dashboard/chat-history.tsx TODOs](#12-chat-history-todos)
13. [rag-service/rag_pipeline.py TODOs](#13-rag-pipeline-todos)
14. [rag-service/main.py TODOs](#14-rag-main-todos)
15. [rag-service/github_loader.py TODOs](#15-github-loader-todos)
16. [rag-service/vector_store.py TODOs](#16-vector-store-todos)
17. [UI Consistency — Matching the `/` and Auth Pages](#17-ui-consistency)
18. [RAG Pipeline Performance — Why It Is Slow & How to Fix It](#18-rag-pipeline-performance)

---

## 1. `auth.ts` TODOs

### TODO (line 69 & 74): Pass an error message when returning `null` from `authorize`

**Current behaviour:** `authorize` silently returns `null`, so the client gets a generic NextAuth error with no detail.

**Best practice:** Return `null` (NextAuth requires it) but also throw a `CredentialsSignin`-typed `AuthError` with a custom message that the login form can surface. The cleanest pattern in NextAuth v5 is to `throw` instead of returning null when credentials are wrong:

```ts
// auth.ts  — inside authorize()
if (!user) {
  throw new Error("No account found with that email."); // surfaces as CredentialsSignin
}
const passwordsMatch = await bcrypt.compare(password, user.password);
if (!passwordsMatch) {
  throw new Error("Incorrect password.");
}
return user;
```

In `app/lib/actions.ts → authenticate()`:
```ts
switch (error.type) {
  case "CredentialsSignin":
    return { message: error.message ?? "Invalid credentials." }; // use the thrown message
  default:
    return { message: "Something went wrong." };
}
```

### TODO (line 81): Auto sign-out after inactivity

**Feasibility:** Yes, two-part solution:

**Part 1 — server-side max age (add to `auth.config.ts`):**
```ts
session: { strategy: "jwt", maxAge: 30 * 60 }, // 30 minutes
```

**Part 2 — client-side idle timer (create `app/ui/inactivity-guard.tsx`):**
```tsx
"use client";
import { signOut } from "next-auth/react";
import { useEffect, useRef } from "react";

const IDLE_MS = 30 * 60 * 1000;

export function InactivityGuard() {
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const reset = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => signOut({ callbackUrl: "/login" }), IDLE_MS);
  };

  useEffect(() => {
    ["mousemove", "keydown", "click", "touchstart"].forEach((e) =>
      window.addEventListener(e, reset),
    );
    reset();
    return () => {
      clearTimeout(timer.current);
      ["mousemove", "keydown", "click", "touchstart"].forEach((e) =>
        window.removeEventListener(e, reset),
      );
    };
  }, []);

  return null;
}
```

Mount it once inside the dashboard layout:
```tsx
// app/dashboard/layout.tsx
import { InactivityGuard } from "@/app/ui/inactivity-guard";
// … inside the JSX
<InactivityGuard />
```

---

## 2. `app/lib/actions.ts` TODOs

### TODO (line 7): When to use `app/api/route.ts` vs server action?

**Rule of thumb:**
- **Server Actions** — form submissions, mutations called from a React component, simple one-off calls tightly coupled to a page.
- **API Routes** — anything consumed by a third party, webhooks, streaming endpoints (`ReadableStream`), or when you need full control over the HTTP response (headers, status codes).

For this project everything is internal, so keeping server actions is correct.

### TODO (line 10): Understanding `revalidateTag` vs `revalidatePath`

- `revalidatePath("/dashboard")` — busts the full-route cache for that path segment. Use it when multiple users share the same rendered output.
- `revalidateTag("repositories")` — busts only cache entries labelled with that tag. Prefer this; it's more granular.

Use `revalidatePath` sparingly (only on actions that affect shared/global state) and rely on `revalidateTag` for per-user or per-resource data.

### TODO (line 72): `const CreateUser = SignUpSchema`

This alias adds zero value. Replace it:

```ts
// Remove the alias line and use SignUpSchema directly
export async function register(prevState: SignUpState, formData: FormData) {
  const validatedFields = SignUpSchema.safeParse({ ... });
```

### TODO (line 119): Redirect to login with message after account creation failure

```ts
// After the AuthError catch block in register()
if (error instanceof AuthError) {
  redirect("/login?error=account_created_login_failed");
}
```

Handle it in `login-form.tsx`:
```tsx
const error = searchParams.get("error");
// …
{error === "account_created_login_failed" && (
  <p className="text-amber-600 text-sm">
    Account created! Please log in.
  </p>
)}
```

### TODO (line 152): Can `authenticate` always return `LoginState`?

Yes. Change the return type:

```ts
export async function authenticate(
  prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
```

On success NextAuth throws an internal redirect (not returned), so TypeScript's reachability analysis is fine if you add `return {}` at the end of the happy path (it won't be reached):
```ts
  // end of function after signIn
  return {}; // unreachable — NextAuth redirects
}
```

### TODO (line 184 & 410): Move non-server-action helpers to a separate file

Create `app/lib/rag-client.ts` for all the `fetch(RAG_URL/…)` functions (`askRepoChat`, `generateRepoSummary`, `generateContributorSummary`, `triggerRepoIngestion`, `getRepoOwnerName`). Keep only actual server actions (those that use `"use server"` and modify state/redirect) in `actions.ts`.

### TODO (line 186): `logout()` has no try/catch

`signOut` throws a redirect internally and does not need a try/catch. The current implementation is correct. Remove the TODO.

### TODO (line 202): Move state types to a separate file?

Move them to `app/lib/types.ts` alongside other shared types. This also fixes the `chat-section.tsx` import:

```ts
// app/lib/types.ts
export type SignUpState = { … };
export type LoginState = { … };
export type AddRepoState = { … };
export type ValidateRepoUrlState = { … };
```

### TODO (line 230): `validatedGithubRepoUrl` — split into structure-only check and full check

Create two functions:

```ts
// Fast, client-callable: checks format only
export function validateGithubUrlFormat(raw: string): ValidateRepoUrlState {
  const parsed = GithubUrlSchema.safeParse(raw.trim());
  if (!parsed.success)
    return { valid: false, error: parsed.error.errors[0].message };
  const { owner, repo } = parseGithubUrl(parsed.data);
  return { valid: true, owner, repo, normalizedURL: `https://github.com/${owner}/${repo}` };
}

// Slower, server-side: also verifies the repo exists on GitHub
export async function validateGithubRepoExists(
  owner: string,
  repo: string,
): Promise<{ exists: boolean; error?: string }> {
  try {
    await fetchRepoMetadata(owner, repo);
    return { exists: true };
  } catch {
    return { exists: false, error: "Repository does not exist or is not accessible." };
  }
}
```

Use `validateGithubUrlFormat` in the `useEffect` in `repo-evaluator.tsx` for instant inline feedback, and call `validateGithubRepoExists` only on submit.

### TODO (line 252 & 336): Don't fetch contributors at add-repo time

Move `fetchContributors` and `createMany` into a lazy helper that runs on first message send:

```ts
// In sendChatMessageWithFeatures, before the contributors query:
const existingCount = await prisma.contributor.count({ where: { repositoryId: repoId } });
if (existingCount === 0) {
  const { owner, name } = await getRepoOwnerName(repoId);
  const contribs = await fetchContributors(owner, name);
  await prisma.contributor.createMany({
    data: contribs.map((c) => ({
      repositoryId: repoId,
      githubLogin: c.login,
      avatarUrl: c.avatar_url,
      totalCommits: c.contributions,
    })),
    skipDuplicates: true,
  });
}
```

### TODO (line 270–287): Fallback email lookup for `userId`

The fallback email path is unused with Credentials provider (the JWT callback always sets `token.id`). You can simplify both `addRepository` and `deleteRepository` to:

```ts
const session = await auth();
const userId = (session?.user as { id?: string } | undefined)?.id;
if (!userId) redirect("/login");
```

### TODO (line 319): Why fetch `latestSha` at add-repo time?

It's used to set `lastCommitSha` on the new Repository row so the staleness checks work on first chat open. This is correct — keep it.

### TODO (line 363): Remove `github_url` from redirect search params?

Keeping the URL in params lets the sidenav chat history links be self-contained and lets the page handle deep links. It's a valid trade-off. If you want cleaner URLs, remove it and rely only on `chatId` + DB lookup, but that adds a round-trip. Current approach is fine.

### TODO (line 593): Send one batch request to RAG per feature, not one per contributor

**Best practice:** Add a new batch endpoint to the RAG service:

```ts
// In actions.ts — replace the per-contributor loop
const questionsByContrib = await generateQuestionsForAllContributors(
  repoId,
  contributors.map((c) => ({ id: c.id, login: c.githubLogin })),
  chatId,
);
```

See [Section 14](#14-rag-main-todos) for the RAG service side.

### TODO (line 639 & 708): Combine `generate*` + `generateAndStore*` functions

The two-function pattern (`generateXxx` + `generateAndStoreXxx`) is actually good separation of concerns. Keep it, but add the SHA staleness guard at the top of `generateAndStoreRepoSummary`:

```ts
export async function generateAndStoreRepoSummary(
  repoId: string,
  currentSha: string,
): Promise<string> {
  // Guard: don't regenerate if the stored summary is already for this SHA
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastSummarySha: true },
  });
  if (repo?.lastSummarySha === currentSha) {
    const stored = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { repoSummary: true },
    });
    return stored?.repoSummary ?? "";
  }
  const summary = await generateRepoSummary(repoId);
  await prisma.repository.update({
    where: { id: repoId },
    data: { repoSummary: summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, "max");
  return summary;
}
```

### TODO: Consistent typecasting / error details

Standardize on `String(errorBody?.detail ?? "")` everywhere. Find-replace all occurrences in the file for uniformity.

---

## 3. `app/lib/data.ts` TODOs

### TODO (line 11): `fetchRepositoriesByUser` — not needed?

Correct. `fetchChatHistoryByUser` (line 171) is the function that powers the sidebar. Remove `fetchRepositoriesByUser`, `fetchFilteredRepositories`, and `fetchRepositoryPages` unless you add a search/browse page. Mark them with `@deprecated` until removed.

### TODO (line 22): Deduplication step needed?

A user can have only one chat per repository (enforced by `getOrCreateChat`), so deduplication is never needed. Remove the `Map` dedup:

```ts
return prisma.chat.findMany({ where: { userId }, include: { repository: true }, orderBy: { createdAt: "desc" } });
```

### TODO (line 157): Consistent error handling

Already using `try/catch` in this file. The pattern is correct. Ensure all data functions in `data.ts` follow the same shape:

```ts
try {
  return await unstable_cache(async () => { /* query */ }, [cacheKey], { tags })();
} catch (err) {
  console.error("DB Error:", err);
  throw new Error("Human-readable message");
}
```

### TODO (line 200): `fetchLatestQuestions` — not needed

Remove it. Questions are returned inline in the chat message and not fetched separately.

### TODO (line 216): Move all DB fetching here

Good architectural goal. Move the inline Prisma queries from `actions.ts` (like the `prisma.repository.findUnique` in `getRepoOwnerName`) to `data.ts`:

```ts
// data.ts
export async function fetchRepoOwnerName(id: string): Promise<{ owner: string; name: string }> {
  try {
    const repo = await prisma.repository.findUnique({
      where: { id },
      select: { owner: true, name: true },
    });
    if (!repo) throw new Error("Repository not found.");
    return repo;
  } catch (err) {
    console.error("DB Error:", err);
    throw err;
  }
}
```

---

## 4. `app/lib/github.ts` TODOs

### TODO (line 9): Add error handling and caching

Wrap each function and add Next.js `fetch` cache options:

```ts
export async function fetchRepoMetadata(owner: string, repo: string) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers,
    next: { revalidate: 60 }, // cache for 60 s
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}
```

Similarly for `fetchContributors` and `fetchLatestCommitSha`. For the latest commit SHA use a short TTL (e.g., `next: { revalidate: 30 }`) since staleness directly affects the UX.

### TODO (line 54 & 66): `fetchFileTree` and `fetchFileContent` — not needed?

These two functions are not called from the Next.js side at all; the RAG service does the file fetching itself. Delete them from `github.ts` to keep the file small. If you ever need them server-side again, they are easy to re-add.

### TODO (line 32): Only 30 contributors

30 is sufficient. GitHub's default sort is by commit count descending, which gives the most relevant contributors. Leave it.

---

## 5. `app/lib/utils.ts` & `definitions.ts` TODOs

### TODO (`utils.ts` line 72): Remove tutorial content

The file currently exports `formatCurrency`, `formatDateToLocal`, `generateYAxis`, and `generatePagination` — all from the Next.js tutorial, none used in the actual working code. Delete the file contents and keep only a comment:

```ts
// Utility functions — add project-specific helpers here as needed.
export {};
```

### TODO (`definitions.ts` line 90): Remove tutorial types

Delete `Customer`, `Invoice`, `Revenue`, `LatestInvoice`, `LatestInvoiceRaw`, `InvoicesTable`, `CustomersTableType`, `FormattedCustomersTable`, `CustomerField`, `InvoiceForm`. Keep only `User` if still referenced, or replace it with the Prisma-generated type:

```ts
// definitions.ts — keep only project types
// Prefer importing types directly from @prisma/client in most files.
export type ChatHistoryItem = {
  id: string;
  repositoryId: string;
  repository: { name: string; githubUrl: string };
  _count: { messages: number };
};
```

---

## 6. `app/ui/button.tsx` TODOs

### TODO (line 16): Custom prop name for `className`

**Current way is fine.** Using `className` is the React/HTML convention. Renaming it (e.g., `extraClass`) would break the standard `ButtonHTMLAttributes` merge pattern. Leave it as-is.

---

## 7. Forms TODOs

### `login-form.tsx` TODO (line 37): Use `isPending` for loading state

```tsx
<Button className="mt-4 w-full" disabled={isPending}>
  {isPending ? "Logging in..." : "Log in"}
  {!isPending && <ArrowRightIcon className="ml-auto h-5 w-5 text-gray-50" />}
</Button>
```

### `signup-form.tsx` TODO (line 142): Track which errors go in `message`

`message` currently catches: DB error on user creation, and `AuthError` on sign-in after registration. This is already well-defined. The TODO is just a documentation note. Add a JSDoc comment:

```tsx
{/* state.message contains: DB errors, or auth errors after account creation */}
```

---

## 8. `app/ui/skeletons.tsx` TODOs

### TODO (line 3): Create project-specific skeletons

Replace the tutorial skeletons with ones that match the actual pages. Keep the `shimmer` animation constant and add:

```tsx
// Keep the shimmer constant, delete everything else, add:

export function RepoInputSkeleton() {
  return (
    <div className={`${shimmer} relative overflow-hidden rounded-lg border border-gray-200 bg-white p-6 shadow-sm`}>
      <div className="mb-4 h-6 w-40 rounded bg-gray-200" />
      <div className="flex gap-2">
        <div className="h-10 flex-1 rounded-md bg-gray-200" />
        <div className="h-10 w-28 rounded-lg bg-gray-200" />
      </div>
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
          <div className={`${shimmer} relative h-12 w-64 overflow-hidden rounded-lg bg-gray-200`} />
        </div>
      ))}
    </div>
  );
}

export function SidenavChatSkeleton() {
  return (
    <div className="space-y-1 px-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`${shimmer} relative h-12 overflow-hidden rounded-md bg-gray-100`} />
      ))}
    </div>
  );
}
```

Use `RepoInputSkeleton` in `app/dashboard/(home)/page.tsx`:
```tsx
<Suspense fallback={<RepoInputSkeleton />}>
  <RepoEvaluatorSection userId={userId} />
</Suspense>
```

---

## 9. Dashboard SideNav TODOs

### TODO (line 12 & 13): Error handling + missing user

Already handled — when `userId` is `undefined`, `chats` defaults to `[]` and the "Sign in to view Chat history" message is shown. This is correct.

### TODO (line 20): Remove blue box, add logo

Replace the empty blue `<Link>` with the branding from the auth layout:

```tsx
<Link href="/" className="mb-2 flex items-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-white">
  <CodeBracketIcon className="h-6 w-6" />
  <span className="text-sm font-bold">CodeEvalHub</span>
</Link>
```

Add `import { CodeBracketIcon } from "@heroicons/react/24/outline";` at the top.

### TODO (line 23): `<NavLinks>` only shows Dashboard — simplify

Delete `nav-links.tsx` and inline the single link:

```tsx
{/* Replace <NavLinks /> with: */}
<Link
  href="/dashboard"
  className="flex h-[48px] items-center gap-2 rounded-md bg-gray-50 px-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:p-2"
>
  <HomeIcon className="w-6" />
  <span className="hidden md:block">Dashboard</span>
</Link>
```

### TODO (line 45): Replace inline `signOut` action with `logout` from `actions.ts`

```tsx
import { logout } from "@/app/lib/actions";
// …
<form action={logout}>
  <button
    type="submit"
    className="flex h-[48px] w-full grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3"
  >
    <PowerIcon className="w-6" />
    <div className="hidden md:block">Sign Out</div>
  </button>
</form>
```

---

## 10. Repo Evaluator TODOs

### TODO (line 13): `userId` prop not needed

The `addRepository` server action fetches `userId` from the session server-side. Remove the `userId` prop from `RepoEvaluatorSection` and the corresponding prop in `DashboardPage`.

### TODO (line 24–31): `repoId`/`chatId` from `searchParams` in this component

These search params are set by the `redirect()` call inside `addRepository`, which means the browser navigates to `/dashboard/chat?...` before this component is visible again. So `repoId`/`chatId` from params are never used here. Remove those lines:

```ts
// Remove:
const repoId = state.repoId ?? searchParams.get("repoId") ?? undefined;
const chatId = state.chatId ?? searchParams.get("chatId") ?? undefined;
const repoNameFromParams = searchParams.get("repo_name") ?? undefined;
// And the useSearchParams import if nothing else uses it.
```

### TODO (line 69): Match request reference on success too

Fix the race condition by always checking the ref:

```ts
// After the try/catch result assignment:
if (requestId !== requestIdRef.current) return; // ← add this before the if(result.valid) block
if (result.valid) { … }
```

### TODO (line 79 & 88): Only format-check in the debounced effect

```ts
// In useEffect — replace validatedGithubRepoUrl call with:
const result = validateGithubUrlFormat(value); // fast, no network call
if (result.valid) {
  setUrlStatus("valid");
  setUrlMessage("URL looks good.");
  setValidatedRepoName(result.repo ?? "");
} else {
  setUrlStatus("invalid");
  setUrlMessage(result.error ?? "Invalid repository URL.");
}
// Remove the try/catch and the timeout entirely for format check.
// The actual GitHub existence check happens server-side on submit in addRepository.
```

### TODO (line 97–99): `useDebounce` custom hook

Create `app/ui/hooks/useDebounce.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

Then in `repo-evaluator.tsx`:
```ts
const debouncedUrl = useDebounce(urlInput, 500);
useEffect(() => {
  if (!debouncedUrl.trim()) { setUrlStatus("idle"); return; }
  const result = validateGithubUrlFormat(debouncedUrl);
  setUrlStatus(result.valid ? "valid" : "invalid");
  setUrlMessage(result.valid ? "URL looks good." : (result.error ?? "Invalid URL"));
  setValidatedRepoName(result.valid ? (result.repo ?? "") : "");
}, [debouncedUrl]);
```

### TODO (line 113): `id` attribute for accessibility

Add `aria-label` to the input:

```tsx
<input
  aria-label="GitHub repository URL"
  // …
/>
```

### TODO (line 131): Button when input is empty

The button should be disabled only when the input is non-empty **and** not yet valid (to prevent submitting an invalid URL). When input is empty the browser's `required` attribute on the form handles it:

```tsx
disabled={
  urlStatus === "checking" ||
  (urlInput.trim().length > 0 && urlStatus !== "valid")
}
```

This is already correct. The TODO is a non-issue.

### TODO (line 146): Use `clsx` for status message

```tsx
import clsx from "clsx";
// …
<p
  className={clsx("mt-2 text-sm", {
    "text-green-600": urlStatus === "valid",
    "text-red-500": urlStatus === "invalid",
    "text-gray-500": urlStatus === "checking",
  })}
>
```

---

## 11. Chat Section TODOs

### TODO (line 22–25): Move types to `definitions.ts`

```ts
// Move to app/lib/types.ts or definitions.ts:
export type RepoAction = import("@prisma/client").MessageFeature;
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  features?: RepoAction[];
};
```

### TODO (line 56): Remove unused props

Remove `chatLastViewedContribSummarySha = ZodNullable` — `ZodNullable` is incorrectly used as a default value. Change to:
```tsx
chatLastViewedContribSummarySha = null,
```

Also remove the `ZodNullable` import.

### TODO (line 82): Initialize states from props

Already done for `repoSummaryText` and `contribSummaries`. The only remaining state is `viewMode`, which defaults to `"chat"` correctly.

### TODO (line 124): Redirect if no repo loaded

```tsx
if (!isRepoLoaded) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-gray-500">
        <Link href="/dashboard" className="text-blue-500 hover:underline">
          Add a repository
        </Link>{" "}
        to start chatting.
      </p>
    </div>
  );
}
```

### TODO (line 136): Single SHA for all contributors

Agreed. Replace the per-contributor SHA logic with a single `latestContribSummarySha` (already derived at line 139). This is already being used to check `contribSummariesUpdatedSinceViewed`. The `chatLastViewedContribSummarySha` prop already stores one value for all contributors. The current implementation is correct at the data level. Clean up the comment explaining the per-contributor vs single SHA distinction.

### TODO (line 160): Get live SHA from props

Move the `fetchCurrentGithubSha` call to the server (`chat/page.tsx`) and pass it as a prop:

```ts
// chat/page.tsx — add alongside existing fetches:
const { owner, name } = parseGithubUrl(params.github_url ?? "");
const [initialMessages, chatContext, liveGithubSha] = await Promise.all([
  params?.chatId ? fetchMessagesByChat(params.chatId) : Promise.resolve([]),
  params?.chatId ? fetchChatWithRepoAndContribs(params.chatId) : Promise.resolve(null),
  owner && name ? fetchLatestCommitSha(owner, name).catch(() => null) : Promise.resolve(null),
]);
```

Pass as `initialLiveGithubSha={liveGithubSha}` and initialise state:
```ts
const [liveGithubSha, setLiveGithubSha] = useState(initialLiveGithubSha ?? null);
```

### TODO (line 173 & 195): Split the combined `useEffect`

```ts
// Effect 1: fetch live SHA when entering summary view
useEffect(() => {
  if (viewMode !== "summary" || !repoOwner || !repoName) return;
  void fetchCurrentGithubSha(repoOwner, repoName)
    .then(setLiveGithubSha)
    .catch(/* … */);
}, [viewMode, repoOwner, repoName]);

// Effect 2: record that user has viewed the summaries
useEffect(() => {
  if (viewMode !== "summary" || !chatId) return;
  if (repoLastSummarySha)
    void updateChatViewedSha(chatId, repoLastSummarySha).catch(() => {});
  if (latestContribSummarySha)
    void updateChatViewedContribSummarySha(chatId, latestContribSummarySha).catch(() => {});
}, [viewMode, chatId, repoLastSummarySha, latestContribSummarySha]);
```

### TODO (line 217 & 239): Add error handling to summary generators

```ts
async function handleGenerateRepoSummary() {
  if (!repoId || !liveGithubSha) return;
  setSummaryLoading("repo");
  setSendError(null);
  try {
    const text = await generateAndStoreRepoSummary(repoId, liveGithubSha);
    setRepoSummaryText(text);
  } catch (err) {
    setSendError(err instanceof Error ? err.message : "Summary generation failed.");
  } finally {
    setSummaryLoading(null);
  }
}
```

Same pattern for `handleGenerateAllContribSummaries`.

### TODO (line 284): Streaming responses

To stream the LLM response word-by-word:
1. Change the RAG `/chat` endpoint to return a `StreamingResponse`.
2. In Next.js, create `app/api/chat/route.ts` that proxies to the RAG stream.
3. On the client, use `fetch` with `response.body.getReader()` and update the assistant message incrementally.

This is a larger feature. Use the Server-Sent Events approach:
```ts
// app/api/chat/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const ragRes = await fetch(`${RAG_URL}/chat/stream`, { method: "POST", body: JSON.stringify(body), … });
  return new Response(ragRes.body, { headers: { "Content-Type": "text/event-stream" } });
}
```

### TODO (line 534): Use `getActionLabel` instead of `.find()`

```tsx
{REPO_ACTIONS.find((a) => a.id === id)?.label}
// Change to:
{getActionLabel(id)}
```

### TODO (line 338): Summary tab UX improvements (big TODO block)

The complete implementation guide:

1. **Show "View Summary" vs "Regenerate"** — gate on `repoSummaryIsStale`:
```tsx
<button onClick={handleGenerateRepoSummary} disabled={…}>
  {summaryLoading === "repo"
    ? "Generating…"
    : !repoLastSummarySha
    ? "Generate Repo Summary"
    : repoSummaryIsStale
    ? "Regenerate Repo Summary"
    : "View Repo Summary"}
</button>
```
2. **Disable the other button while one is loading** — use `summaryLoading !== null` as the disabled condition for both buttons.
3. **Only show stale notifications when truly stale** — already done via `repoUpdatedSinceViewed` and `contribSummariesUpdatedSinceViewed`.
4. **Date separator in chat (like WhatsApp)** — between two messages, if their `createdAt` differs by more than 1 day (or if `chatIsStale` becomes true at a specific message boundary), insert:
```tsx
<div className="text-center text-xs text-gray-400 my-2">
  Repository was updated — replies use the newest version
</div>
```

---

## 12. Chat History TODOs

### TODO (line 7): Move `ChatHistoryItem` type to `definitions.ts`/`types.ts`

```ts
// app/lib/types.ts
export type ChatHistoryItem = {
  id: string;
  repositoryId: string;
  repository: { name: string; githubUrl: string };
  _count: { messages: number };
};
```

Import in `chat-history.tsx`:
```ts
import type { ChatHistoryItem } from "@/app/lib/types";
```

---

## 13. RAG Pipeline TODOs

### TODO (line 30): Higher temperature for question generation

The `llm` instance is shared. Create a second instance for questions:

```python
llm_creative = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="llama-3.3-70b-versatile",
    temperature=0.7,  # more variety across users
)
```

Use `llm_creative` in `build_question_chain` and `build_contributor_summary_chain`.

### TODO (line 95): Broader context for summary

Two options:

**Option A — Increase k:**
```python
def build_summary_chain(vector_store):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 20})
```

**Option B (better) — Use MMR retrieval to get diverse coverage:**
```python
retriever = vector_store.as_retriever(
    search_type="mmr",  # Maximum Marginal Relevance — diverse results
    search_kwargs={"k": 20, "fetch_k": 50},
)
```

MMR retrieves 50 candidates and selects the 20 most diverse ones, giving broader repository coverage than pure similarity.

### TODO (line 116): Refine contributor prompt

Improved prompt:
```python
CONTRIBUTOR_PROMPT = PromptTemplate(
    template="""You are a senior engineering manager reviewing a contributor's work.

Contributor: {login}
Commit diffs (most recent first):
{context}

Write a concise professional summary covering:
1. **Primary areas** of the codebase they own or contribute to most.
2. **Contribution type** — features, bug fixes, refactors, tests, docs.
3. **Code quality signals** — commit message quality, diff size, patterns.
4. **Overall activity** — frequent contributor or occasional?

Keep it to 3–4 short paragraphs. Be factual and constructive.
""",
    input_variables=["context", "login"],
)
```

### TODO (line 163 & 178): Remove `question_type`, return a Runnable chain

```python
QUESTION_PROMPT = PromptTemplate(
    template="""You are a technical interviewer evaluating a contributor based on their actual code changes.

Contributor: {login}
Commit diffs:
{context}

{custom_prompt}

Generate 5 specific, thoughtful evaluation questions about this contributor's actual work.
Vary difficulty: 2 easy, 2 medium, 1 hard.
Return ONLY a numbered list. No preamble.
""",
    input_variables=["context", "login", "custom_prompt"],
)

def build_question_chain(vector_store, login: str, custom_prompt: str = ""):
    retriever = vector_store.as_retriever(
        search_type="mmr", search_kwargs={"k": 6, "fetch_k": 20}
    )
    return (
        RunnableLambda(lambda _: login)
        | RunnableParallel({
            "context": retriever | RunnableLambda(format_docs),
            "login": RunnablePassthrough(),
        })
        | RunnableLambda(lambda d: {**d, "custom_prompt": custom_prompt or "Focus on design decisions and code quality."})
        | QUESTION_PROMPT
        | llm_creative
        | StrOutputParser()
    )
```

---

## 14. RAG `main.py` TODOs

### TODO (line 29 & 154): Fetch SHAs in Next.js, send in request body

Already done for `/ingest` (`last_sha` is in the request body). For `/summarize` and `/contributor-summary`, add it too:

```python
class SummarizeRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    current_sha: str  # sent from Next.js, no DB/GitHub call needed in Python

class ContributorRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    contributor_login: str
    since_sha: str | None = None  # only fetch commits after this SHA
```

### TODO (line 78 & 87): Batch contributor endpoint

Add a new endpoint to handle all contributors in one request:

```python
class BatchContributorRequest(BaseModel):
    repo_id: str
    owner: str
    repo_name: str
    contributors: list[str]  # list of github logins
    custom_prompt: str = ""

@app.post("/batch-contributor-questions")
def batch_contributor_questions(data: BatchContributorRequest):
    results = {}
    for login in data.contributors:
        contributor_text = build_contributor_text(data.owner, data.repo_name, login)
        vs = get_or_create_vector_store(contributor_text, data.repo_id, scope=login)
        chain_fn = build_question_chain(vs, login, data.custom_prompt)
        raw = chain_fn(None)
        questions = [
            re.sub(r"^\d+[\.\)]\s*", "", line).strip()
            for line in raw.strip().split("\n")
            if line.strip() and re.match(r"^\d+", line.strip())
        ]
        results[login] = questions[:5]
    return {"questions": results}
```

Call this single endpoint from `sendChatMessageWithFeatures` instead of the per-contributor loop.

### TODO (line 255): Incremental embedding updates

Instead of re-creating the full vector store on each ingestion, use FAISS's `merge_from` to add only new documents:

```python
# In vector_store.py — add update function
def update_vector_store(new_text: str, repo_id: str, scope: str = "repo") -> FAISS:
    """Add new documents to an existing vector store (incremental update)."""
    existing = load_vector_store(repo_id, scope)
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    new_chunks = splitter.create_documents([new_text])
    if not new_chunks:
        return existing

    new_vs = FAISS.from_documents(new_chunks, EMBEDDINGS)
    if existing is not None:
        existing.merge_from(new_vs)
        updated = existing
    else:
        updated = new_vs

    # Upload updated store
    object_key = _object_key(repo_id, scope)
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        path.parent.mkdir(parents=True, exist_ok=True)
        updated.save_local(str(path))
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)
    return updated
```

Use `update_vector_store` in `/ingest` when `last_sha` is provided (delta update), and `create_vector_store` only for first-time ingestion.

---

## 15. `github_loader.py` TODOs

### TODO (line 54): Proper error handling in `fetch_file_tree`

```python
data = r.json()
tree = data.get("tree")
if tree is None:
    raise ValueError(f"Unexpected GitHub API response for {owner}/{repo}: missing 'tree' key")
return [item for item in tree if …]
```

### TODO (line 71): Consistent error handling

```python
def fetch_file_content(owner: str, repo: str, path: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()  # consistent with other functions
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")
```

### TODO (line 129): Pass `since_sha` to `build_contributor_text`

```python
def build_contributor_text(owner: str, repo: str, login: str, since: str | None = None) -> str:
    commits = fetch_commits_by_contributor(owner, repo, login, since=since)
    # …
```

Call it with the last ingested SHA from the request body:
```python
contributor_text = build_contributor_text(
    data.owner, data.repo_name, data.contributor_login, since=data.since_sha
)
```

---

## 16. `vector_store.py` TODOs

### TODO (line 22): Consider code-specific embedding model

`all-MiniLM-L6-v2` is a general-purpose model. For code repositories, consider:

- **`microsoft/codebert-base`** — fine-tuned on code, good for semantic code search.
- **`sentence-transformers/all-mpnet-base-v2`** — larger general model, better quality than MiniLM.
- **`BAAI/bge-small-en-v1.5`** — very fast, often outperforms MiniLM on retrieval benchmarks.

For code specifically, `BAAI/bge-small-en-v1.5` is a solid choice. Change it as:
```python
EMBEDDINGS = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-en-v1.5",
    encode_kwargs={"normalize_embeddings": True},
)
```

### TODO: Singleton S3 client

In `storage.py`, create the client once at module level:
```python
_s3_client = None

def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(…)
    return _s3_client
```

---

## 17. UI Consistency

The `/` page and the auth pages (login, signup) share a polished, dark-gradient theme:
```
bg-gradient-to-br from-blue-900 to-slate-900
```
with white/light card content on top. The dashboard pages currently use a plain white background.

**Recommended approach: keep the dashboard white** (standard SaaS pattern — dark landing, light app interior), but apply the same design language (fonts, border-radius, shadow, blue accent colour) to the dashboard.

### Pages that need updating

#### `app/dashboard/(home)/page.tsx`
Add a subtle gradient header strip instead of plain white:
```tsx
// Replace the h1 + p section with:
<div className="mb-6 rounded-xl bg-gradient-to-r from-blue-900 to-slate-800 px-6 py-5 text-white shadow">
  <h1 className="text-2xl font-bold">
    Welcome back, {session?.user?.email?.split("@")[0] ?? "User"} 👋
  </h1>
  <p className="mt-1 text-sm text-blue-200">
    Enter a GitHub repository URL below to start analysing and chatting with the codebase.
  </p>
</div>
```

#### `app/ui/dashboard/sidenav.tsx`
The sidenav header (the blue box) should become a proper logo bar matching the auth header:
```tsx
<Link
  href="/"
  className="mb-2 flex items-center gap-2 rounded-md bg-gradient-to-r from-blue-800 to-blue-600 px-4 py-3 text-white shadow-sm"
>
  <CodeBracketIcon className="h-6 w-6 flex-shrink-0" />
  <span className="hidden text-sm font-bold md:block">CodeEvalHub</span>
</Link>
```

#### `app/dashboard/chat/page.tsx`
The `<main>` wrapper should have the same dimensions as the dashboard home to avoid layout shifts:
```tsx
<main className="flex h-full min-h-0 w-full flex-col">
```
(Already correct. No change needed.)

#### `app/dashboard/(home)/loading.tsx`
Replace the default loading with the new skeleton:
```tsx
import { RepoInputSkeleton } from "@/app/ui/skeletons";

export default function Loading() {
  return (
    <main className="flex h-full w-full flex-col">
      <div className="mb-6 h-24 animate-pulse rounded-xl bg-gradient-to-r from-blue-900 to-slate-800" />
      <RepoInputSkeleton />
    </main>
  );
}
```

#### `app/(auth)/layout.tsx`
Already matches the `/` page style. No change needed.

#### `app/page.tsx`
Already matches the auth layout style. No change needed.

---

## 18. RAG Pipeline Performance

### Why it is slow

The RAG pipeline has **four stacked latency sources**:

#### 1. Sequential file fetching (biggest bottleneck)
`build_repo_text` in `github_loader.py` fetches files one by one in a Python `for` loop:
```python
for f in files:
    content = fetch_file_content(owner, repo, f["path"])  # blocking HTTP call
```
For a 50-file repository that's 50 sequential HTTPS round-trips, each 100–300 ms → **5–15 seconds just for file fetching**.

**Fix — use `asyncio` + `httpx.AsyncClient`:**
```python
import asyncio
import httpx

async def fetch_file_content_async(client: httpx.AsyncClient, owner, repo, path) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = await client.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")

async def build_repo_text_async(owner: str, repo: str) -> str:
    files = fetch_file_tree(owner, repo)  # still sync, one call
    async with httpx.AsyncClient() as client:
        tasks = [fetch_file_content_async(client, owner, repo, f["path"]) for f in files]
        contents = await asyncio.gather(*tasks)  # all files in parallel
    parts = []
    for f, content in zip(files, contents):
        if content.strip():
            parts.append(f"### FILE: {f['path']}\n\n{content}\n")
    return "\n\n".join(parts)

def build_repo_text(owner: str, repo: str) -> str:
    return asyncio.run(build_repo_text_async(owner, repo))
```

Since FastAPI endpoints are sync (`def ingest_repo(…)`) you need `asyncio.run()`. Or convert the endpoint to `async def` and `await` directly (FastAPI supports both).

#### 2. Sequential commit-diff fetching
Same issue — `build_contributor_text` fetches each commit's diff one by one. Apply the same async pattern with `asyncio.gather`.

#### 3. Vector store download on every request
Every call to `load_vector_store` downloads the FAISS index from S3 to a temp dir. For a 50-file repo this can be several MB.

**Fix — in-process LRU cache:**
```python
from functools import lru_cache

# Thread-safe module-level cache
_vs_cache: dict[str, FAISS] = {}

def load_vector_store(repo_id: str, scope: str = "repo") -> Optional[FAISS]:
    cache_key = f"{repo_id}:{scope}"
    if cache_key in _vs_cache:
        return _vs_cache[cache_key]

    # … existing S3 download logic …
    vs = FAISS.load_local(…)
    _vs_cache[cache_key] = vs
    return vs
```

Invalidate the cache key after a new `create_vector_store`:
```python
def create_vector_store(text, repo_id, scope="repo"):
    # … existing code …
    cache_key = f"{repo_id}:{scope}"
    _vs_cache.pop(cache_key, None)  # invalidate stale entry
    _vs_cache[cache_key] = vector_store
    return vector_store
```

#### 4. HuggingFace embedding model cold start
`EMBEDDINGS = HuggingFaceEmbeddings(…)` downloads and loads the model when the Python process starts. This is a one-time cost (~2–5 s). Once loaded it's fast (MiniLM is ~22 MB). This is already handled correctly — the module-level instantiation means it loads once per process.

**To speed it up further**, use a GPU-accelerated backend if your deployment has a GPU, or switch to the Groq embedding API (already authenticated) to offload embedding to the API server.

#### 5. New S3 client per call
`_client()` in `storage.py` creates a `boto3.client` on every upload/download. boto3 clients are lightweight but not free.

**Fix — singleton client** (see [Section 16](#16-vector-store-todos)).

#### 6. Groq LLM latency
`llama-3.3-70b-versatile` on Groq is already very fast (Groq uses LPU hardware). Typical TTFT (time-to-first-token) is < 300 ms and generation is ~500 tokens/s. This is not the bottleneck.

### Summary of performance improvements

| Source | Current | Fixed | Expected Saving |
|---|---|---|---|
| File fetching | Sequential | Parallel (`asyncio.gather`) | **80–90%** reduction |
| Commit diff fetching | Sequential | Parallel | **80–90%** reduction |
| Vector store loading | S3 download every request | In-process LRU cache | **95%** on warm requests |
| Embedding generation | Re-generated on each ingest | Incremental (`merge_from`) | **50–70%** on re-ingests |
| S3 client init | New client per call | Singleton | Minor (~5 ms) |

For a typical 50-file repository, the current total ingestion time is **30–90 seconds**. With parallel file fetching + in-process caching, it should drop to **5–15 seconds** for first ingestion and **< 1 second** for chat/summary on warm cache.

---

*End of guide.*
