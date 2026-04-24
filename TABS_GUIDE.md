# Tab-Based Repository Actions – Implementation Guide

This guide walks you through converting the single-chat interface into a **tab-based** layout where each repository action (Summary, Contributors Summary, Questions, Chat) lives in its own tab. It also adds smart summary button state (Generate / Regenerate / View Summary) driven by the database.

---

## Overview of Changes

| Area | What changes |
|---|---|
| `prisma/schema.prisma` | Add `summary` + `summaryCommitSha` fields to `Repository` |
| `app/lib/data.ts` | Add `fetchRepoSummaryState()` helper |
| `app/lib/actions.ts` | Persist summary to DB inside `generateRepoSummary()`; add `getRepoSummaryState()` server action |
| `app/ui/dashboard/chat-section.tsx` | Replace with tab-based `RepoActionsTabs` component |
| `app/dashboard/chat/page.tsx` | Pass `summaryState` as a prop to the new component |

No other files need to change.

---

## Step 1 – DB Schema: add summary fields to Repository

**File:** `prisma/schema.prisma`

Find the `Repository` model (around line 26) and add two new optional fields after `lastCommitSha`:

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
  summary            String?             // ← ADD THIS
  summaryCommitSha   String?             // ← ADD THIS (sha when summary was generated)
  repoFaissUri       String?
  createdAt          DateTime            @default(now())
  contributors       Contributor[]
  chats              Chat[]
  generatedQuestions GeneratedQuestion[]
}
```

Then run the migration:

```bash
npx prisma migrate dev --name add_repo_summary
npx prisma generate
```

---

## Step 2 – data.ts: add `fetchRepoSummaryState()`

**File:** `app/lib/data.ts`

Add this function at the bottom of the file (after `fetchLatestQuestions`):

```ts
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

    if (!repo.summary) {
      return { mode: 'generate', summary: null };
    }

    if (repo.lastCommitSha && repo.summaryCommitSha !== repo.lastCommitSha) {
      return { mode: 'regenerate', summary: repo.summary };
    }

    return { mode: 'view', summary: repo.summary };
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch summary state.');
  }
}
```

---

## Step 3 – actions.ts: persist summary + add server action

**File:** `app/lib/actions.ts`

### 3a. Update `generateRepoSummary` to save the result to the DB

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

  // Persist to DB so we can show View/Regenerate buttons next time
  await prisma.repository.update({
    where: { id: repoId },
    data: {
      summary,
      summaryCommitSha: (
        await prisma.repository.findUnique({
          where: { id: repoId },
          select: { lastCommitSha: true },
        })
      )?.lastCommitSha ?? null,
    },
  });

  revalidateTag(`repo-${repoId}`, 'max');
  return summary;
}
```

### 3b. Add a new server action `getRepoSummaryState`

Add this anywhere after the imports (e.g. right before `generateRepoSummary`):

```ts
import { fetchRepoSummaryState, RepoSummaryState } from '@/app/lib/data';

export async function getRepoSummaryState(
  repoId: string
): Promise<RepoSummaryState> {
  return fetchRepoSummaryState(repoId);
}
```

> **Note:** because `fetchRepoSummaryState` is a plain DB call, you can also call it directly from server components; the server action wrapper lets you call it from client components too.

---

## Step 4 – New tab-based client component

**File:** `app/ui/dashboard/repo-actions-tabs.tsx` *(create this new file)*

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/app/ui/button";
import { PaperAirplaneIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { MessageFeature } from "@prisma/client";
import {
  sendChatMessageWithFeatures,
  generateRepoSummary,
} from "@/app/lib/actions";
import type { RepoSummaryState } from "@/app/lib/data";

// ─── types ────────────────────────────────────────────────────────────────────

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  features?: MessageFeature[];
};

type TabId = "summary" | "contributors" | "questions" | "chat";

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Repository Summary" },
  { id: "contributors", label: "Contributors Summary" },
  { id: "questions", label: "Evaluation Questions" },
  { id: "chat", label: "Repository Chat" },
];

// ─── component ────────────────────────────────────────────────────────────────

