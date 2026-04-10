'use server';
//Marks functions in that file as Server Actions

import {revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {z} from 'zod';
import { auth, signIn, signOut } from '@/auth';
import { AuthError } from 'next-auth';
import {prisma} from '@/app/lib/db';
import {
    parseGithubUrl,
    fetchRepoMetadata,
    fetchContributors,
    fetchLatestCommitSha,
} from '@/app/lib/github';
import bcrypt from 'bcrypt';

export type SignUpState = {
  errors?: { //shape matches the result of zod's flatten method, which organizes errors by field
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
  message?: string | null;
};

export type LoginState ={
  errors?: {
    email?: string[];
    password?: string[];
  };
  message?: string | null;
}

const SignUpSchema = z
  .object({
    email: z.string().email({message: 'Please enter a valid email.'}),
    password: z.string().min(6, {message: 'Password must be at least 6 characters.'}),
    confirmPassword: z.string().min(6, {message: 'Please confirm your password.'}),
  })
  .refine((data)=> data.password === data.confirmPassword,{
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const LoginSchema = z.object({
  email: z.string().email({message: 'Please enter a valid email.'}),
  password: z.string().min(1, {message: 'Password is required.'}),
});
//these messages are sent only when there's a corresponding error, 
// so we can be specific with them, and they will be displayed in the UI 

const CreateUser = SignUpSchema; //why not just use SignUpSchema directly in register function?

export async function register( prevState: SignUpState, formData: FormData){
  const validatedFields = CreateUser.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if(!validatedFields.success){
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Invalid Fields. Failed to create account.',
    }; //will only missing fields cause error? or invalid ones too?
  }

  const { email, password }= validatedFields.data;
  const existingUser = await prisma.user.findUnique({ where: { email }, });
  if(existingUser){
    return {
      errors: { email: ['Email already in use.']},
      message: 'Failed to create account.',
    };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try{
    await prisma.user.create({
      data: { email, password: hashedPassword, },
    });
  }catch(error){
    return {
      message: 'Database error: Failed to create account.',
    };
  }

  try{
    await signIn('credentials', formData);
    //formData also contains confirmPassword, but it will be ignored by the 
    // credentials provider(we defined the authorize method), so it won't cause any issue.
  }catch(error){
    if(error instanceof AuthError){
      return {
        message: 'Account created, but failed to log in. Please log in.',
      };
    }
    throw error;
  }

  //tags are like labels you stick on cached data. 
  // You add them when caching/fetching data. 
  // Tags are stored in the Next.js Data Cache (server-side)
  // It’s an internal server cache managed by Next.js
  revalidateTag('repositories', 'max');  // TODO : need to add more tags here? like user-specific one?
  //why repositories? because after sign up, user will be redirected to dashboard, 
  // and we want to make sure the repositories list is up to date, 
  // even though it should be empty for a new user. It's a precaution to 
  // ensure the UI reflects the current state of the database after authentication.

  // 'max' : stale-while-revalidate behavior means that when we revalidate a tag,
  // the existing cached data with that tag can still be served to users 
  // while the new data is being fetched and cached. 

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function authenticate(prevState: LoginState | void,
    formData: FormData,
): Promise<LoginState|void>{ 
  //void needed because return in inconsistent. 
  // we return LoginState when there's an error, and nothing when it's successful, 
  // so we need to allow for both possibilities in the return type 
  // else useActionState will complain about type mismatch.
  //why didn't we do it in register? because in register, we always return SignUpState, even if it's successful, we return a message.
  
  const validatedFields = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if(!validatedFields.success){
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Invalid email or password format.',
    };
  }

  try{
    await signIn('credentials', formData);
  }catch (error){
    if(error instanceof AuthError){
      switch (error.type){
        case 'CredentialsSignin':
          return {message: 'Invalid credentials.'};
        default: 
          return {message: 'Something went wrong.'};
      }
    }
    throw error;
  }
  //no revalidation needed here because after login, user will be redirected to dashboard, 
  // and the dashboard page will fetch fresh data from the database, so we don't need to worry about stale cache in this case.
}

export async function logout(){
    await signOut({redirectTo: '/login'});
}

const GithubUrlSchema = z.string().url().refine(
    (url)=> /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url),
    {message: 'Must be a valid Github repository URL.'}
);
//each operator in the regex is explained as follows:
// ^https:\/\/github\.com\/ : ensures the URL starts with "https://github.com/" 
// [^/]+ : matches one or more characters that are not a slash, representing the owner of the repository
// \/ : matches a literal slash, separating the owner and repository name
// [^/]+ : matches one or more characters that are not a slash, representing the repository name
// we can also allow for optional .git at the end, and optional trailing slash, by adding (?:\.git)?(?:\/|$) at the end of the regex.

export type AddRepoState = { 
  error?: string | null;
  repoId?: string;
  chatId?: string;
  message?: string | null; 
};

export async function addRepository(prevState: AddRepoState, formData: FormData): Promise<AddRepoState>{
  const session = await auth(); //doesn't auth run when we login? why do we need to run it again here?
  // yes, auth runs when we login and creates a session, but we need to call it here 
  // to access the session data (like user ID) in this server action. 
  // it only creates the session if it doesn't already exist, so if the user is 
  // already logged in, it will just return the existing session without creating a new one.
  
  let userId=(session?.user as {id?: string} | undefined)?.id; 
  //we are asserting that session.user has an id property, but it might not(why not?), so we also allow for undefined.

  if(!userId){ // why we try to get it from the database using the email? 
  // because in some cases, especially with certain authentication providers or configurations, 
  // the session object might not include the user ID directly. 
  // However, it often includes the user's email, which we can use to look up 
  // the user in our database and retrieve their ID. This is a fallback mechanism 
  // to ensure we can still identify the user even if the session doesn't have the ID for some reason.
   
  //TODO: check if this is needed for the provider i'm using.
    const email = session?.user?.email;
    if(email){
      const user = await prisma.user.findUnique({
        where: {email},
        select:{id:true},
      });
      userId= user?.id;
    }
  }

  if(!userId) return {error: 'Please login again.'};

  const raw = formData.get('github_url') as string;
  const parsed = GithubUrlSchema.safeParse(raw);
  if(!parsed.success) return { 
    error:parsed.error.errors[0].message, 
    message : 'Invalid Github URL.'
  };

  let createdId: string | undefined;
  let chatId: string | undefined;

  const { owner, repo }= parseGithubUrl(parsed.data); //in github.ts
  try{
    const [meta, latestSha]= await Promise.all([
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]);
    let existing = await prisma.repository.findUnique({
      where : { githubId: meta.id},
      select: { id: true},
    })
    if(!existing){ //only add repo if userselects some feature
      const created = await prisma.repository.create({
        data:{
          githubId: meta.id,
          githubUrl: parsed.data,
          owner,
          name: repo,
          description: meta.description ?? null,
          lastCommitSha: latestSha,
        },
        select:{ id: true},
      });
      const contributors = await fetchContributors(owner, repo);
      await prisma.contributor.createMany({
        data : contributors.map((c)=>({
          repositoryId: created.id,
          githubLogin: c.login,
          avatarUrl: c.avatar_url,
          totalCommits: c.contributions,
        })),
        skipDuplicates: true,
      });
      existing = created;
    }
    createdId= existing.id;
    chatId= await getOrCreateChat(userId, existing.id);
  }catch(error){
    console.error(error);
    return { error: 'Failed to add repository from Github.'}
  }
  revalidateTag('repositories', 'max');
  revalidateTag(`repo-${createdId}`, 'max');
  revalidatePath('/dashboard'); //happens for all users? even if only one creates a new chat? 
  // yes, because the dashboard is server-rendered and the cache is shared across users.
  redirect(`/dashboard?repoId=${createdId}&chatId=${chatId}&github_url=${encodeURIComponent(parsed.data)}`);
}

export async function deleteRepository(id: string) { 
  // TODO : should return message in case of error. is it showing error now?
  // because of the transaction, if any of the operations fail, 
  // it will throw an error and not complete the transaction, so it won't delete the repository or the chats. 
  // We should catch that error and return a message to the user.

  const session = await auth();
  let userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) { // TODO: this can be made a middleware since it's repeated in multiple functions.
    const email = session?.user?.email;
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      userId = user?.id;
    }
  }

  if (!userId) return;

  await prisma.$transaction(async (tx) => {
    await tx.chat.deleteMany({ //why delete many? we only want to delete chat of a user, 
    // not all chats related to that repo, because other users may also have that repo in their dashboard.
      where: { userId, repositoryId: id },
    });

    const stillLinked = await tx.chat.count({
      where: { repositoryId: id },
    });

    if (stillLinked === 0) {
      await tx.repository.delete({ where: { id } });
    }
  });

  revalidateTag('repositories', 'max');
  revalidateTag(`repo-${id}`, 'max');
  revalidatePath('/dashboard');
}

const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:8000';

export async function triggerRepoIngestion(repoId: string){ 
  // TODO : should only happen if not ingested or when there's new commits, 
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    if(!repo) throw new Error('Repository not found');
    const res = await fetch(`${RAG_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            repo_id: repoId,
            owner: repo.owner,
            repo_name: repo.name,
            last_sha: repo.lastCommitSha,
        }),
    });
    if(!res.ok) {
        const errorBody = await res.json().catch(() => null); 
        //we are trying to parse the error response body as JSON, 
        // but if the response is not valid JSON 
        // (for example, if the server returns an HTML error page), 
        // it will throw an error. By catching that error and returning null, 
        // we can avoid crashing our application and handle the error more gracefully. 
        
        const detail = errorBody?.detail ?? `HTTP ${res.status}`; 
        //if errorBody is null or doesn't have a detail property, 
        // we use the HTTP status code as the detail message. 
        // This ensures that we always have some information about the error to include in our thrown error message.
        throw new Error(`RAG ingestion failed: ${detail}`);
    }

    const data=await res.json();
    await prisma.repository.update({
        where: { id: repoId },
        data: { lastCommitSha: data.latest_sha },
    });
    revalidateTag(`repo-${repoId}`, 'max');
    revalidatePath('/dashboard');
}

export async function generateRepoSummary(repoId: string): Promise<string> {
  const summarize = async ()=> fetch(`${RAG_URL}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId }),
  });

  let res = await summarize();

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail as string | undefined;

    if (res.status === 400 && detail?.toLowerCase().includes('not ingested')) {
      await triggerRepoIngestion(repoId);
      res = await summarize();
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail ?? 'Unknown error from RAG service.';
    throw new Error(`Summary generation failed: ${detail}`);
  }
    const data = await res.json();
  return data.summary as string;
}

