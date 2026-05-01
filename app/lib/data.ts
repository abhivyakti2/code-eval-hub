import { prisma } from "@/app/lib/db";
//importing prisma instance to interact with the database. This instance is typically configured to connect to a specific database and provides methods for querying and manipulating data using Prisma's ORM capabilities.
import { unstable_cache } from "next/cache";
//importing the unstable_cache function from Next.js's caching utilities. This function allows you to cache the results of asynchronous operations, such as database queries, to improve performance and reduce redundant data fetching.
// The "unstable" prefix indicates that this API may be experimental or subject to change in future releases of Next.js.

//Cache is shared when the data is NOT user-specific.
// tag based caching is for instant UI updates after change.


// TODO : not needed if we're fetching chats by user. cpnvert to get user chats instead
export async function fetchRepositoriesByUser(userId: string) {
  try {
    return await unstable_cache( // returns from cache if available, otherwise runs the provided async function to fetch data and caches it for future use.
      async () => {
        const chats = await prisma.chat.findMany({
          where: { userId },
          include: { repository: true }, //means? It tells Prisma to include the related repository data for each chat.
          orderBy: { createdAt: "desc" },
        });
        //why de-duplicate repos when there can be no duplicate chats for the same repo?
        //TODO : check if it is still possible to have multiple chats for the same repo,
        // if not we can remove the deduplication step.
        const dedup = new Map(
          chats.map((c) => [c.repository.id, c.repository]),
        );
        return Array.from(dedup.values());
      },
      // TODO : check all tags are in sync, eveywhere. TEST cache working if possible.
      ["repositories-by-user", userId], // This is the cache key, which uniquely identifies the cached data. It can be any serializable value, but using an array with descriptive strings and variables (like userId) helps ensure uniqueness and clarity.
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
    // TODO : cache will have recent user repos? we don't need all repos every time right? like top x repos sorted by recent chats? or repos with recent chats?
    // TODO : add reminder for user to delete chat after a month, most chats won't be relevant after a month, and it will save cost and also make sure user won't have too many chats. for repos, we can leave them for 2 months? or longer?
    //what's difference b/w cache key n tags? cache key is for identifying the cached data, while tags are for grouping related cache entries together, allowing for efficient invalidation of multiple entries when related data changes.
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch repositories");
  }
}

//unstable cache is iffe run when the function is called, and it caches the result based on the provided key.

export async function fetchRepositoryById(id: string) {
  try {
    return await unstable_cache(
      async () => prisma.repository.findUnique({ where: { id } }),
      ["repositories-by-id", id],
      { tags: ["repositories", `repo-${id}`] },
    )();
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch repository.");
  }
}

export async function fetchFilteredRepositories(
  //TODO: remove, idts needed. we give url, not owner or repo name.
  // can we get exact repo we put url of?
  userId: string,
  query: string,
  page: number,
  perPage = 8,
) {
  const skip = (page - 1) * perPage;
  try {
    return await unstable_cache(
      async () =>
        prisma.repository.findMany({
          where: {
            userId,
            repository: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { owner: { contains: query, mode: "insensitive" } },
              ],
            },
          },
          include: { repository: true },
          orderBy: { createdAt: "desc" },
          skip,
          take: perPage,
        }),
      ["filtered-repositories", userId, query, String(page), String(perPage)],
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to search repositories.");
  }
}

