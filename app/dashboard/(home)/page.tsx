import { auth } from '@/auth';
import { Suspense } from 'react';
import RepoEvaluatorSection from '@/app/ui/dashboard/repo-evaluator';
import { RepoInputSkeleton } from '@/app/ui/skeletons';
import DemoBanner from '@/app/ui/dashboard/demo-banner';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ repoId?: string; chatId?: string }>;
}) {
  const session = await auth();

  return (
    <main className="flex h-full min-h-0 w-full flex-col text-slate-100">
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        Welcome back, {session?.user?.email?.split('@')[0] ?? 'User'}
      </h1>
      <p className="mb-2 max-w-2xl text-slate-300">
        Enter a GitHub repository URL below to start analysing and chatting with the codebase.
      </p>

      <div className="mb-6 space-y-1 rounded-md border border-slate-700 bg-slate-800/50 px-4 py-3 text-xs text-slate-400">
        <p>
          <span className="font-medium text-slate-300">
            First-time repos take a few minutes.
          </span>{' '}
          Your first chat message or summary for a new repository triggers code ingestion, so expect a short wait before the response appears. The same applies to contributor summaries and evaluation questions on a repo being analysed for the first time.
        </p>
      </div>

      <Suspense fallback={<RepoInputSkeleton />}>
        <RepoEvaluatorSection />
      </Suspense>

      <div className="mt-auto pt-8">
        <DemoBanner />
      </div>
    </main>
  );
}
