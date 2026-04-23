'use server';
//Marks functions in that file as Server Actions
// create API routes without needing to create separate files in the /api directory. 
// but is it better than api directory? for simple actions that are closely tied to a specific page or component, server actions can be more convenient and lead to cleaner code.
// TODO : when to make app/api/chat/route.ts type endpoints instead of server action in lib/actions.ts?
import {revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth, signIn, signOut } from '@/auth';
//auth gives session, what gives token? cookie in browser? and how? when we sign in, next-auth creates a session for the user and sets a cookie in the user's browser that contains a session token. This token is used to identify the user's session on subsequent requests. When the user makes a request to the server, the cookie is sent along with the request, and next-auth uses the token in the cookie to retrieve the session information for that user. This allows next-auth to manage user authentication and maintain session state across different pages and requests without requiring the user to log in again each time.import { AuthError } from 'next-auth';
// cookie automatically sent with each request, but it's checked where? in the authorize method of the credentials provider, we check the credentials and if they are valid, we create a session for the user. The session is stored in the database (or in-memory store) and a cookie with the session token is sent back to the user's browser. On subsequent requests, next-auth checks the cookie for the session token, retrieves the corresponding session from the database, and makes it available in the request context. This is how next-auth manages authentication state across requests.
// TODO : only path of pages is protected by default, so if we want to protect an API route or a server action, we need to check the session in that function and return an error or redirect if the user is not authenticated.
import {prisma} from '@/app/lib/db';
import {
    parseGithubUrl,
    fetchRepoMetadata,
    fetchContributors,
    fetchLatestCommitSha,
} from '@/app/lib/github';
import bcrypt from 'bcrypt';
import { MessageFeature } from '@prisma/client';

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
  }); //why not pass formData directly to safeParse? because safeParse expects an object with specific keys (email, password, confirmPassword), 
  // and formdata is an instance of FormData which doesn't have those keys directly accessible. We need to extract the values from formData and pass them as an object to safeParse.

  if(!validatedFields.success){
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Invalid Fields. Failed to create account.',
    }; //will only missing fields cause error? or invalid ones too?
  }

  const { email, password } = validatedFields.data;
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
      // TODO : also can redirect to login page with message in query params.
    }
    throw error;
  }

  //tags are like labels you stick on cached data. 
  // You add them when caching/fetching data. 
  // Tags are stored in the Next.js Data Cache (server-side)
  // It’s an internal server cache managed by Next.js
  revalidateTag('repositories', 'max');  
  // TODO : need to add more tags here? like user-specific one?
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
  // TODO : can't we return loginstate always? 
  
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
    await signOut({redirectTo: '/login'}); // TODO : no try catch?
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
}; //state and zod schema are different

export type ValidateRepoUrlState = {
  valid: boolean;
  error?: string;
  owner?:string;
  repo?: string;
  normalizedURL?: string;
}
//is creating type bestpractice to do this? 

export async function validatedGithubRepoUrl(rawUrl: string): Promise<ValidateRepoUrlState>{
  const parsed = GithubUrlSchema.safeParse(rawUrl.trim()); //is trim needed here? i think we do it in ui file too?
  if(!parsed.success){
    return{
      valid: false,
      error: parsed.error.errors[0].message,
    };
  }

  try{
    const {owner, repo} = parseGithubUrl(parsed.data);
    await fetchRepoMetadata(owner, repo); //why are we fetching metadata here? isn't validating the url enough?
    //fetching metadata is a way to validate that the repository actually exists on GitHub and is accessible. 
    // A URL might be well-formed but point to a non-existent repository.
    return {
      valid: true,
      owner,
      repo,
      normalizedURL: `https://github.com/${owner}/${repo}`,
    };
  }catch{
    return{
      valid: false,
      error: 'Repository does not exist or is not accessible.',
    }
  }
}