//fetch - requesting rag, not like next.js direct internal request
export async function generateContributorSummary(
  repoId: string,
  contributorLogin: string
): Promise<string> {
  const res = await fetch(`${RAG_URL}/contributor-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, contributor_login: contributorLogin }),
  });
  if (!res.ok) throw new Error('Contributor summary failed.');
  const data = await res.json();

  await prisma.contributor.update({
    where: { repositoryId_githubLogin: { repositoryId: repoId, githubLogin: contributorLogin } },
    data: { summary: data.summary },
  });
  return data.summary as string;
}

export async function generateQuestions(
  repoId: string,
  contributorId: string | null,
  contributorLogin: string,
  chatId: string,
  scope: 'contributor' | 'repository' = 'contributor', 
  //why 'repository' = 'contributor'? doesn't that set contributor 
  // even when repository is selected? no, it's just a default value. 
  // if the caller doesn't provide a value for scope, 
  // it will default to 'contributor'. but if the caller explicitly 
  // sets scope to 'repository', then it will be 'repository'.
  questionType='general'
  // TODO : what is questiontype? we're using features, is that what type means?
): Promise<string[]> {
  const res = await fetch(`${RAG_URL}/generate-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_id: repoId,
      contributor_login: contributorLogin,
      question_type: questionType,
    }), //TODO : latest version should be used. if not up to date, 
    // repo ingestion should happen again.
  });
  if (!res.ok) throw new Error('Question generation failed.');
  const data = await res.json();

  await prisma.generatedQuestion.create({
    data: {
      contributorId,
      repositoryId: repoId,
      chatId,
      scope,
      questions: data.questions,
    },
  });

  return data.questions as string[];
}

