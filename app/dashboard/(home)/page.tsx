import { auth } from "@/auth";
import { Suspense } from "react";
import RepoEvaluatorSection from "@/app/ui/dashboard/repo-evaluator";
import { RepoInputSkeleton } from "@/app/ui/skeletons";
import DemoBanner from "@/app/ui/dashboard/demo-banner";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ repoId?: string; chatId?: string }>;
}) {
  const session = await auth();
  const name = session?.user?.email?.split("@")[0] ?? "User";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
          Welcome back, <span className="text-cyan-400">{name}</span>
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          Enter a GitHub repository URL below to start analysing and chatting
          with the codebase.
        </p>
      </header>
      <Suspense fallback={<RepoInputSkeleton />}>
        <RepoEvaluatorSection />
      </Suspense>
      {/* <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100/90">
        <p className="font-medium text-amber-300">First-time repos take a few minutes.</p>
        <p className="mt-1 text-amber-100/70">
          Your first chat message or summary for a new repository triggers code ingestion, so expect
          a short wait before the response appears. The same applies to contributor summaries and
          evaluation questions on a repo being analysed for the first time.
        </p>
      </div> */}
      <div className="mt-auto">
        <DemoBanner />
      </div>{" "}
    </div>
  );
}
