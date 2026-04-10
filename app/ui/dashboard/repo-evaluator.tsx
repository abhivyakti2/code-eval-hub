'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';

import { addRepository, AddRepoState } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';
import ChatSection from '@/app/ui/dashboard/chat-section';

export default function RepoEvaluatorSection({userId}:{userId : string}){
  const initialState: AddRepoState ={};
  const [state, dispatch] = useActionState(addRepository, initialState);

  const searchParams = useSearchParams();

  const repoId = state.repoId ?? searchParams.get('repoId') ?? undefined;
  const chatId = state.chatId ?? searchParams.get('chatId') ?? undefined;
  const githubUrl = searchParams.get('github_url') ?? '';
  //TODO : check if add repo only adds new repo in repo table 
  // or adds repo to users repos?
  return (
    <div className="flex flex-col gap-6">
      <div className='rounded-lg border border-gray-200 bg-white p-6 shadow-sm'>
        {/* following should disappear once user starts chatting with the repo, 
        and the top welcome part too should go away. */}
        <h2 className="mb-4 text-lg font-semibold">Repository URL</h2>
        <form action={dispatch} className="flex gap-2">
          <input
            type="url"
            name="github_url"
            placeholder="https://github.com/owner/repo"
            required
            defaultValue={githubUrl}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button type="submit">Load Repo</Button>
        </form>
        {/* TODO : use the aria-describedby method to display error*/}
        {state.error && (
          <p className="mt-2 text-sm text-red-500">{state.error}</p>
        )}
      </div>
      <ChatSection
        repoId={repoId}
        chatId={chatId}
        userId={userId}
        githubUrl={githubUrl} 
      />
    </div>
  );
}