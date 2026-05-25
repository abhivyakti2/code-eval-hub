"use client";

import { RepoAction, ChatMessage } from "@/app/lib/definitions";
import { useEffect, useRef, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/app/ui/button";
import { PaperAirplaneIcon, XMarkIcon } from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import "@/app/ui/markdown.css";
import {
  fetchCurrentGithubSha,
  sendChatMessageWithFeatures,
  updateChatViewedContribSummarySha,
} from "@/app/lib/actions";
import {
  generateAndStoreRepoSummary,
  generateAndStoreAllContribSummaries,
  updateChatViewedSha,
  updateContribViewedSha,
} from "@/app/lib/actions";

const REPO_ACTIONS: Array<{ id: RepoAction; label: string }> = [
  { id: "generate_questions", label: "Evaluation Questions" },
  { id: "repo_chat", label: "Ask more about Repository" },
];

export default function ChatSection({
  repoId,
  chatId,
  userId,
  githubUrl,
  repoName,
  initialMessages = [],
  repoOwner,
  repoLastCommitSha,
  repoLastSummarySha,
  repoStoredSummary,
  chatLastViewedSummarySha,
  initialLiveGithubSha,
  chatLastViewedContribSummarySha = null,
  chatLastChatSha,
  initialRepoIngested = false,
  initialContribIngested = false,
  contributors = [],
}: {
  repoId?: string;
  chatId?: string;
  userId: string;
  githubUrl?: string;
  repoName?: string;
  initialMessages?: ChatMessage[];
  repoOwner?: string;
  repoLastCommitSha?: string | null;
  repoLastSummarySha?: string | null;
  repoStoredSummary?: string | null;
  chatLastViewedSummarySha?: string | null;
  chatLastViewedContribSummarySha?: string | null;
  chatLastChatSha?: string | null;
  initialRepoIngested?: boolean;
  initialContribIngested?: boolean;
  initialLiveGithubSha?: string | null;
  contributors?: {
    id: string;
    githubLogin: string;
    summary?: string | null;
    lastSummarySha?: string | null;
  }[];
}) {
  type ViewMode = "chat" | "summary";
  type SummarySection = "repo" | "contributors";

  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [summarySection, setSummarySection] = useState<SummarySection>("repo");

  const [liveGithubSha, setLiveGithubSha] = useState<string | null>(initialLiveGithubSha ?? null);
  const [shaReady, setShaReady] = useState(!!initialLiveGithubSha);
  const [repoSummaryText, setRepoSummaryText] = useState<string | null>(
    repoStoredSummary ?? null,
  );

  const [repoLastSummaryShaState, setRepoLastSummarySha] = useState<
    string | null
  >(repoLastSummarySha ?? null);

  const [contribSummaries, setContribSummaries] = useState<
    Record<string, string>
  >(
    Object.fromEntries(
      contributors
        .filter((c) => c.summary)
        .map((c) => [c.githubLogin, c.summary!]),
    ),
  );

  const [summaryLoading, setSummaryLoading] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Steps now hold a single current step string (or null), not an array.
  // We show one step at a time, replacing the previous one.
  const INGESTION_STEPS = [
    "Cloning repository structure...",
    "Parsing source files...",
    "Extracting dependency graph...",
    "Chunking code into semantic units...",
    "Generating embeddings...",
    "Indexing vector store...",
    "Retrieving architectural patterns...",
    "Evaluating code quality heuristics...",
    "Cross-referencing contributor diffs...",
    "Building context window...",
    "Running RAG pipeline...",
    "Synthesizing response...",
  ];

  const CONTRIB_INGESTION_STEPS = [
    "Fetching contributor commit history...",
    "Parsing commit diffs...",
    "Chunking diff context...",
    "Generating embeddings...",
    "Indexing contributor vector store...",
    "Retrieving contribution patterns...",
    "Analyzing code ownership...",
    "Synthesizing contributor profile...",
  ];

  // Single current step (one at a time, replacing previous)
  const [currentReasoningStep, setCurrentReasoningStep] = useState<
    string | null
  >(null);
  const [currentContribReasoningStep, setCurrentContribReasoningStep] =
    useState<string | null>(null);

  const activeSelectedActionsRef = useRef<RepoAction[]>([]);
  const [repoIngested, setRepoIngested] = useState(initialRepoIngested);
  const [contribIngested, setContribIngested] = useState(
    initialContribIngested,
  );
  const reasoningIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const contribReasoningIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [selectedActions, setSelectedActions] = useState<RepoAction[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<{
    text: string;
    actions: RepoAction[];
  } | null>(null);
  const activeChatIdRef = useRef<string | undefined>(chatId);
  const sendingLockRef = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastChangeRef = useRef<"user" | "assistant" | null>(null);

  const isRepoLoaded = !!repoId && !!chatId;

  const repoSummaryIsStale =
    liveGithubSha !== null && liveGithubSha !== repoLastSummaryShaState;

  const repoUpdatedSinceViewed =
    repoLastSummaryShaState !== null &&
    chatLastViewedSummarySha !== null &&
    chatLastViewedSummarySha !== repoLastSummaryShaState;

  const latestContribSummarySha =
    contributors.find((c) => c.lastSummarySha)?.lastSummarySha ?? null;

  const contribSummariesUpdatedSinceViewed =
    latestContribSummarySha !== null &&
    chatLastViewedContribSummarySha !== null &&
    chatLastViewedContribSummarySha !== latestContribSummarySha;

  const hasRepoSummary = !!repoSummaryText?.trim();
  const repoSummaryOutdated =
    hasRepoSummary &&
    !!repoLastSummaryShaState &&
    !!repoLastCommitSha &&
    repoLastSummaryShaState !== repoLastCommitSha;
  const canViewRepoSummary = hasRepoSummary && !repoSummaryOutdated;

  const hasContribSummary = Object.keys(contribSummaries).length > 0;
  const contribSummaryOutdated =
    hasContribSummary &&
    !!latestContribSummarySha &&
    !!repoLastCommitSha &&
    latestContribSummarySha !== repoLastCommitSha;
  const canViewContribSummary = hasContribSummary && !contribSummaryOutdated;

  const chatIsStale =
    liveGithubSha !== null &&
    chatLastChatSha !== null &&
    chatLastChatSha !== liveGithubSha;

  useLayoutEffect(() => {

  const container = messagesContainerRef.current;
  if (!container) return;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}, [chatId, viewMode, messages.length]);
  useEffect(() => {
    activeChatIdRef.current = chatId;
    setMessages(initialMessages);
    setRepoIngested(initialRepoIngested);
    setContribIngested(initialContribIngested);
  setShaReady(!!initialLiveGithubSha);
setLiveGithubSha(initialLiveGithubSha ?? null);
  }, [chatId, initialMessages, initialRepoIngested, initialContribIngested]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const change = lastChangeRef.current;
    lastChangeRef.current = null;

    if (change === "user") {
      requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      });
      return;
    }

    if (change === "assistant") {
      requestAnimationFrame(() => {
        const userEls = container.querySelectorAll('[data-role="user"]');
        const assistantEls = container.querySelectorAll(
          '[data-role="assistant"]',
        );
        const lastUserEl = userEls.length
          ? (userEls[userEls.length - 1] as HTMLElement)
          : null;
        const lastAssistantEl = assistantEls.length
          ? (assistantEls[assistantEls.length - 1] as HTMLElement)
          : null;
        if (!lastAssistantEl) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
          return;
        }

        const assistantHeight = lastAssistantEl.getBoundingClientRect().height;
        const containerHeight = container.clientHeight;

        if (assistantHeight > containerHeight) {
          if (lastUserEl) {
            container.scrollTop = Math.max(0, lastUserEl.offsetTop - 8);
          } else {
            container.scrollTop = Math.max(0, lastAssistantEl.offsetTop - 8);
          }
        } else {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        }
      });
    }
  }, [messages.length]);

  useEffect(() => {
    setRepoSummaryText(repoStoredSummary ?? null);
    setRepoLastSummarySha(repoLastSummarySha ?? null);
    setContribSummaries(
      Object.fromEntries(
        contributors
          .filter((c) => c.summary)
          .map((c) => [c.githubLogin, c.summary!]),
      ),
    );
    setSummaryLoading(null);
    setSendError(null);
    setRetryPayload(null);
  }, [chatId, repoId, repoStoredSummary, repoLastSummarySha, contributors]);

  useEffect(() => {
    if (viewMode === "summary") {
      setSummarySection((current) => current ?? "repo");
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "summary" || !repoOwner || !repoName) return;
    void fetchCurrentGithubSha(repoOwner, repoName)
      .then(setLiveGithubSha)
      .catch(() => {});
  }, [viewMode, repoOwner, repoName]);

  useEffect(() => {
    if (!repoOwner || !repoName) return;
    void fetchCurrentGithubSha(repoOwner, repoName)
      .then((sha) => {
        setLiveGithubSha(sha);
        setShaReady(true);
      })
      .catch(() => setShaReady(true));
  }, [repoOwner, repoName]);

  useEffect(() => {
    if (viewMode !== "summary" || !chatId) return;
    if (repoLastSummaryShaState)
      void updateChatViewedSha(chatId, repoLastSummaryShaState).catch(() => {});
    if (latestContribSummarySha)
      void updateChatViewedContribSummarySha(
        chatId,
        latestContribSummarySha,
      ).catch(() => {});
  }, [viewMode, chatId, repoLastSummaryShaState, latestContribSummarySha]);

  // Repo ingestion step ticker — one step at a time, with initial delay
  useEffect(() => {
    const needsRepoIngestion =
      (sending &&
        !repoIngested &&
        (activeSelectedActionsRef.current.length === 0 ||
          activeSelectedActionsRef.current.includes("repo_chat"))) ||
      (summaryLoading === "repo" && !repoIngested);

    if (needsRepoIngestion) {
      setCurrentReasoningStep(null);
      let i = 0;

      setCurrentReasoningStep(INGESTION_STEPS[0]);
      i = 1;
      reasoningIntervalRef.current = setInterval(() => {
        if (i < INGESTION_STEPS.length) {
          setCurrentReasoningStep(INGESTION_STEPS[i]);
          i++;
        }
      }, 3000);
    } else {
      if (reasoningIntervalRef.current) {
        clearInterval(reasoningIntervalRef.current);
        reasoningIntervalRef.current = null;
      }
      if (!sending && !summaryLoading) setCurrentReasoningStep(null);
    }

    return () => {
      if (reasoningIntervalRef.current)
        clearInterval(reasoningIntervalRef.current);
    };
  }, [sending, repoIngested, summaryLoading]);

  // Contrib ingestion step ticker — one step at a time, with initial delay
  useEffect(() => {
    const isContribLoading =
      summaryLoading === "contributors" ||
      (sending &&
        activeSelectedActionsRef.current.includes("generate_questions"));

    if (isContribLoading && !contribIngested) {
      setCurrentContribReasoningStep(null);
      let i = 0;

      setCurrentContribReasoningStep(CONTRIB_INGESTION_STEPS[0]);
      i = 1;
      contribReasoningIntervalRef.current = setInterval(() => {
        if (i < CONTRIB_INGESTION_STEPS.length) {
          setCurrentContribReasoningStep(CONTRIB_INGESTION_STEPS[i]);
          i++;
        }
      }, 3000);
    } else {
      if (contribReasoningIntervalRef.current) {
        clearInterval(contribReasoningIntervalRef.current);
        contribReasoningIntervalRef.current = null;
      }
      if (!isContribLoading) setCurrentContribReasoningStep(null);
    }

    return () => {
      if (contribReasoningIntervalRef.current)
        clearInterval(contribReasoningIntervalRef.current);
    };
  }, [summaryLoading, sending, contribIngested]);

  function handleSelectAction(id: RepoAction) {
    setSelectedActions((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function getActionLabel(id: RepoAction) {
    return REPO_ACTIONS.find((action) => action.id === id)?.label ?? id;
  }

  function buildUserMessage(text: string, actions: RepoAction[]) {
    return text;
  }

  async function handleGenerateRepoSummary() {
    if (!repoId || !liveGithubSha || !chatId) return;
    setSummaryLoading("repo");
    setSendError(null);
    try {
      const text = await generateAndStoreRepoSummary(repoId, liveGithubSha);
      setRepoSummaryText(text);
      setRepoLastSummarySha(liveGithubSha);
      if (reasoningIntervalRef.current) {
        clearInterval(reasoningIntervalRef.current);
        reasoningIntervalRef.current = null;
      }
      setCurrentReasoningStep(null);
      setRepoIngested(true);
      await updateChatViewedSha(chatId, liveGithubSha);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Summary generation failed.",
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
      const all = await generateAndStoreAllContribSummaries(
        repoId,
        liveGithubSha,
      );
      if (contribReasoningIntervalRef.current) {
        clearInterval(contribReasoningIntervalRef.current);
        contribReasoningIntervalRef.current = null;
      }
      setCurrentContribReasoningStep(null);
      setContribIngested(true);
      setContribSummaries((prev) => ({ ...prev, ...all }));
      await updateChatViewedContribSummarySha(chatId, liveGithubSha);
    } catch (err) {
      setSendError(
        err instanceof Error
          ? err.message
          : "Contributor summary generation failed.",
      );
    } finally {
      setSummaryLoading(null);
    }
  }

  async function handleRepoSummaryAction() {
    setSummarySection("repo");
    if (canViewRepoSummary) return;
    await handleGenerateRepoSummary();
  }

  async function handleContributorSummaryAction() {
    setSummarySection("contributors");
    if (canViewContribSummary) return;
    await handleGenerateAllContribSummaries();
  }

  const router = useRouter();

  async function handleSend(

    overrideText?: string,
    overrideActions?: RepoAction[],
  ) {

    const userText = (overrideText ?? input).trim().toLowerCase();
    const selected = (overrideActions ?? selectedActions).length
      ? (overrideActions ?? selectedActions)
      : (["repo_chat"] as RepoAction[]);

    if (!userText && selected.length === 1 && selected[0] === "repo_chat")
      return;
    if (!isRepoLoaded || sendingLockRef.current) return;

    const requestChatId = chatId!;
    sendingLockRef.current = true;
    activeSelectedActionsRef.current = selected;

    setSending(true);
    setSendError(null);
    setRetryPayload(null);
    setInput("");

    const userMessage = buildUserMessage(userText, selected);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage, features: selected },
    ]);
    lastChangeRef.current = "user";
    setSelectedActions([]);

    try {
      const result = await sendChatMessageWithFeatures({
        chatId: requestChatId,
        repoId: repoId!,
        userText,
        selectedFeatures: selected,
      });
      if (reasoningIntervalRef.current) {
        clearInterval(reasoningIntervalRef.current);
        reasoningIntervalRef.current = null;
      }

      setCurrentReasoningStep(null);
      if (result.repoIngested) setRepoIngested(true);
      if (result.contribIngested) setContribIngested(true);
      if (activeChatIdRef.current !== requestChatId) return;
      lastChangeRef.current = "assistant";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.answer },
      ]);
      router.refresh();
    } catch (error) {
      if (activeChatIdRef.current !== requestChatId) return;
      setMessages((prev) => prev.slice(0, -1));
      setRetryPayload({ text: userText, actions: selected });
      setSendError(
        error instanceof Error
          ? error.message
          : "Request failed. Please try again.",
      );
    } finally {
      sendingLockRef.current = false;
      setSending(false);
    }
  }

  const isDisabled = !isRepoLoaded;
  const effectiveActions =
    selectedActions.length > 0 ? selectedActions : ["repo_chat"];
  const isRepoChatOnly =
    effectiveActions.length === 1 && effectiveActions[0] === "repo_chat";
  const isSendDisabled =
    isDisabled || sending || (!input.trim() && isRepoChatOnly);

  // Reusable inline step display for inside the "Generating..." bubble
  function InlineStep({ label, step }: { label: string; step: string | null }) {
    if (!step) return null;
    return (
      <div className="mt-2 pt-2 border-t border-slate-700/50">
        <p className="text-xs font-medium text-cyan-400 mb-1.5 uppercase tracking-wide">
          {label}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-cyan-400 animate-spin inline-block">⟳</span>
          <span className="text-slate-200">{step}</span>
        </div>
      </div>
    );
  }

  // Summary panel ingestion loading block (standalone, not inside "Generating...")
  function SummaryIngestionBlock({
    label,
    step,
  }: {
    label: string;
    step: string | null;
  }) {
    if (!step) return null;
    return (
      <div className="rounded-lg px-4 py-3 bg-[rgb(33,44,62)] text-slate-100 min-w-[280px]">
        <p className="text-xs font-medium text-cyan-400 mb-2 uppercase tracking-wide">
          {label}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-cyan-400 animate-spin inline-block">⟳</span>
          <span className="text-slate-200">{step}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold md:text-2xl">
          {viewMode === "summary"
            ? `${repoName ?? "Repository"} Summary`
            : `Chat with ${repoName ?? "Repository"}`}
        </h1>
        {isRepoLoaded &&
          (viewMode === "chat" ? (
            <button
              onClick={() => setViewMode("summary")}
              className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
            >
              {repoSummaryIsStale || !repoLastSummarySha
                ? "Generate Summary"
                : "View Summary"}
            </button>
          ) : (
            <button
              onClick={() => setViewMode("chat")}
              className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
            >
              Chat with Repo
            </button>
          ))}
      </div>
      <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow-sm">
        {viewMode === "summary" ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleRepoSummaryAction}
                disabled={
                  summaryLoading === "repo" ||
                  (!canViewRepoSummary && !liveGithubSha)
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  summarySection === "repo"
                    ? "border-cyan-500/40 bg-[rgb(33,44,62)] text-slate-200"
                    : "border-slate-800 bg-[rgb(33,44,62)] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300"
                }`}
              >
                {summaryLoading === "repo"
                  ? "Generating Repository Summary..."
                  : canViewRepoSummary
                    ? "View Repo Summary"
                    : repoSummaryText
                      ? "Regenerate Repo Summary"
                      : "Generate Repo Summary"}
              </button>
              <button
                onClick={handleContributorSummaryAction}
                disabled={
                  summaryLoading === "contributors" ||
                  contributors.length === 0 ||
                  (!canViewContribSummary && !liveGithubSha)
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  summarySection === "contributors"
                    ? "border-cyan-500/40 bg-[rgb(33,44,62)] text-slate-200"
                    : "border-slate-800 bg-[rgb(33,44,62)] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300"
                }`}
              >
                {summaryLoading === "contributors"
                  ? "Generating Contributor Summaries..."
                  : canViewContribSummary
                    ? "View Contributor Summaries"
                    : hasContribSummary
                      ? "Regenerate Contributor Summaries"
                      : "Generate Contributor Summaries"}
              </button>
            </div>

            {/* Summary panel ingestion steps — standalone blocks */}
            {summaryLoading === "repo" && !repoIngested && (
              <SummaryIngestionBlock
                label="Ingesting Repository Data"
                step={currentReasoningStep}
              />
            )}
            {summaryLoading === "contributors" && !contribIngested && (
              <SummaryIngestionBlock
                label="Ingesting Contributor Data"
                step={currentContribReasoningStep}
              />
            )}

            {summarySection === "repo" ? (
              <div className="space-y-2">
                {repoUpdatedSinceViewed && (
                  <p className="rounded px-3 py-1 text-xs text-amber-600 border border-amber-200 bg-amber-50">
                    ⚠ The repository has been updated since you last viewed this
                    summary.
                  </p>
                )}
                {repoSummaryText && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-4 py-2 bg-slate-800/60 text-slate-100">
                      <p className="mb-1 text-xs font-medium text-gray-500">
                        Repository Summary
                      </p>
                      <div className="markdown-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                        >
                          {repoSummaryText}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {contribSummariesUpdatedSinceViewed && (
                  <p className="rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-600">
                    ⚠ Contributor summaries were updated since your last view.
                  </p>
                )}

                {contributors.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No contributors found.
                  </p>
                ) : (
                  contributors.map((c) => {
                    const contribText = contribSummaries[c.githubLogin];
                    if (!contribText) return null;

                    return (
                      <div key={c.githubLogin} className="flex justify-start">
                        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-slate-800/60 text-slate-100">
                          <p className="mb-1 text-xs font-medium text-gray-500">
                            @{c.githubLogin}
                          </p>
                          <div className="markdown-content">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeHighlight]}
                            >
                              {contribText}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {shaReady && chatIsStale && (
              <div className="px-4 pt-3">
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1">
                  ⚠ The repository has been updated since your last message.
                  Replies will use the latest ingested version.
                </p>
              </div>
            )}

            {sendError && retryPayload && (
              <div className="mx-4 mt-3 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 flex items-center justify-between gap-3">
                <p className="text-xs text-rose-200/80">{sendError}</p>
                <button
                  onClick={() =>
                    handleSend(retryPayload.text, retryPayload.actions)
                  }
                  disabled={sending}
                  className="shrink-0 flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.873.696A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Retry
                </button>
              </div>
            )}

            <div
              ref={messagesContainerRef}
              className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4"
            >
              {messages.length === 0 && (
                <p className="text-center text-sm text-gray-400">
                  {isRepoLoaded
                    ? "No messages yet. Start a conversation!"
                    : "Your chat will appear here once you load a repository."}
                </p>
              )}
              {messages.map((msg, idx) => {
                const labels =
                  msg.role === "user"
                    ? (msg.features ?? []).map(getActionLabel)
                    : [];
                const hasContent = !!msg.content?.trim();

                return (
                  <div
                    key={idx}
                    data-role={msg.role}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        msg.role === "user"
                          ? "bg-blue-500 text-white"
                          : "bg-[rgb(33,44,62)] text-slate-100"
                      }`}
                    >
                      {labels.length > 0 && msg.role === "user" && (
                        <p className="text-sm opacity-80">
                          {labels.join(", ")}
                        </p>
                      )}

                      {hasContent && (
                        <div className="markdown-content">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeHighlight]}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Single unified loading bubble — steps shown inside it, not separately */}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-4 py-3 bg-[rgb(33,44,62)] text-slate-100 min-w-[280px]">
                    <p className="text-sm animate-pulse-fade">Generating...</p>

                    {/* Contrib ingestion steps — inside same bubble */}
                    {activeSelectedActionsRef.current.includes(
                      "generate_questions",
                    ) &&
                      !contribIngested && (
                        <InlineStep
                          label="Ingesting Contributor Data"
                          step={currentContribReasoningStep}
                        />
                      )}

                    {/* Repo ingestion steps — inside same bubble */}
                    {!repoIngested && (
                      <InlineStep
                        label="Ingesting Repository Data"
                        step={currentReasoningStep}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-800 p-4 pt-3 pb-1">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Repository Actions
              </p>
              <div className="flex flex-wrap gap-2">
                {REPO_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleSelectAction(action.id)}
                    disabled={isDisabled}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
            ${
              selectedActions.includes(action.id)
                ? "border-blue-500 bg-[rgb(33,44,62)] text-blue-700"
                : "border-slate-800 bg-[rgb(33,44,62)] text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300"
            }
            disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              <div className="px-4 pb-4 pt-2">
                {selectedActions.length > 0 && (
                  <div className="mb-2 flex items-center gap-1">
                    {selectedActions.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white"
                      >
                        {getActionLabel(id)}
                        <button
                          onClick={() => handleSelectAction(id)}
                          className="m1-1 rounded-full hover:bg-blue-600 p-0.5"
                          aria-label="Remove selected action"
                        >
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !isSendDisabled && handleSend()
                    }
                    placeholder={
                      isDisabled
                        ? "Load a repository to start chatting..."
                        : selectedActions.includes("generate_questions")
                          ? 'Optional: focus area (e.g. "authentication flow")'
                          : "Ask a question..."
                    }
                    disabled={isDisabled}
                    className="flex-1 rounded-md border border-slate-800 px-3 py-2 bg-[rgb(33,44,62)] text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:bg-slate-900/40 disabled:text-slate-400 text-slate-100"
                  />
                  <Button
                    onClick={() => handleSend()}
                    disabled={isSendDisabled}
                  >
                    <PaperAirplaneIcon className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
