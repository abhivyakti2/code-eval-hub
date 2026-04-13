import { auth } from '@/auth';
import { Suspense } from 'react';
import RepoEvaluatorSection from '@/app/ui/dashboard/repo-evaluator';

//searchParams prop is passed from the layout file, which is a promise that 
// resolves to the actual search params object. This allows us to fetch any 
// necessary data based on the search params before rendering the page, ensuring 
// that we have all the required information to display the dashboard correctly. 
// By awaiting the searchParams promise, we can access the repoId and chatId 
// directly in our component and determine if there's an active repository to 
// display or if we should show the welcome message and input form for adding 
// a new repository.

export default async function DashboardPage({
  searchParams,
}:{ searchParams?: Promise<{repoId?: string; chatId?: string}>;
}) {
  const session = await auth();
  const userId = session!.user!.id as string;
  
  return (
    <main className="flex h-full min-h-0 w-full flex-col">
      
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        Welcome back, {session?.user?.email?.split('@')[0] ?? 'User'} 👋
      </h1>
      <p className="mb-6 text-gray-600">
        Enter a GitHub repository URL below to start analysing and chatting with the codebase.
      </p>
      
    
      <Suspense fallback={<div>Loading...</div>}> 
      {/* TODO : create a skeleton loader for this section */}
        <RepoEvaluatorSection userId={userId} />
      </Suspense>
    </main>
  );
}

// i think having separate layouts for enter repo, vs chat with repo will be better