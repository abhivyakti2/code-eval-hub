import { auth } from "@/auth";
import ChatSection from "@/app/ui/dashboard/chat-section";

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
      />
    </main>
  );
}
