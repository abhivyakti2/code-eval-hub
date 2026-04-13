'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { addRepository, AddRepoState, validatedGithubRepoUrl } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';

export default function RepoEvaluatorSection({userId}:{userId : string}){
  //TODO : do we need userId here? we can get user from session on server side when we add repo, so maybe not needed here?
  const initialState: AddRepoState ={};
  const [state, dispatch] = useActionState(addRepository, initialState);
  // action state is used when we want to track the state of a server action, such as loading, success, or error states.
  // whereas use server is used to define a server action that can be called from the client side, and it doesn't provide built-in state management for loading or error states.
  // for forms, useActionState can be more convenient as it allows you to easily manage the form submission state and display feedback to the user based on the action's status.

  const searchParams = useSearchParams();

  const repoId = state.repoId ?? searchParams.get('repoId') ?? undefined;
  const chatId = state.chatId ?? searchParams.get('chatId') ?? undefined;
  const githubUrl = searchParams.get('github_url') ?? '';
  // these params are set when user clicks on "Chat with Repo" button after entering the github url, and we can also get them from the url when user refreshes the page or shares the link.
  //but if we click chat with repo, we move to chat page, we won't be on this component, 
  //  TODO :this component cannot get the params above right?
  const repoNameFromParams = searchParams.get('repo_name') ?? undefined;

  const [urlInput, setUrlInput]=useState(githubUrl);
  const [urlStatus, setUrlStatus]=useState<'idle' | 'checking' | 'valid'| 'invalid'>('idle');
  const [urlMessage, setUrlMessage]=useState('');
  const [validatedRepoName, setValidatedRepoName]=useState('');

  const requestIdRef= useRef(0);
  const isRepoLoaded= !!repoId && !!chatId;
  useEffect(()=>{
    if (isRepoLoaded) return;

    const value= urlInput.trim();
    if(!value){
      setUrlStatus('idle');
      setUrlMessage('');
      setValidatedRepoName('');
      return;
    }

    setUrlStatus('checking');
    setUrlMessage('Checking repository...');

    const requestId= ++requestIdRef.current;
    const timer = setTimeout(async ()=>{ 
      //async used here, it doesn't cause any issue right?
      //await isn't allowed in non-async function
      const result= await validatedGithubRepoUrl(value);

      if(requestId !== requestIdRef.current) return; 

      if(result.valid){
        setUrlStatus('valid');
        setUrlMessage('Repository is valid.');
        setValidatedRepoName(result.repo ?? '');
        if(result.normalizedURL && result.normalizedURL !==value){
          setUrlInput(result.normalizedURL);
        }
      }else{
        setUrlStatus('invalid');
        setUrlMessage( result.error ?? 'Invalid repository URL.');
        setValidatedRepoName('');
      }
    }, 600);

    return ()=> clearTimeout(timer);
  }, [urlInput, isRepoLoaded]);
  

  //TODO : check if add repo only adds new repo in repo table 
  // or adds repo to users repos?
  return (
   
      
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
            value={urlInput}
            onChange={(e)=> setUrlInput(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button type="submit"
          disabled={urlStatus === 'checking' || (urlInput.trim().length >0 && urlStatus !=='valid')}>
            Chat with Repo
          </Button>
        </form>
        {urlStatus !== 'idle' && (
          <p className={`mt-2 text-sm ${
            urlStatus === 'valid'
            ? 'text-green-600'
            : urlStatus === 'invalid'
            ? 'text-red-500'
            : 'text-gray-500'
          }`}>
            {urlMessage}
          </p>
        )}
        {/* TODO : use the aria-describedby method to display error*/}
        {/* which errors are shown below? they are the errors from the dispatch server action*/}
        {state.error && (
          <p className="mt-2 text-sm text-red-500">{state.error}</p>
        )}
      </div>
  );
}