export async function addRepository(prevState: AddRepoState, formData: FormData): Promise<AddRepoState>{
  const session = await auth(); //doesn't auth run when we login? why do we need to run it again here?
  // yes, auth runs when we login and creates a session, but we need to call it here 
  // to access the session data (like user ID) in this server action. 
  // it only creates the session if it doesn't already exist, so if the user is 
  // already logged in, it will just return the existing session without creating a new one.
  
  let userId=(session?.user as {id?: string} | undefined)?.id; 
  //we are asserting that session.user has an id property, but it might not(why not? or is ? due to user not being in session), so we also allow for undefined.

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

  if(!userId) return {error: 'Please login again.'}; // TODO : should we redirect to login page here? or just show message? if we redirect, we can add a message in query params to show on login page.

  // we're already validating the URL in the UI before submitting the form, so we can skip validation here, 
  // but we should still do it to be safe, because users can bypass UI validation, and we shouldn't trust client input.
  // TODO : we can remove validation from UI later, but for now we can keep it there for better user experience, so users get immediate feedback on invalid URLs without needing to submit the form and wait for server response.
  const raw = formData.get('github_url') as string;
  const parsed = GithubUrlSchema.safeParse(raw); // TODO : don't we have validate function for this? we can reuse validatedGithubRepoUrl function here, but that function also checks if repo exists by fetching metadata, which we will do later in this function anyway, so it would be redundant to call it here. we can just validate the URL format here, and then later when we fetch metadata, if the repo doesn't exist, we can handle that error there.
  if(!parsed.success) return { 
    error:parsed.error.errors[0].message, 
    message : 'Invalid Github URL.'
  };

  let createdId: string | undefined;
  let chatId: string | undefined;

  const { owner, repo }= parseGithubUrl(parsed.data); //in github.ts
  try{
    const [meta, latestSha]= await Promise.all([ //array destructuring to get results of both promises in one line.
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]); //get's both results in one array? yes, Promise.all takes an array of promises and returns a new promise that resolves to an array of the resolved values of the input promises. In this case, meta will contain the result of fetchRepoMetadata and latestSha will contain the result of fetchLatestCommitSha once both promises have resolved.
    let existing = await prisma.repository.findUnique({
      where : { githubId: meta.id},
      select: { id: true},
    })
    if(!existing){ // TODO : only add repo if user selects some feature. for existing ones, ho is ui doing ingestion handling?
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
      const contributors = await fetchContributors(owner, repo); // TODO : why do it before any contributor related feature is requested? because we want to have contributors in the database for when user requests contributor summary or questions, and fetching contributors is not very resource intensive, so we can do it upfront when the repo is added, rather than waiting until a contributor-related feature is requested, which could lead to a delay in response time for the user when they request that feature.
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
  redirect(`/dashboard/chat?repoId=${createdId}&chatId=${chatId}&github_url=${encodeURIComponent(parsed.data)}&repo_name=${encodeURIComponent(repo)}`);
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

async function getRepoOwnerName(repoId: string): Promise<{ owner: string; name: string }> {
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true },
  });

  if (!repo) {
    throw new Error('Repository not found.');
  }

  return repo;
}

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

async function askRepoChat(repoId: string, question: string): Promise<string>{
  const call= async ()=>
    fetch(`${RAG_URL}/chat`,{
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({repo_id: repoId, question}),
    });

  let res = await call();

  if (!res.ok){
    const errorBody = await res.json().catch(() => null);
    const detail = String (errorBody?.detail ?? '');

    if (res.status === 400 && detail.toLowerCase().includes('not ingested')) {
      await triggerRepoIngestion(repoId);
      res = await call();
    }
  }

  if (!res.ok){
    const errorBody = await res.json().catch(()=> null);
    throw new Error(`RAG chat failed: ${errorBody?.detail ?? `HTTP ${res.status}`}`)
  }

  const data =await res.json();
  return data.answer as string;
}

