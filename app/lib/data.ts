import { prisma } from '@/app/lib/db';
import { unstable_cache } from 'next/cache';



//Cache is shared when the data is NOT user-specific. 
// tag based caching is for instant UI updates after change. 
export async function fetchRepositoriesByUser(userId: string) {
  try {
    return await unstable_cache(
      async () => {
        const chats = await prisma.chat.findMany({
          where: { userId },
          include: { repository: true }, //means? It tells Prisma to include the related repository data for each chat.
          orderBy: { createdAt: 'desc' },
        });
        //why de-duplicate repos when there can be no duplicate chats for the same repo?
        //TODO : check if it is still possible to have multiple chats for the same repo, 
        // if not we can remove the deduplication step.
        const dedup = new Map(chats.map((c) => [c.repository.id, c.repository]));
        return Array.from(dedup.values());
      },
      ['repositories-by-user', userId], // This is the cache key, which uniquely identifies the cached data. It can be any serializable value, but using an array with descriptive strings and variables (like userId) helps ensure uniqueness and clarity.
      { tags: ['repositories', `user-${userId}-repositories`] }
    )();
    //cache key is for identifying the cached data, while tags are for grouping related cache entries together, allowing for efficient invalidation of multiple entries when related data changes.
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch repositories');
  }
}

//unstable cache is iffe run when the function is called, and it caches the result based on the provided key.

export async function fetchRepositoryById(id: string) {
  try {
    return await unstable_cache(
      async()=>
        prisma.repository.findUnique({ where: { id } }),
      ['repositories-by-id', id],
      { tags: ['repositories', `repo-${id}`]}
    )();
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch repository.');
  }
}

export async function fetchFilteredRepositories(
  //TODO: remove, idts needed. we give url, not owner or repo name. 
  // can we get exact repo we put url of?
  userId: string,
  query: string,
  page: number,
  perPage = 8
) {
  const skip = (page - 1) * perPage;
  try {
    return await unstable_cache(
      async () =>
        prisma.repository.findMany({
          where: {
             userId ,
            repository : {
              OR: [
              { name: { contains: query, mode: "insensitive" } },
              { owner: { contains: query, mode: "insensitive" } },
            ],
          },
          },
          include : { repository: true},
          orderBy: { createdAt: "desc" },
          skip,
          take: perPage,
        }),
      ["filtered-repositories", userId, query, String(page), String(perPage)],
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to search repositories.');
  }
}

export async function fetchRepositoryPages(
  //TODO : can be incorporated into fetchFilteredRepositories, 
  // do we need to keep it separate?
  userId: string,
  query: string,
  perPage = 8
): Promise<number> {
  try {
    const count = await unstable_cache(
      async () =>
        prisma.chat.count({
          where: {
            userId,
            repository: {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { owner: { contains: query, mode: 'insensitive' } },
              ],
            },
          },
        }),
      ["repositories-pages-count", userId, query, String(perPage)],
      { tags: ["repositories", `user-${userId}-repositories`] },
    )();
    return Math.ceil(count / perPage);
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to count repositories.');
  }
}

export async function fetchContributorsByRepo(repostroryId: string){
  try{
    return await unstable_cache(
      async()=>
        prisma.contributor.findMany({
      where: { repostroryId},
      orderBy: {totalCommits: 'desc'},
    }),
    ['contributors-by-repo', repostroryId],
    { tags: [`repo-${repostroryId}`]}
    )();
  }catch(err){
    console.error('DB Error:', err);
    throw new Error('Failed to fetch contributors');
  }
}

//single chat for single repo for a user
export async function fetchChatsByRepo(userId: string, repositoryId: string) {
  try {
    return await prisma.chat.findMany({
      where: { userId, repositoryId },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch chats.');
  }
}

export async function fetchMessagesByChat(chatId: string) {
  try {
    return await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch messages.');
  }
}

//not needed?
export async function fetchLatestQuestions(
  contributorId: string,
  scope: 'contributor' | 'repository' = 'contributor') {
  try {
    return await prisma.generatedQuestion.findFirst({
      where: { contributorId, scope },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.error('DB Error:', err);
    throw new Error('Failed to fetch questions.');
  }
}