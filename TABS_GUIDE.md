# Tab-Based Repository Actions – Implementation Guide

This guide walks you through converting the single-chat interface into a **tab-based** layout where each repository action (Summary, Contributors Summary, Questions, Chat) lives in its own tab. Both repo and contributor summaries are stored in the database alongside the commit SHA at generation time, so the UI can always show "Generate", "Regenerate" (new commits), or "View" (up-to-date) buttons – both for the first visit and for returning to an old chat.

---

## Design: how commitSha drives button state

```
For Repository Summary
─────────────────────
Repository.summary == null
  → "Generate Summary"

Repository.summaryCommitSha != Repository.lastCommitSha
  → show stored summary + "Regenerate Summary" + amber notice

Repository.summaryCommitSha == Repository.lastCommitSha
  → show stored summary only (already current)

For each Contributor Summary (same pattern)
──────────────────────────────────────────
Contributor.summary == null
  → "Generate Summary"

Contributor.summaryCommitSha != Repository.lastCommitSha   ← compare against REPO's sha
  → show stored summary + "Regenerate Summary" + amber notice

Contributor.summaryCommitSha == Repository.lastCommitSha
  → show stored summary only
```

`Repository.lastCommitSha` is updated on every ingestion (already happens in `triggerRepoIngestion`).  
`Repository.summaryCommitSha` / `Contributor.summaryCommitSha` are written whenever a summary is (re)generated.  
`Message.commitSha` records the repo's `lastCommitSha` at the moment an assistant summary message was saved – useful for historical chat views.

---

## Overview of Changes

| Area | What changes |
|---|---|
| `prisma/schema.prisma` | Add `summary` + `summaryCommitSha` to `Repository`; add `summaryCommitSha` to `Contributor`; add `commitSha` to `Message` |
| `app/lib/data.ts` | Add `RepoSummaryState`, `fetchRepoSummaryState()`; add `ContributorSummaryState`, `fetchContributorSummaryStates()` |
| `app/lib/actions.ts` | Persist `summaryCommitSha` in `generateRepoSummary()` and `generateContributorSummary()`; store `commitSha` on assistant messages in `sendChatMessageWithFeatures()` |
| `app/ui/dashboard/repo-actions-tabs.tsx` | New file – full tab component (replaces `chat-section.tsx`) |
| `app/dashboard/chat/page.tsx` | Fetch both `repoSummaryState` and `contributorStates` server-side and pass as props |

No other files need to change.

---

## Step 1 – DB Schema

**File:** `prisma/schema.prisma`

### 1a. Repository model – add `summary` and `summaryCommitSha`

Find the `Repository` model and add two fields after `lastCommitSha`:

```prisma
model Repository {
  id                 String              @id @default(cuid())
  githubId           Int                 @unique
  githubUrl          String
  owner              String
  name               String
  description        String?
  language           String?
  lastCommitSha      String?
  summary            String?             // ← ADD
  summaryCommitSha   String?             // ← ADD (sha when summary was generated)
  repoFaissUri       String?
  createdAt          DateTime            @default(now())
  contributors       Contributor[]
  chats              Chat[]
  generatedQuestions GeneratedQuestion[]
}
```

### 1b. Contributor model – add `summaryCommitSha`

The `Contributor` model already has a `summary String?` field. Add one new field after it:

```prisma
model Contributor {
  id                 String              @id @default(cuid())
  repositoryId       String
  githubLogin        String
  avatarUrl          String?
  totalCommits       Int                 @default(0)
  summary            String?
  summaryCommitSha   String?             // ← ADD (sha when contributor summary was generated)
  faissUri           String?
  generatedQuestions GeneratedQuestion[]
  createdAt          DateTime            @default(now())
  repository         Repository          @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  @@unique([repositoryId, githubLogin])
  @@index([repositoryId])
}
```

### 1c. Message model – add `commitSha`

The `Message` model stores the repo's `lastCommitSha` at the moment an assistant summary message is saved. This lets you detect staleness when viewing old chat messages.

```prisma
model Message {
  id        String           @id @default(cuid())
  chatId    String
  role      MessageRole
  content   String
  features  MessageFeature[] @default([])
  commitSha String?          // ← ADD (repo lastCommitSha when this message was created)
  createdAt DateTime         @default(now())
  chat      Chat             @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@index([chatId])
}
```

### 1d. Run migration

