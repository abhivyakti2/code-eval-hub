import { auth } from "@/auth";
import ChatSection from "@/app/ui/dashboard/chat-section";
import { fetchMessagesByChat } from "@/app/lib/data";
import { fetchChatWithRepoAndContribs } from "@/app/lib/data";
import { fetchLatestCommitSha, parseGithubUrl } from "@/app/lib/github";

export default async function ChatPage({
  searchParams, //this is the prop
}: {
  //below is the type. these params were set when we navigated to this page in the repo evaluator component? by which function?
  // by the handleChatClick function(CHECK) in the repo evaluator component, we navigate to this page and pass these params in the url.
  searchParams: Promise<{
    repoId?: string;
    chatId?: string;
    github_url?: string;
    repo_name?: string;
  }>;
}) {
  // we need user id to fetch the messages for the chat, and also to pass it to the chat section component, which will use it to determine if the message is sent by the current user or not, and also to fetch the user specific data like last viewed summary sha for the chat and repo. we can get the user id from the session, which we can get from the auth function.
  // auth is just function, not actual info, it check info of session from cookies and return it. we can use it in any server component to get the session info. since this page is server component, we can use it here to get the session info and then get the user id from it.
  const session = await auth();
  //TODO : in repoevaluator component also we can do this way if we have to access user id there.
  const userId = session!.user!.id as string;

  const params = await searchParams;
  //why await? it's a promise, but doesn't it get sent as prop as resolved value? no, when we navigate to this page and pass the search params in the url, we are passing it as a promise because we are using async function to get the search params from the url. so we need to await it here to get the actual values of the search params. if we don't await it, then params will be a promise and we won't be able to access the values of the search params. by awaiting it, we are telling the code to wait until the promise is resolved and then assign the resolved value to params variable.
  const { owner, name } = parseGithubUrl(params.github_url ?? "");
 //TODO : name is showing issue, and parseGithubUrl just gets the last two parts of the url, so if the url is not in correct format, it will return incorrect values. we can add some validation (say using validateGithubUrl function)to check if the url is in correct format before parsing it, and if it's not in correct format, we can set owner and name to null or empty string, and then handle that case in the UI accordingly. this will prevent any issues that may arise from trying to use incorrect owner and name values when fetching data from github.
  const [initialMessages, chatContext, liveGithubSha] = await Promise.all([
    params?.chatId ? fetchMessagesByChat(params.chatId) : Promise.resolve([]),
    params?.chatId
      ? fetchChatWithRepoAndContribs(params.chatId)
      : Promise.resolve(null), //creates a promise that resolves to null immediately, so that we can use it in the Promise.all without it being undefined. this way, if chatId is not present in the params, we will have initialMessages as an empty array and chatContext as null, which we can handle in the UI accordingly. if we didn't do this and just put null, then it would be undefined and we would have to check for undefined in the UI, which can be error prone and less clean. by using Promise.resolve(null), we ensure that we always have a defined value for chatContext, even if it's null, which makes it easier to handle in the UI.
        owner && name ? fetchLatestCommitSha(owner, name).catch(() => null) : Promise.resolve(null),

    ]);
  //TODO : we should show correct error instead of [], null in case of error. we can use try catch block to catch the error and then show the error message in the UI.
  //TODO : also we can show loading state while fetching the data. we can use a state variable to keep track of the loading state and then show a loading spinner in the UI while the data is being fetched. once the data is fetched, we can set the loading state to false and show the chat section component with the fetched data. this will improve the user experience by providing feedback that something is happening while the data is being fetched, instead of showing an empty screen or stale data.

  return (
    <main className="flex h-full min-h-[calc(100vh-5rem)] w-full flex-col">
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
        repoOwner={chatContext?.repository.owner}
        repoLastCommitSha={chatContext?.repository.lastCommitSha ?? null}
        repoLastSummarySha={chatContext?.repository.lastSummarySha ?? null}
        repoStoredSummary={chatContext?.repository.repoSummary ?? null}
        chatLastViewedSummarySha={chatContext?.lastViewedSummarySha ?? null}
        chatLastChatSha={chatContext?.lastChatSha ?? null}
        // Map of contributorId → viewedSha, built from the join table rows
        chatLastViewedContribSummarySha={
          chatContext?.lastViewedContribSummarySha ?? null
        }
        initialLiveGithubSha={liveGithubSha}
        contributors={
          chatContext?.repository.contributors.map((c) => ({
            id: c.id,
            githubLogin: c.githubLogin,
            summary: c.summary ?? null,
            lastSummarySha: c.lastSummarySha ?? null,
          })) ?? []
        }
      />
      {/* TODO : why are we using this component if we are just sending props? can't data be fetched in chat section? */}
    </main>
  );
}
