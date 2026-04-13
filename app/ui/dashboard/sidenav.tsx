import Link from 'next/link';
import NavLinks from '@/app/ui/dashboard/nav-links';
import { PowerIcon } from '@heroicons/react/24/outline';
import { redirect } from 'next/navigation';
import {signOut} from '@/auth';
export default function SideNav() {

  // TODO : import chat names from db and render here
 // If you already have a chats array in scope, put this inside the scroll area:
  return (
    <div className="flex h-full flex-col px-3 py-4 md:px-2">
      <Link
        className="mb-2 flex h-20 items-end justify-start rounded-md bg-blue-600 p-4 md:h-40"
        href="/"
      >
        
      </Link>
      <div className="flex grow min-h-0 flex-row justify-start space-x-2 md:flex-col md:space-x-0 md:space-y-2">
        <NavLinks />
        <div className="hidden min-h-0 w-full flex-1 rounded-md bg-gray-50 md:flex md:flex-col">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Chat History
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {/* render chat names here 
            {chats.map((chat) => (
  <Link
    key={chat.id}
    href={`/dashboard/chat?repoId=${chat.repositoryId}&chatId=${chat.id}&github_url=${encodeURIComponent(chat.repository.githubUrl)}&repo_name=${encodeURIComponent(chat.repository.name)}`}
    className="block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-sky-100 hover:text-blue-600"
  >
    {chat.repository.name}
  </Link>
))}
            */}
          </div>
        </div>
        <form
          action={async()=>{
            'use server';
            await signOut({redirectTo: '/'});
          }}
        >
          {/* sometimes this shows unexpected error : because the inline server action was relying on NextAuth’s internal redirect response, and in this context the form action handler can treat that as an unexpected payload.
          TODO : replace w/ logout from actions.ts */}
          <button className="flex h-[48px] w-full grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3">
            <PowerIcon className="w-6" />
            <div className="hidden md:block">Sign Out</div>
          </button>
        </form>
      </div>
    </div>
  );
}
