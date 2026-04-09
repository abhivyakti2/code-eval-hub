'use client';

import { useState } from 'react';
import { sendChatMessage } from '@/app/lib/actions';
import { Button } from '@/app/ui/button';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';

export default function ChatSection({
  repoId,
  chatId,
  userId,
}: {
  repoId: string;
  chatId: string;
  userId: string;
}) {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;

    const question = input.trim();
    setInput('');
    setSending(true);

    // Add user message optimistically
    setMessages((prev) => [...prev, { role: 'user', content: question }]);

    try {
      const answer = await sendChatMessage(chatId, repoId, question);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-lg font-semibold">Chat with Repository</h2>
        <p className="text-sm text-gray-500">Ask questions about this repository</p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4" style={{ minHeight: '300px', maxHeight: '500px' }}>
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400">No messages yet. Start a conversation!</p>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !sending && handleSend()}
            placeholder="Ask a question..."
            disabled={sending}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>
            <PaperAirplaneIcon className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}