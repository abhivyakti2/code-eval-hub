import Link from "next/link";
import {
  CodeBracketIcon,
  HomeIcon,
  PowerIcon,
} from "@heroicons/react/24/outline";
import { fetchChatHistoryByUser } from "@/app/lib/data";
import { auth, signOut } from "@/auth";
import ChatHistory from "@/app/ui/dashboard/chat-history";
import { logout } from "@/app/lib/actions";

export default async function SideNav() {
  const session = await auth(); //to show user specific chat history, we need to get the user id from the session, and then fetch the chat history for that user from the database. if there is no session or user id, we can show a message to login to see chat history. but ig dashboard is not accessable without login, so we can assume that there will be a session and user id when this component is rendered.
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const chats = userId ? await fetchChatHistoryByUser(userId) : [];
  return (
    <div className="flex h-full flex-col px-3 py-4 md:px-2">
      <Link
        href="/"
        className="mb-2 flex items-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-white"
      >
        <CodeBracketIcon className="h-6 w-6" />
        <span className="text-sm font-bold">CodeEvalHub</span>
      </Link>
      <div className="flex grow min-h-0 flex-row justify-start space-x-2 md:flex-col md:space-x-0 md:space-y-2">
        <Link
          href="/dashboard"
          className="flex h-[48px] items-center gap-2 rounded-md bg-gray-50 px-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:p-2"
        >
          <HomeIcon className="w-6" />
          <span className="hidden md:block">Dashboard</span>
        </Link>{" "}
        {/* TODO : nav links is only showing dashboard anyways, we can just create a normal link component here for it and remove the nav links file. */}
        <div className="hidden min-h-0 w-full flex-1 rounded-md bg-gray-50 md:flex md:flex-col">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Chat History
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {userId ? (
              <ChatHistory chats={chats} />
            ) : (
              <p className="px-3 py-2 text-sm text-gray-500">
                Sign in to view Chat history.
              </p>
            )}
          </div>
        </div>
        <form action={logout}>
          <button className="flex h-[48px] w-full grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3">
            <PowerIcon className="w-6" />
            <div className="hidden md:block">Sign Out</div>
          </button>
        </form>
      </div>
    </div>
  );
}