export async function getOrCreateChat(
  userId: string,
  repositoryId: string
): Promise<string> {
  let chat = await prisma.chat.findUnique({
    where: { userId_repositoryId: { userId, repositoryId } }, //there's no and operator in prisma, 
    // but we can achieve the same by using a compound unique key in the schema, 
    // which is userId_repositoryId in this case. 
  });

  if (!chat) { 
    chat = await prisma.chat.create({
      data: { userId, repositoryId },
    });
  }

  revalidateTag(`repo-${repositoryId}`, 'max');
  revalidatePath('/dashboard');
  return chat.id;
}

//change - not like simple questions, specific requests, summarize, or question generation etc
export async function sendChatMessage(
  chatId: string,
  repoId: string, 
  question: string
): Promise<string> {
  //later how do we fetch messages in a chat in a sequence? 
  // we can fetch messages by chatId and order them by createdAt timestamp,
  await prisma.message.create({
    data: { chatId, role: 'user', content: question, feature: 'repo_chat' },
  }); //TODO : change feature to actual ones like generate questions.

  const res = await fetch(`${RAG_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, question }),
  });
  if (!res.ok) throw new Error('RAG chat failed.');
// TODO : we should handle the case when the repo is not ingested yet, 
// and trigger ingestion, similar to summary generation.
// ingestion sould happen at first message, not when user adds repo, 
// because they may not want to use chat feature, 
// and ingestion can be resource intensive, so we can delay it until it's actually needed.

  const data = await res.json();

  await prisma.message.create({
    data: { chatId, role: 'assistant', content: data.answer, feature: 'repo_chat' },
  });
  // TODO : message created at should be compared with newest commit, 
  // to allow regeneration of answer when new commits are made, 
  // and updates are done in embeddings

  revalidateTag(`repo-${repoId}`, 'max');
  revalidatePath('/dashboard');
  return data.answer as string;
}

export async function checkAndUpdateRepo(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return;

  const latestSha = await fetchLatestCommitSha(repo.owner, repo.name);
  if (latestSha !== repo.lastCommitSha) {
    await triggerRepoIngestion(repoId);
  }
}