```bash
npx prisma migrate dev --name add_summary_commit_sha
npx prisma generate
```

---

## Step 2 – data.ts: add state helpers for repo and contributors

**File:** `app/lib/data.ts`

Add all of this at the bottom of the file (after the existing `fetchLatestQuestions`):

```ts
// ─── Repo summary state ───────────────────────────────────────────────────────

export type RepoSummaryState =
  | { mode: 'generate'; summary: null }
  | { mode: 'regenerate'; summary: string }
  | { mode: 'view'; summary: string };

export async function fetchRepoSummaryState(
  repoId: string
): Promise<RepoSummaryState> {
  try {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: {
        summary: true,
        summaryCommitSha: true,
        lastCommitSha: true,
      },
    });

    if (!repo) throw new Error('Repository not found.');

    if (!repo.summary) return { mode: 'generate', summary: null };

    if (repo.lastCommitSha && repo.summaryCommitSha !== repo.lastCommitSha) {
      return { mode: 'regenerate', summary: repo.summary };
    }

    return { mode: 'view', summary: repo.summary };
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch summary state.');
  }
}

// ─── Contributor summary state ────────────────────────────────────────────────

export type ContributorSummaryState =
  | { mode: 'generate'; summary: null }
  | { mode: 'regenerate'; summary: string }
  | { mode: 'view'; summary: string };

export type ContributorWithSummaryState = {
  id: string;
  githubLogin: string;
  avatarUrl: string | null;
  totalCommits: number;
  state: ContributorSummaryState;
};

export async function fetchContributorSummaryStates(
  repositoryId: string
): Promise<ContributorWithSummaryState[]> {
  try {
    // We need the repo's lastCommitSha to compare against each contributor's summaryCommitSha
    const [contributors, repo] = await Promise.all([
      prisma.contributor.findMany({
        where: { repositoryId },
        orderBy: { totalCommits: 'desc' },
        select: {
          id: true,
          githubLogin: true,
          avatarUrl: true,
          totalCommits: true,
          summary: true,
          summaryCommitSha: true,
        },
      }),
      prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { lastCommitSha: true },
      }),
    ]);

    const repoLastSha = repo?.lastCommitSha ?? null;

    return contributors.map((c) => {
      let state: ContributorSummaryState;

      if (!c.summary) {
        state = { mode: 'generate', summary: null };
      } else if (repoLastSha && c.summaryCommitSha !== repoLastSha) {
        state = { mode: 'regenerate', summary: c.summary };
      } else {
        state = { mode: 'view', summary: c.summary };
      }

      return {
        id: c.id,
        githubLogin: c.githubLogin,
        avatarUrl: c.avatarUrl,
        totalCommits: c.totalCommits,
        state,
      };
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch contributor summary states.');
  }
}
```

---

## Step 3 – actions.ts: persist summaries and commitSha

**File:** `app/lib/actions.ts`

### 3a. Update `generateRepoSummary` to save summary + commitSha

Find `generateRepoSummary` (around line 547). It currently ends with:

```ts
  const data = await res.json();
  return data.summary as string;
}
```

Replace that ending block with:

```ts
  const data = await res.json();
  const summary = data.summary as string;

  // Always persist the latest summary + the sha it was generated at.
  // Any user regenerating the summary will update it for everyone.
  const repoRecord = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastCommitSha: true },
  });

  await prisma.repository.update({
    where: { id: repoId },
    data: {
      summary,
      summaryCommitSha: repoRecord?.lastCommitSha ?? null,
    },
  });

  revalidateTag(`repo-${repoId}`, 'max');
  return summary;
}
```

### 3b. Update `generateContributorSummary` to save summaryCommitSha

Find `generateContributorSummary` (around line 599). It currently ends with:

```ts
  await prisma.contributor.update({
    where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: contributorLogin } },
    data: { summary: data.summary },
  });
  return data.summary as string;
}
```

Replace that ending block with:

```ts
  // Fetch the repo's current lastCommitSha so we can record it on the contributor
  const repoRecord = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastCommitSha: true },
  });

  await prisma.contributor.update({
    where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: contributorLogin } },
    data: {
      summary: data.summary,
      summaryCommitSha: repoRecord?.lastCommitSha ?? null,
    },
  });
  return data.summary as string;
}
```

### 3c. Store `commitSha` on assistant messages in `sendChatMessageWithFeatures`

