'use client';

import { useState } from 'react';
import { sendChatMessage, generateRepoSummary, triggerRepoIngestion } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';
import { PaperAirplaneIcon, XMarkIcon } from '@heroicons/react/24/outline';

const REPO_ACTIONS=[
  {id : 'summary', label: 'Generate Summary'},
  {id : 'ingest', label: 'Ingest Repository'},
  {id : 'chat', label: 'Ask a Question'}
]
// TODO : is it best way to do this?

export default function ChatSection({
  repoId,
  chatId,
  userId,
  githubUrl,
}: {
  repoId?: string;
  chatId?: string;
  userId: string;
  githubUrl?: string; //means may or may not have a github url?
}) {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  //the type of input is defined outside () why? why not inside use state() along with []? 
  // useState(<Array<{ role: string; content: string }>>[]) like this? 
  // because we want to explicitly define the type of the state variable, and 
  // it can be more readable to separate the type definition from the initial value. 
  // but it's also common to define the type inline with the initial value, so it's mostly a matter of style and preference. 
  // both ways are valid and will work correctly in TypeScript.
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isRepoLoaded = !!repoId && !!chatId; //if there's no repoId and chatId, 
  // it means the repo is not loaded yet, another ! means they're loaded
  // so we can show the action buttons 

  //TODO : allow multiselect, answer should return all requested in order requested
  function handleSelectAction(id: string){
    setSelectedAction((prev)=> (prev=== id ? null : id))
  }

  function handleUnselectAction(){
    setSelectedAction(null);
  }

  async function handleSend() {
    if(!isRepoLoaded || sending) return;

    const userText = input.trim().toLowerCase();
    // TODO : add if (!input.trim()) return; ?
    
    //TODO : idts ingesting repo needs to be selected by user, 
    // remove it as a button, it will happen if repo isn't ingested 
    // and user select some other option like summary or questions
    if(selectedAction === 'ingest'){
      setActionLoading('ingest');
      try {
        await triggerRepoIngestion(repoId!);
        setMessages((prev)=> [
          ...prev,
          { role: 'user', content: '[Ingest Repository]' + (userText? `${userText}`: '')},
          { role: 'assistant', content: 'Repository ingested successfully!' },
        ]);
        setInput('');
        setSelectedAction(null);
      }finally{
        setActionLoading(null);
      }
      //UNDERSTAND BETTER :
      //catch not needed? because if there's an error, it will be handled 
      // by the global error handler and show a toast notification, and we 
      // don't need to do anything specific here for that case.
      return;
    }
    if (selectedAction === 'summary') {
      if (!userText) {
        // No custom prompt
        setActionLoading('summary');
        try {
          const summary = await generateRepoSummary(repoId!);
          setMessages((prev) => [
            ...prev,
            { role: 'user', content: '[Generate Summary]' },
            //TODO : this generate summary is the whole prompt? 
            { role: 'assistant', content: summary },
          ]);
          setSelectedAction(null);
        } finally {
          setActionLoading(null);
        }
        return;
      }
      // With custom prompt      
      const question = `Generate a summary of this repository focusing on: ${userText}`;
      // TODO : refine prompt
      setInput('');
      setSending(true);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `[Generate Summary] ${userText}` },
      ]);
      try {
        const answer = await sendChatMessage(chatId!, repoId!, question); // why ! used? won't it make value false? no, because they're defined for sure, and ! makes them non-nullable, so it tells TypeScript that we know these values are not null or undefined at this point in the code, and it's safe to use them.
        setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
        setSelectedAction(null);
      } finally {
        setSending(false);
      }
      return;
    }
    // Default: general chat
    if (!userText) return;
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    try {
      const answer = await sendChatMessage(chatId!, repoId!, userText);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } finally {
      setSending(false);
    }
  }
  const isDisabled = !isRepoLoaded;
  const isSendDisabled = isDisabled || sending || !!actionLoading || (!input.trim() && selectedAction !== 'ingest');

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-lg font-semibold">Chat with Repository</h2>
        <p className="text-sm text-gray-500">
          {isRepoLoaded
            ? "Select an action or ask a question below"
            : "Load a repository above to start chatting"}
        </p>
      </div>
      {/* TODO : don't show user load repo? */}
      {/* Messages */}
      <div
        className="flex-1 space-y-4 overflow-y-auto p-4"
        style={{ minHeight: "300px", maxHeight: "500px" }}
      >
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            {isRepoLoaded
              ? "No messages yet. Start a conversation!"
              : "Your chat will appear here once you load a repository."}
          </p>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 pt-3 pb-1">
        <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
          Repository Actions
        </p>
        <div className="flex flex-wra gap-2">
          {REPO_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => handleSelectAction(action.id)}
              disabled={isDisabled || !!actionLoading || sending}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
            ${
              selectedAction === action.id
                ? "border-blue-500 bg-blue-100 text-blue-700"
                : "border-gray-300 bg-white text-gray-600 hover:border-blue:400 hover:text-blue-600"
            }
            disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {actionLoading === action.id ? "Working..." : action.label}
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 pt-2">
          {selectedAction && (
            <div className='mb-2 flex items-center gap-1'>
              <span className='inline-flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white'>
                {REPO_ACTIONS.find((a)=> a.id ===selectedAction)?.label}
                <button onClick={handleUnselectAction}
                className='m1-1 rounded-full hover:bg-blue-600 p-0.5'
                aria-label="Remove selected action">
                  <XMarkIcon className='h-3 w-3'/>
                </button>
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isSendDisabled && handleSend()}
              placeholder={
                isDisabled 
                ? 'Load a repository to start chatting...'
                : selectedAction === 'ingest' 
                ? 'Optional: add notes (or click Send to ingest now)'
                : selectedAction ==='summary'
                ? 'Optional: focus area (e.g. "authentication flow")'
                : 'Ask a question...'
              }
              disabled={isDisabled || sending || !!actionLoading}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <Button onClick={handleSend} disabled={isSendDisabled}>
              <PaperAirplaneIcon className="h-5 w-5" />
            </Button>
          </div>
                  
        </div>
      </div>
    </div>
  );
}