'use client'
import Link from "next/link";
import { useSearchParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useState } from 'react';
import { TrashIcon } from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "@/app/lib/definitions";
import { deleteRepository } from "@/app/lib/actions";

export default function ChatHistory({ chats }: { chats: ChatHistoryItem[] }) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const activeChatId = searchParams.get('chatId');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    async function handleDelete(e: React.MouseEvent, chat: ChatHistoryItem) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Remove "${chat.repository.name}" from your chats?`)) return;
        setDeletingId(chat.repositoryId);
        await deleteRepository(chat.repositoryId);
        if (activeChatId === chat.id) router.push('/dashboard');
        setDeletingId(null);
    }

    if (chats.length === 0) {
        return (
            <p className="px-3 py-2 text-sm text-slate-400">
                No chats yet. Start one from Dashboard.
            </p>
        );
    }

    return (
        <div className="space-y-1">
            {chats.map((chat) => {
                const isActive = activeChatId === chat.id;
                const isDeleting = deletingId === chat.repositoryId;
                return (
                    <div key={chat.id} className="group relative">
                        <Link
                            href={`/dashboard/chat?repoId=${chat.repositoryId}&chatId=${chat.id}&github_url=${encodeURIComponent(chat.repository.githubUrl)}&repo_name=${encodeURIComponent(chat.repository.name)}`}
                            className={clsx(
                                'block rounded-md px-3 py-2 pr-8 text-sm transition-colors hover:bg-slate-800 hover:text-cyan-300',
                                isActive ? 'bg-slate-800 text-cyan-300' : 'text-slate-200',
                                isDeleting && 'opacity-50 pointer-events-none'
                            )}
                        >
                            <div className="truncate text-sm font-medium">{chat.repository.name}</div>
                        </Link>
                        <button
                            onClick={(e) => handleDelete(e, chat)}
                            disabled={isDeleting}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400 disabled:opacity-30"
                            aria-label={`Delete ${chat.repository.name}`}
                        >
                            {isDeleting
                                ? <span className="text-xs text-slate-400">...</span>
                                : <TrashIcon className="h-4 w-4" />
                            }
                        </button>
                    </div>
                );
            })}
        </div>
    );
}