export async function sendChatMessageWithFeatures(params :{
  repoId: string;
  chatId: string;
  userText: string;
  selectedFeatures: MessageFeature[];
}) : Promise<string>{
  const { repoId, chatId, userText, selectedFeatures } = params;

  const features = selectedFeatures.length > 0? selectedFeatures : ['repo_chat'] as MessageFeature[]; 

  if(!userText.trim() && features.length === 1 && features[0] === 'repo_chat'){
    throw new Error('Please enter a message for repo chat.');
  } 

  const priorUserMsgCount = await prisma.message.count({
    where:{ chatId, role: 'user'},
  });

  if(priorUserMsgCount ===0) {
    await triggerRepoIngestion(repoId);
  }

  await prisma.message.create({
    data:{
      chatId,
      role: 'user',
      content: userText.trim(),
      features,
    },
  });

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true },
  });
  if(!repo) throw new Error('Repository not found.');

  const contributors = await prisma.contributor.findMany({
    where: { repositoryId: repoId},
    select: { id: true, githubLogin: true, totalCommits: true},
    orderBy: [{totalCommits: 'desc'}, {githubLogin: 'asc'}],
  });

  const blocks: string[]=[];

  if(features.includes('repo_summary')){
    const summary = await generateRepoSummary(repoId);
    blocks.push(`[Repository Summary]\n${summary}`);
  }

  if(features.includes('contributors_summary')){
    if(contributors.length ===0){
      blocks.push('[Contributors Summary]\nNo contributors found.');
    }else{
      const perContributor: string[]=[];
      for (const c of contributors){
        const s = await generateContributorSummary(repoId, c.githubLogin);
        perContributor.push(`@${c.githubLogin}\n${s}`);
      }
      blocks.push(`[Contributors Summary]\n${perContributor.join('\n\n')}`);
    }
  }

  if(features.includes('generate_questions')){
    if(contributors.length ===0){
      blocks.push('[Evaluation Questions]\nNo contributors found.');
    }else{
      const perContributorQuestions: string[]=[];
      for(const c of contributors){
        const questions = await generateQuestions(
          repoId,
          c.id,
          c.githubLogin,
          chatId,
          'contributor',
          'general'
        );
        perContributorQuestions.push(
          `@${c.githubLogin}\n${questions.map((q,i)=> `${i+1}.${q}`).join('\n')}`
        );
      }
      blocks.push(`[Evaluation Questions]\n${perContributorQuestions.join('\n\n')}`);
    }
  }

  if(features.includes('repo_chat')){
    const chatPrompt = userText.trim() || 'Give me a quick overview of the repository.';
    const answer = await askRepoChat(repoId, chatPrompt);
    blocks.push(`[Repository Chat]\n${answer}`);
  }
  const combined = blocks.join('\n\n---------------------------\n\n');
  await prisma.message.create({
    data:{
      chatId,
      role:'assistant',
      content: combined,
      features,
    },
  });

  revalidateTag(`repo-${repoId}`, 'max');
  revalidatePath('/dashboard');
  return combined;
}

export async function generateRepoSummary(repoId: string): Promise<string> {
  // TODO : should only happen when there's new commits, and user clicks on 
  // "Regenerate Summary" button, or when any user first adds the repo, 
  //but not if some user already added the repo and summary is generated, 
  // because summary generation can be resource intensive, so we can avoid 
  // unnecessary generation by only doing it when there are new commits, 
  // and when repo has no stored summary

  //also following check is unnecessary i think :

  const repo=await prisma.repository.findUnique({
    where: { id: repoId},
    select: { owner: true, name:true},
  });

  if(!repo){
    throw new Error('Repository not found.');
  }

  const summarize = async ()=> fetch(`${RAG_URL}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId,
      owner: repo.owner,
      repo_name: repo.name,
     }),
     //why send owner name n reponame? maybe rag service needs it for repo api
  });

  let res = await summarize();

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail as string | undefined;

    // check repo embeddings are there or not and ingest.
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
  const { owner, name } = await getRepoOwnerName(repoId);
  // TODO : we're not fetching diffs of commits by contributor here, so summary is not being generated.
  // TODO : why not send repo owner n name here?
  const res = await fetch(`${RAG_URL}/contributor-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, owner, repo_name: name, contributor_login: contributorLogin }),
  });

  //TODO : here also can't there be chance the repo isn't ingested?
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
    const { owner, name } = await getRepoOwnerName(repoId);

  const res = await fetch(`${RAG_URL}/generate-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_id: repoId,
      owner,
      repo_name: name,
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

