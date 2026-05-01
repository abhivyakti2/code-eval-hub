'use client'
import Link from "next/link";
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';


//TODO : all types like this we're using for our working logic, we should put in definitions.ts
type ChatHistoryItem={
    id: string;
    repositoryId: string;
    repository: {
        name: string;
        githubUrl: string;
    };
    _count: {
        messages: number;
    };
};

//async(returns promise) is used for server components(they can pause befor rendering final html), so when turning a server component to a client component remove async. Async is allowed inside hooks(like useEffect), not in the client component itself
export default function ChatHistory({chats}:{chats: ChatHistoryItem[]}){
    const searchParams = useSearchParams();
    const activeChatId = searchParams.get('chatId');
    if(chats.length === 0){
        return (
            <p className="px-3 py-2 text-sm text-gray-500">
                No chats yet. Start one from Dashboard.
            </p>
        );
    }

    return (
        <div className="space-y-1">
            {chats.map((chat)=>{
                const isActive=activeChatId === chat.id; //condition returns boolean
                return (
                <Link 
                key = {chat.id} 
                href={`/dashboard/chat?repoId=${chat.repositoryId}&chatId=${chat.id}&github_url=${encodeURIComponent(chat.repository.githubUrl)}&repo_name=${encodeURIComponent(chat.repository.name)}`}
                className={clsx(
              'block rounded-md px-3 py-2 text-sm hover:bg-sky-100 hover:text-blue-600',
              isActive ? 'bg-sky-100 text-blue-600' : 'text-gray-700'
            )}
                >
                    <div className="truncate text-sm font-medium">{chat.repository.name}</div>
                    <div className="text-xs text-gray-500">{chat._count.messages} messages</div>
                </Link>)
            })}
        </div>
    );
}