export default function RepoActionsTabs({
  repoId,
  chatId,
  userId,
  initialMessages = [],
  initialSummaryState,
}: {
  repoId?: string;
  chatId?: string;
  userId: string;
  initialMessages?: ChatMessage[];
  initialSummaryState: RepoSummaryState | null;
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
            chatId={chatId}
            isRepoLoaded={isRepoLoaded}
            initialState={initialSummaryState}
          />
        )}
        {activeTab === "contributors" && (
          <ContributorsSummaryTab
            repoId={repoId}
            chatId={chatId}
            isRepoLoaded={isRepoLoaded}
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
            initialMessages={initialMessages.filter(
              (m) => !m.features || m.features.includes("repo_chat")
            )}
          />
        )}
      </div>
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({
  repoId,
  chatId,
  isRepoLoaded,
  initialState,
}: {
  repoId?: string;
  chatId?: string;
  isRepoLoaded: boolean;
  initialState: RepoSummaryState | null;
}) {
  const [summaryState, setSummaryState] = useState<RepoSummaryState | null>(
    initialState
  );
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
        <p className="text-sm text-gray-400">
          Load a repository to generate a summary.
        </p>
      )}

      {isRepoLoaded && (
        <>
          {/* Show summary text if it exists */}
          {summaryState && summaryState.summary && (
            <div className="rounded-md bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
              {summaryState.summary}
            </div>
          )}

          {/* Regenerate notice */}
          {summaryState?.mode === "regenerate" && (
            <p className="text-xs text-amber-600">
              New commits detected – you can regenerate the summary.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button onClick={handleGenerate} disabled={loading || !isRepoLoaded}>
            {loading ? "Generating…" : buttonLabel}
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Contributors Summary Tab ─────────────────────────────────────────────────

function ContributorsSummaryTab({
  repoId,
  chatId,
  isRepoLoaded,
}: {
  repoId?: string;
  chatId?: string;
  isRepoLoaded: boolean;
}) {
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
        userText: "",
        selectedFeatures: ["contributors_summary"],
      });
      setResult(answer);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to generate contributors summary."
      );
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
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? "Generating…" : "Generate Contributors Summary"}
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Questions Tab ────────────────────────────────────────────────────────────

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
      setError(
        e instanceof Error ? e.message : "Failed to generate questions."
      );
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

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({
  repoId,
  chatId,
  isRepoLoaded,
  initialMessages,
}: {
  repoId?: string;
  chatId?: string;
  isRepoLoaded: boolean;
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
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Message history */}
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            {isRepoLoaded
              ? "Ask anything about this repository."
              : "Load a repository to start chatting."}
          </p>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Input */}
      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isSendDisabled && handleSend()}
          placeholder={
            isRepoLoaded ? "Ask a question…" : "Load a repository first…"
          }
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

Replace the entire file with:

```tsx
import { auth } from "@/auth";
import RepoActionsTabs from "@/app/ui/dashboard/repo-actions-tabs";
import { fetchMessagesByChat, fetchRepoSummaryState } from "@/app/lib/data";

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

  const [initialMessages, summaryState] = await Promise.all([
    params?.chatId ? fetchMessagesByChat(params.chatId) : Promise.resolve([]),
    params?.repoId
      ? fetchRepoSummaryState(params.repoId)
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
        initialSummaryState={summaryState}
        initialMessages={initialMessages.map((m) => ({
          role: m.role,
          content: m.content,
          features: m.features,
        }))}
      />
    </main>
  );
}
```

---

## Step 6 – Remove / keep `chat-section.tsx`

`app/ui/dashboard/chat-section.tsx` is no longer imported. You can **delete it** or leave it in place – it won't be rendered.

`app/ui/dashboard/feature-buttons.tsx` is also unused (it was already not referenced in the main flow). You can delete it too.

---

## Summary of what each file needs

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `summary String?` and `summaryCommitSha String?` to `Repository` |
| Run migration | `npx prisma migrate dev --name add_repo_summary && npx prisma generate` |
| `app/lib/data.ts` | Add `RepoSummaryState` type + `fetchRepoSummaryState()` at the bottom |
| `app/lib/actions.ts` | (a) save summary to DB at end of `generateRepoSummary`; (b) add `getRepoSummaryState` server action (optional wrapper) |
| `app/ui/dashboard/repo-actions-tabs.tsx` | **Create new file** with full tab component (Step 4) |
| `app/dashboard/chat/page.tsx` | Replace file contents (Step 5) |
| `app/ui/dashboard/chat-section.tsx` | Delete (no longer imported) |
| `app/ui/dashboard/feature-buttons.tsx` | Delete (already unused) |

---

## How the summary button logic works

```
Repository.summary == null
  → mode: "generate"   → show "Generate Summary" button
  
Repository.summary != null AND summaryCommitSha != lastCommitSha
  → mode: "regenerate" → show existing summary + "Regenerate Summary" button + amber notice

Repository.summary != null AND summaryCommitSha == lastCommitSha
  → mode: "view"       → show existing summary only + optional "Refresh" button
```

`summaryCommitSha` is written to DB inside `generateRepoSummary` every time a new summary is saved. `lastCommitSha` is updated whenever `triggerRepoIngestion` runs (already in `actions.ts` line ~407).