Find the assistant `prisma.message.create` call inside `sendChatMessageWithFeatures` (around line 533):

```ts
  const combined = blocks.join('\n\n---------------------------\n\n');
  await prisma.message.create({
    data:{
      chatId,
      role:'assistant',
      content: combined,
      features,
    },
  });
```

Replace it with:

```ts
  const combined = blocks.join('\n\n---------------------------\n\n');

  // Capture the repo's current lastCommitSha so that when this message is
  // viewed in the future, we can tell if the repo has moved on.
  const repoForSha = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastCommitSha: true },
  });

  await prisma.message.create({
    data:{
      chatId,
      role: 'assistant',
      content: combined,
      features,
      commitSha: repoForSha?.lastCommitSha ?? null,
    },
  });
```

> **Why?** When a user reopens an old chat, each assistant message now carries the sha that was current when it was generated. Comparing that against `Repository.lastCommitSha` lets you show a staleness badge ("⚠ Newer summary available") inline in the chat history – even if the summary tabs already show the latest state.

### 3d. No new server-action wrappers needed

`fetchRepoSummaryState` and `fetchContributorSummaryStates` are plain DB helpers. Call them directly from server components (the page). If you ever need to call them from a client component, wrap them:

```ts
// add near the bottom of actions.ts
import {
  fetchRepoSummaryState,
  fetchContributorSummaryStates,
  type RepoSummaryState,
  type ContributorWithSummaryState,
} from '@/app/lib/data';

export async function getRepoSummaryState(repoId: string): Promise<RepoSummaryState> {
  return fetchRepoSummaryState(repoId);
}

export async function getContributorSummaryStates(
  repoId: string
): Promise<ContributorWithSummaryState[]> {
  return fetchContributorSummaryStates(repoId);
}
```

---

## Step 4 – New tab-based client component

**File:** `app/ui/dashboard/repo-actions-tabs.tsx` *(create this new file)*

Key differences from the old `chat-section.tsx`:
- Four independent tabs; each manages its own state
- `SummaryTab` receives initial state from DB (generate / regenerate / view)
- `ContributorsSummaryTab` receives an **array** of per-contributor states from DB; each contributor has its own Generate/Regenerate/View button
- `ChatTab` shows a staleness badge on old messages whose `commitSha` differs from the repo's current `lastCommitSha`

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/app/ui/button";
import { PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { MessageFeature } from "@prisma/client";
import {
  sendChatMessageWithFeatures,
  generateRepoSummary,
  generateContributorSummary,
} from "@/app/lib/actions";
import type {
  RepoSummaryState,
  ContributorWithSummaryState,
  ContributorSummaryState,
} from "@/app/lib/data";

// ─── types ────────────────────────────────────────────────────────────────────

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  features?: MessageFeature[];
  commitSha?: string | null;
};

type TabId = "summary" | "contributors" | "questions" | "chat";

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Repository Summary" },
  { id: "contributors", label: "Contributors Summary" },
  { id: "questions", label: "Evaluation Questions" },
  { id: "chat", label: "Repository Chat" },
];

// ─── root component ───────────────────────────────────────────────────────────

export default function RepoActionsTabs({
  repoId,
  chatId,
  userId,
  repoLastCommitSha,
  initialMessages = [],
  initialSummaryState,
  initialContributorStates = [],
}: {
  repoId?: string;
  chatId?: string;
  userId: string;
  repoLastCommitSha?: string | null;
  initialMessages?: ChatMessage[];
  initialSummaryState: RepoSummaryState | null;
  initialContributorStates?: ContributorWithSummaryState[];
}) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const isRepoLoaded = !!repoId && !!chatId;

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors focus:outline-none
              ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === "summary" && (
          <SummaryTab
            repoId={repoId}
            isRepoLoaded={isRepoLoaded}
            initialState={initialSummaryState}
          />
        )}
        {activeTab === "contributors" && (
          <ContributorsSummaryTab
            repoId={repoId}
            isRepoLoaded={isRepoLoaded}
            initialStates={initialContributorStates}
          />
        )}
        {activeTab === "questions" && (
          <QuestionsTab
            repoId={repoId}
            chatId={chatId}
            isRepoLoaded={isRepoLoaded}
          />
        )}
        {activeTab === "chat" && (
          <ChatTab
            repoId={repoId}
            chatId={chatId}
            isRepoLoaded={isRepoLoaded}
            repoLastCommitSha={repoLastCommitSha}
            initialMessages={initialMessages.filter(
              (m) => !m.features?.length || m.features.includes("repo_chat")
            )}
          />
        )}
      </div>
    </div>
  );
}

