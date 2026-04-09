import { auth } from '@/auth';
import { Suspense } from 'react';
import RepoEvaluatorSection from '@/app/ui/dashboard/repo-evaluator';

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id as string;

  return (
    <main className="w-full">
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        Welcome back, {session?.user?.email?.split('@')[0] ?? 'User'} 👋
      </h1>
      <p className="mb-6 text-gray-600">
        Enter a GitHub repository URL below to start analysing and chatting with the codebase.
      </p>
      <Suspense fallback={<div>Loading...</div>}> 
      {/* create a skeleton loader for this section */}
        <RepoEvaluatorSection userId={userId} />
      </Suspense>
    </main>
  );
}