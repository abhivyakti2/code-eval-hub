import { auth } from "@/auth";
import ChatSection from "@/app/ui/dashboard/chat-section";
import { fetchMessagesByChat } from "@/app/lib/data";

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{
    repoId?: string;
    chatId?: string;
    github_url?: string;
    repo_name?: string;
  }>;
}) {
  const session = await auth();
  const userId = session!.user!.id as string;
  const params = await searchParams;
  const initialMessages = params?.chatId
    ? await fetchMessagesByChat(params.chatId)
    : [];

  return (
    <main className="flex h-full min-h-[calc(100vh-5rem)] w-full flex-col">
      <h1 className="mb-4 text-xl font-semibold md:text-2xl">
        Chat with {params?.repo_name ?? "Repository"}
      </h1>
      <p className="mb-6 text-gray-600">
        Ask questions, generate summaries, or run repository actions.
      </p>
      <ChatSection
        repoId={params?.repoId}
        chatId={params?.chatId}
        githubUrl={params?.github_url}
        repoName={params?.repo_name}
        userId={userId}
        initialMessages={initialMessages.map((m) => ({
          role: m.role,
          content: m.content,
          features: m.features,
        }))} 
        // can put features in content itself, but it's better to have it separate for now, in case we want to use it for other purposes in the future, and it keeps the content cleaner. also, if we put it in content, we would need to parse it every time we want to use it, which can be error prone and less efficient. by keeping it separate, we can easily access the features without having to parse the content. and if we want to display the features in the UI, we can do that separately without affecting the main content of the message.
      />
    </main>
  );
}