export async function fetchRepositoryPages(
  //TODO : can be incorporated into fetchFilteredRepositories,
  // do we need to keep it separate? we don't need filtered reslts anyways. we're showing chat names in sidebar, so remove filter functions
  userId: string,
  query: string,
  perPage = 8,
): Promise<number> {
  try {
    const count = await unstable_cache(
      async () =>
        prisma.chat.count({
          where: {
            userId,
            repository: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { owner: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        }),
      ["repositories-pages-count", userId, query, String(perPage)],
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
    return Math.ceil(count / perPage);
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to count repositories.");
  }
}

export async function fetchContributorsByRepo(repositoryId: string) {
  try {
    return await unstable_cache(
      async () =>
        prisma.contributor.findMany({
          where: { repositoryId },
          orderBy: { totalCommits: "desc" },
        }),
      ["contributors-by-repo", repositoryId], // what is this array? it's the cache key, which uniquely identifies the cached data. It can be any serializable value, but using an array with descriptive strings and variables (like repositoryId) helps ensure uniqueness and clarity.
      { tags: [`repo-${repositoryId}`] }, // tag vs cache key? cache key is for identifying the cached data, while tags are for grouping related cache entries together, allowing for efficient invalidation of multiple entries when related data changes.
      //identifying means if the same function is called again with the same parameters, it can return the cached result instead of executing the function again, improving performance. Tags allow us to group related cache entries together, so if we need to invalidate all cache entries related to a specific repository, we can do so efficiently by targeting the tag.
      //TODO : understand how tags work with cache, why here repo tag?  
    )();
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch contributors");
  }
}

//single chat for single repo for a user.
// TODO: not needed if we're fetching chats by user. we can get all chats for the user, unless we're updating something across a repository's all chat's from all users, but there's nothing like that needed, because summaries that are common for a repo are already in repotable not in chat. and we can show user newest summaries by updating comitsha when user opens chat after new commits.
export async function fetchChatsByRepo(userId: string, repositoryId: string) {
  try {
    return await prisma.chat.findMany({
      where: { userId, repositoryId },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch chats.");
  }
}

//TODO : we should use try n catch like this in actions too, and keep this pattern consistent for error handling, and also log errors in a way that we can track them and fix them. 
export async function fetchMessagesByChat(chatId: string) {
  try {
    return await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch messages.");
  }
}

// TODO : this is the function needed. not above filter ones or fetch repositories by user. so keep only one we need to show the sidebar chat names.
export async function fetchChatHistoryByUser(userId: string) {
  try {
    return await unstable_cache(
      async () =>
        prisma.chat.findMany({
          where: { userId },
          include: {
            repository: {
              select: {
                id: true,
                name: true,
                githubUrl: true, //to show in search params when clicked? is there anything else needed for search params? in case we do n we fetch it after clicking chat name, then we can get url there as well. if not, i.e this is al needed for url search params of the chat url then keep it here.
              },
            },
            _count: { // to show number of messages in sidebar
              select: { messages: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
      ["chat-history-by-user", userId],
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch chat history.");
  }
}

//TODO : not needed 
export async function fetchLatestQuestions(
  contributorId: string,
  scope: "contributor" | "repository" = "contributor",
) {
  try {
    return await prisma.generatedQuestion.findFirst({
      where: { contributorId, scope },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch questions.");
  }
}

// TODO : we should move all database fetching functions to this file, and keep all data fetching logic in one place, and also keep the pattern consistent for error handling and caching. and also we can easily track all database interactions in one file, and also we can easily update the caching strategy if needed, like changing cache keys or tags, or adding new caching functions. so we should move all fetching functions in actions to this file, and also make sure to use try n catch for error handling, and also use unstable_cache for caching where needed. 
//if that is best practice, and we can create functions for all data fetches needed in actions, like fetching chat with repo and contributors for the sidebar, fetching chat history for the chat page, fetching messages for the chat page, etc. and also we can create functions for updating data if needed, like updating last viewed commit sha for a contributor when user opens a chat, etc. so that we can keep all data interactions in one place and also keep the pattern consistent for error handling and caching.

// TODO : where is this needed? when we open a chat? in which function is this being called?
export async function fetchChatWithRepoAndContribs(chatId: string) {
  try {
    return await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        repository: {
          include: {
            contributors: { orderBy: { totalCommits: "desc" } },
          },
        },
        //chatContribViewedShas: true, // per-contributor last-viewed SHA records
      },
    });
  } catch (err) {
    console.error("DB Error:", err);
    throw new Error("Failed to fetch chat context.");
  }
}
