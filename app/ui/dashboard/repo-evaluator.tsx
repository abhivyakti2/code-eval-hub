'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';

import { addRepository, AddRepoState, getOrCreateChat } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';
import ChatSection from '@/app/ui/dashboard/chat-section';
import FeatureButtons from '@/app/ui/dashboard/feature-buttons';

export default function RepoEvaluatorSection({ userId }: { userId: string }) {
  const initialState: AddRepoState = {};
  const [state, dispatch] = useActionState<AddRepoState, FormData>(
    addRepository,
    initialState
  );

  const searchParams = useSearchParams();

  const repoId = state.repoId ?? searchParams.get('repoId') ?? undefined;
  const chatId = state.chatId ?? searchParams.get('chatId') ?? undefined;
  const githubUrl = searchParams.get('github_url') ?? '';
  

  return (
    <div className="flex flex-col gap-6">
      {/* Repo URL Input */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Repository URL</h2>
        <form action={dispatch} className="flex gap-2">
          <input
            type="url"
            name="github_url"
            placeholder="https://github.com/owner/repo"
            required
            defaultValue={githubUrl}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button type="submit">Load Repo</Button>
        </form>
        {state.error && (
          <p className="mt-2 text-sm text-red-500">{state.error}</p>
        )}
      </div>

      {/* Feature Buttons - Only show when repo is loaded */}
      {repoId && (
        <FeatureButtons repoId={repoId} userId={userId} />
      )}

      {/* Chat Section - Only show when repo and chat are loaded */}
      {repoId && chatId && (
        <ChatSection
          repoId={repoId}
          chatId={chatId}
          userId={userId}
        />
      )}
    </div>
  );
}