// ─── Repository Summary Tab ───────────────────────────────────────────────────

function SummaryTab({
  repoId,
  isRepoLoaded,
  initialState,
}: {
  repoId?: string;
  isRepoLoaded: boolean;
  initialState: RepoSummaryState | null;
}) {
  const [summaryState, setSummaryState] = useState<RepoSummaryState | null>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttonLabel =
    !summaryState || summaryState.mode === "generate"
      ? "Generate Summary"
      : summaryState.mode === "regenerate"
        ? "Regenerate Summary"
        : "Refresh Summary";

  async function handleGenerate() {
    if (!isRepoLoaded || !repoId) return;
    setLoading(true);
    setError(null);
    try {
      const summary = await generateRepoSummary(repoId);
      setSummaryState({ mode: "view", summary });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate summary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isRepoLoaded && (
        <p className="text-sm text-gray-400">Load a repository to generate a summary.</p>
      )}

      {isRepoLoaded && (
        <>
          {summaryState?.summary && (
            <div className="rounded-md bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
              {summaryState.summary}
            </div>
          )}

          {summaryState?.mode === "regenerate" && (
            <p className="text-xs text-amber-600">
              ⚠ New commits detected – you can regenerate the summary.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? "Generating…" : buttonLabel}
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Contributors Summary Tab ─────────────────────────────────────────────────
// Each contributor has its own stored summary + Generate/Regenerate/View button.

function ContributorsSummaryTab({
  repoId,
  isRepoLoaded,
  initialStates,
}: {
  repoId?: string;
  isRepoLoaded: boolean;
  initialStates: ContributorWithSummaryState[];
}) {
  // Local state: map of contributorId → ContributorSummaryState
  // Initialised from the server-fetched array so we can update per-contributor
  const [states, setStates] = useState<
    Map<string, ContributorSummaryState>
  >(
    () => new Map(initialStates.map((c) => [c.id, c.state]))
  );
  const [loading, setLoading] = useState<string | null>(null); // contributorId that's loading
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  async function handleGenerate(contributorId: string, githubLogin: string) {
    if (!isRepoLoaded || !repoId) return;
    setLoading(contributorId);
    setErrors((prev) => { const m = new Map(prev); m.delete(contributorId); return m; });
    try {
      // generateContributorSummary is already exported from actions.ts
      const summary = await generateContributorSummary(repoId, githubLogin);
      setStates((prev) =>
        new Map(prev).set(contributorId, { mode: "view", summary })
      );
    } catch (e: unknown) {
      setErrors((prev) =>
        new Map(prev).set(
          contributorId,
          e instanceof Error ? e.message : "Failed to generate summary."
        )
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      {!isRepoLoaded && (
        <p className="text-sm text-gray-400">Load a repository first.</p>
      )}

      {isRepoLoaded && initialStates.length === 0 && (
        <p className="text-sm text-gray-400">No contributors found for this repository.</p>
      )}

      {isRepoLoaded &&
        initialStates.map((contributor) => {
          const state = states.get(contributor.id) ?? contributor.state;
          const isLoading = loading === contributor.id;
          const error = errors.get(contributor.id);

          const buttonLabel =
            state.mode === "generate"
              ? "Generate Summary"
              : state.mode === "regenerate"
                ? "Regenerate Summary"
                : "Refresh Summary";

          return (
            <div
              key={contributor.id}
              className="rounded-md border border-gray-200 p-4 space-y-3"
            >
              {/* Contributor header */}
              <div className="flex items-center gap-2">
                {contributor.avatarUrl && (
                  <img
                    src={contributor.avatarUrl}
                    alt={contributor.githubLogin}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    @{contributor.githubLogin}
                  </p>
                  <p className="text-xs text-gray-500">
                    {contributor.totalCommits} commits
                  </p>
                </div>
              </div>

              {/* Stored summary */}
              {state.summary && (
                <div className="rounded-md bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-800">
                  {state.summary}
                </div>
              )}

              {/* Stale notice */}
              {state.mode === "regenerate" && (
                <p className="text-xs text-amber-600">
                  ⚠ New commits detected – you can regenerate this contributor's summary.
                </p>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              {/* Action button */}
              <Button
                onClick={() => handleGenerate(contributor.id, contributor.githubLogin)}
                disabled={isLoading}
              >
                {isLoading ? "Generating…" : buttonLabel}
              </Button>
            </div>
          );
        })}
    </div>
  );
}

// ─── Evaluation Questions Tab ─────────────────────────────────────────────────

function QuestionsTab({
  repoId,
  chatId,
  isRepoLoaded,
}: {
  repoId?: string;
  chatId?: string;
  isRepoLoaded: boolean;
}) {
  const [focusArea, setFocusArea] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!isRepoLoaded || !repoId || !chatId) return;
    setLoading(true);
    setError(null);
    try {
      const answer = await sendChatMessageWithFeatures({
        chatId,
        repoId,
        userText: focusArea.trim(),
        selectedFeatures: ["generate_questions"],
      });
      setResult(answer);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate questions.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isRepoLoaded && (
        <p className="text-sm text-gray-400">Load a repository first.</p>
      )}
      {isRepoLoaded && (
        <>
          {result && (
            <div className="rounded-md bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
              {result}
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={focusArea}
              onChange={(e) => setFocusArea(e.target.value)}
              placeholder='Optional: focus area (e.g. "authentication flow")'
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button onClick={handleGenerate} disabled={loading}>
              {loading ? "Generating…" : "Generate Questions"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Repository Chat Tab ──────────────────────────────────────────────────────

function ChatTab({
  repoId,
  chatId,
  isRepoLoaded,
  repoLastCommitSha,
  initialMessages,
}: {
  repoId?: string;
  chatId?: string;
  isRepoLoaded: boolean;
  repoLastCommitSha?: string | null;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSendDisabled = !isRepoLoaded || sending || !input.trim();

  async function handleSend() {
    if (isSendDisabled || !repoId || !chatId) return;
    const text = input.trim();
    setSending(true);
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const answer = await sendChatMessageWithFeatures({
        chatId,
        repoId,
        userText: text,
        selectedFeatures: ["repo_chat"],
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: answer, commitSha: repoLastCommitSha },
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            {isRepoLoaded
              ? "Ask anything about this repository."
              : "Load a repository to start chatting."}
          </p>
        )}
        {messages.map((msg, idx) => {
          // Show staleness badge on old assistant messages whose sha is outdated
          const isStale =
            msg.role === "assistant" &&
            msg.commitSha &&
            repoLastCommitSha &&
            msg.commitSha !== repoLastCommitSha;

          return (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] space-y-1 rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {msg.content}
                {isStale && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠ Repository has new commits since this answer was generated.
                    Check the Summary tabs for the latest.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isSendDisabled && handleSend()}
          placeholder={isRepoLoaded ? "Ask a question…" : "Load a repository first…"}
          disabled={!isRepoLoaded || sending}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <Button onClick={handleSend} disabled={isSendDisabled}>
          <PaperAirplaneIcon className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
```

---

## Step 5 – Update `chat/page.tsx`

**File:** `app/dashboard/chat/page.tsx`

Replace the entire file. We now fetch three things in parallel: messages, repo summary state, and per-contributor summary states. We also pass the repo's `lastCommitSha` so the ChatTab can show staleness badges on old messages.

```tsx
import { auth } from "@/auth";
import RepoActionsTabs from "@/app/ui/dashboard/repo-actions-tabs";
import {
  fetchMessagesByChat,
  fetchRepoSummaryState,
  fetchContributorSummaryStates,
} from "@/app/lib/data";
import { prisma } from "@/app/lib/db";

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{
    repoId?: string;
    chatId?: string;
    github_url?: string;
    repo_name?: string;
  }>;
}) {
  const session = await auth();
  const userId = session!.user!.id as string;
  const params = await searchParams;

  const [initialMessages, repoSummaryState, contributorStates, repoRecord] =
    await Promise.all([
      params?.chatId
        ? fetchMessagesByChat(params.chatId)
        : Promise.resolve([]),
      params?.repoId
        ? fetchRepoSummaryState(params.repoId)
        : Promise.resolve(null),
      params?.repoId
        ? fetchContributorSummaryStates(params.repoId)
        : Promise.resolve([]),
      params?.repoId
        ? prisma.repository.findUnique({
            where: { id: params.repoId },
            select: { lastCommitSha: true },
          })
        : Promise.resolve(null),
    ]);

  return (
    <main className="flex h-full min-h-[calc(100vh-5rem)] w-full flex-col">
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        {params?.repo_name ?? "Repository"}
      </h1>
      <RepoActionsTabs
        repoId={params?.repoId}
        chatId={params?.chatId}
        userId={userId}
        repoLastCommitSha={repoRecord?.lastCommitSha ?? null}
        initialSummaryState={repoSummaryState}
        initialContributorStates={contributorStates}
        initialMessages={initialMessages.map((m) => ({
          role: m.role,
          content: m.content,
          features: m.features,
          commitSha: (m as { commitSha?: string | null }).commitSha ?? null,
        }))}
      />
    </main>
  );
}
```

> **Note on the `commitSha` cast:** Once you add `commitSha` to the `Message` model and run `prisma generate`, the Prisma type will include it automatically. Until then, the `(m as ...)` cast keeps TypeScript happy.

---

## Step 6 – Remove / keep old files

`app/ui/dashboard/chat-section.tsx` is no longer imported. You can **delete it** or leave it in place – it won't be rendered.

`app/ui/dashboard/feature-buttons.tsx` is also unused (it was already not referenced in the main flow). You can delete it too.

---

## Summary of all file changes

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `summary String?` + `summaryCommitSha String?` to `Repository`; add `summaryCommitSha String?` to `Contributor`; add `commitSha String?` to `Message` |
| Run migration | `npx prisma migrate dev --name add_summary_commit_sha && npx prisma generate` |
| `app/lib/data.ts` | Add `RepoSummaryState` + `fetchRepoSummaryState()`; add `ContributorSummaryState` + `ContributorWithSummaryState` + `fetchContributorSummaryStates()` |
| `app/lib/actions.ts` | (a) save `summary` + `summaryCommitSha` at end of `generateRepoSummary`; (b) save `summaryCommitSha` at end of `generateContributorSummary`; (c) store `commitSha` on the assistant message in `sendChatMessageWithFeatures`; (d) optionally add server-action wrappers |
| `app/ui/dashboard/repo-actions-tabs.tsx` | **Create new file** with full tab component (Step 4) |
| `app/dashboard/chat/page.tsx` | Replace file contents (Step 5) |
| `app/ui/dashboard/chat-section.tsx` | Delete (no longer imported) |
| `app/ui/dashboard/feature-buttons.tsx` | Delete (already unused) |

---

## How the button state logic works (full picture)

```
Opening a chat page (server side)
──────────────────────────────────
1. fetchRepoSummaryState(repoId)
     Repository.summary == null                           → generate
     summaryCommitSha != lastCommitSha                   → regenerate (show old, offer refresh)
     summaryCommitSha == lastCommitSha                   → view (show current summary)

2. fetchContributorSummaryStates(repoId)
   For each Contributor:
     Contributor.summary == null                          → generate
     Contributor.summaryCommitSha != Repo.lastCommitSha  → regenerate
     Contributor.summaryCommitSha == Repo.lastCommitSha  → view

Clicking Generate / Regenerate (client side)
────────────────────────────────────────────
generateRepoSummary(repoId)
  → calls RAG /summarize
  → writes Repository.summary = new summary
  → writes Repository.summaryCommitSha = Repository.lastCommitSha
  → UI state transitions to mode: "view"

generateContributorSummary(repoId, githubLogin)
  → calls RAG /contributor-summary
  → writes Contributor.summary = new summary
  → writes Contributor.summaryCommitSha = Repository.lastCommitSha
  → UI state for that contributor transitions to mode: "view"

When a new ingest happens (triggerRepoIngestion)
────────────────────────────────────────────────
  Repository.lastCommitSha is updated to the new sha.
  This makes summaryCommitSha != lastCommitSha for both Repo and all Contributors,
  so the next time any user opens the chat page they'll see "Regenerate Summary".

Message commitSha (for chat history)
──────────────────────────────────────
  Every assistant message stores commitSha = Repository.lastCommitSha at creation time.
  In the Chat tab, if message.commitSha != repoLastCommitSha, a staleness badge is shown:
  "⚠ Repository has new commits since this answer was generated."
  (The summary tabs already show the latest state independently.)
```
