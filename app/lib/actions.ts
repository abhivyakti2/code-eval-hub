"use server";
//Marks functions in that file as Server Actions. You still need "use server" to mark a function as: callable from the client (via forms, useActionState, etc.)
// without it normal server-side function. It can only be used: inside other server code.

// create API routes without needing to create separate files in the /api directory.
// but is it better than api directory? for simple actions that are closely tied to a specific page or component, server actions can be more convenient and lead to cleaner code. No api calls needed, just direct function calls. But for more complex logic, or when you want to reuse the same logic across multiple pages or components, it might be better to create API routes in the /api directory. It really depends on the specific use case and how you want to organize your code.

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, signIn, signOut } from "@/auth";
//auth gives session, what gives token? cookie in browser? and how? when we sign in, next-auth creates a session for the user and sets a cookie in the user's browser that contains a session token. This token is used to identify the user's session on subsequent requests. When the user makes a request to the server, the cookie is sent along with the request, and next-auth uses the token in the cookie to retrieve the session information for that user. This allows next-auth to manage user authentication and maintain session state across different pages and requests without requiring the user to log in again each time.
// cookie automatically sent with each request, but it's checked where? for sign in it happens in the authorize method of the credentials provider, On subsequent requests, next-auth checks the cookie for the session token, retrieves the corresponding session from the database, and makes it available in the request context. This is how next-auth manages authentication state across requests.
// server actions check the session by calling auth() function, which retrieves the session based on the cookie sent with the request. If the session is valid, it will return the session data, including user information. If the session is not valid or has expired, it will return null, and we can handle that case accordingly (e.g., by returning an error message or redirecting to the login page).
// only path of pages is protected by default, so if we want to protect an API route or a server action, we need to check the session in that function and return an error or redirect if the user is not authenticated.

import { prisma } from "@/app/lib/db";
import {
  parseGithubUrl,
  fetchRepoMetadata,
  fetchContributors,
  fetchLatestCommitSha,
} from "@/app/lib/github";
import bcrypt from "bcrypt";
import { AuthError } from "next-auth";
import { MessageFeature } from "@prisma/client";
import { SignUpState, LoginState, ValidateRepoUrlState, AddRepoState } from "./definitions";
import { triggerRepoIngestion, generateQuestions, generateRepoSummary, generateContributorSummary, askRepoChat } from "./rag-client";
//is it needed to import MessageFeature type here? yes, because we are using it in the sendChatMessageWithFeatures function to type the features of a message. It helps ensure that we are only using valid features that are defined in our Prisma schema, and it provides better type safety and autocompletion in our code editor when working with message features. and since we're just using type not data, security is not a concern here.
// don’t use import type for Prisma enums because they are real runtime values, not just types.



const SignUpSchema = z
  .object({
    email: z.string().email({ message: "Please enter a valid email." }),
    password: z
      .string()
      .min(6, { message: "Password must be at least 6 characters." }),
    confirmPassword: z
      .string()
      .min(6, { message: "Please confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const LoginSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email." }),
  password: z.string().min(1, { message: "Password is required." }),
});
//these messages are sent only when there's a corresponding error,
// so we can be specific with them, and they will be displayed in the UI

export async function register(prevState: SignUpState, formData: FormData) {
  const validatedFields = SignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  }); //why not pass formData directly to safeParse? because safeParse expects an object with specific keys (email, password, confirmPassword),
  // and formdata is an instance of FormData which doesn't have those keys directly accessible. We need to extract the values from formData and pass them as an object to safeParse.

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Invalid Fields. Failed to create account.",
    }; // will only missing fields cause error? or invalid ones too?
  }

  const { email, password } = validatedFields.data;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return {
      errors: { email: ["Email already in use."] },
      message: "Failed to create account.",
    };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, password: hashedPassword },
    });
  } catch (error) {
    return {
      message: "Database error: Failed to create account.",
    };
  }

  try {
    await signIn("credentials", formData);
    //formData also contains confirmPassword, but it will be ignored by the
    // credentials provider(we defined the authorize method), so it won't cause any issue.
  } catch (error) {
    if (error instanceof AuthError) {
        redirect("/login?error=account_created_login_failed");
    }
    throw error;
  }

  //tags are like labels you stick on cached data.
  // You add them when caching/fetching data.
  // Tags are stored in the Next.js Data Cache (server-side)
  // It’s an internal server cache managed by Next.js
  revalidateTag("repositories", "max");
  // TODO : need to add more tags here? like user-specific one?
  //why repositories? because after sign up, user will be redirected to dashboard,
  // and we want to make sure the repositories list is up to date,
  // even though it should be empty for a new user. It's a precaution to
  // ensure the UI reflects the current state of the database after authentication.

  // 'max' : stale-while-revalidate behavior means that when we revalidate a tag,
  // the existing cached data with that tag can still be served to users
  // while the new data is being fetched and cached.

  revalidatePath("/dashboard"); // we want to revalidate the dashboard path to ensure that any cached version of the dashboard page is updated with the new authentication state, so that when the user is redirected there, they see the correct content based on their logged-in status.
  redirect("/dashboard");
}

export async function authenticate(
  prevState: LoginState | void,
  formData: FormData,
): Promise<LoginState> {
  //void needed because return is inconsistent.
  // we return LoginState when there's an error, and nothing when it's successful,
  // so we need to allow for both possibilities in the return type
  // else useActionState will complain about type mismatch.
  //why didn't we do it in register? because in register, we always return SignUpState, even if it's successful, we return a message.

  const validatedFields = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Invalid email or password format.",
    };
  }

  try {
    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { message: error.message ?? "Invalid credentials." };
        default:
          return { message: "Something went wrong." };
      }
    }
    throw error;
  }
  //no revalidation needed here because after login, user will be redirected to dashboard,
  // and the dashboard page will fetch fresh data from the database, so we don't need to worry about stale cache in this case.
return {}; // unreachable — NextAuth redirects
// On success NextAuth throws an internal redirect (not returned), so TypeScript's reachability analysis is fine if you add return {} at the end of the happy path (it won't be reached)
}

// TODO : this isn't a server action, move non server actions to separate file and import to use in server action. or move down to this file's end.
export async function logout() {
  await signOut({ redirectTo: "/login" }); // signOut throws a redirect internally and does not need a try/catch. 
}

const GithubUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url), {
    message: "Must be a valid Github repository URL.",
  });
//each operator in the regex is explained as follows:
// ^https:\/\/github\.com\/ : ensures the URL starts with "https://github.com/"
// [^/]+ : matches one or more characters that are not a slash, representing the owner of the repository
// \/ : matches a literal slash, separating the owner and repository name
// [^/]+ : matches one or more characters that are not a slash, representing the repository name
// we can also allow for optional .git at the end, and optional trailing slash, by adding (?:\.git)?(?:\/|$) at the end of the regex.


// Fast, client-callable: checks format only
export function validateGithubUrlFormat(raw: string): ValidateRepoUrlState {
  const parsed = GithubUrlSchema.safeParse(raw.trim());
  if (!parsed.success)
    return { valid: false, error: parsed.error.errors[0].message };
  const { owner, repo } = parseGithubUrl(parsed.data);
  return { valid: true, owner, repo, normalizedURL: `https://github.com/${owner}/${repo}` };
}

// Slower, server-side: also verifies the repo exists on GitHub
export async function validateGithubRepoExists(
  owner: string,
  repo: string,
): Promise<{ exists: boolean; error?: string }> {
  try {
    await fetchRepoMetadata(owner, repo);
    return { exists: true };
  } catch {
    return { exists: false, error: "Repository does not exist or is not accessible." };
  }
}

// TODO: we don't need to add the contributors if repo isn't in repo table and user has just clicked chat.
export async function addRepository(
  prevState: AddRepoState,
  formData: FormData,
): Promise<AddRepoState> {
  const session = await auth(); //doesn't auth run when we login? why do we need to run it again here?
  // yes, auth runs when we login and creates a session, but we need to call it here
  // to access the session data (like user ID) in this server action so we can add the repo in user's repositories.
  // it only creates the session if it doesn't already exist, so if the user is
  // already logged in, it will just return the existing session without creating a new one.

  let userId = (session?.user as { id?: string } | undefined)?.id;
  //we are asserting that session.user has an id property, but it might not(why not? due to user not being logged in), so we also allow for undefined.

  //TODO : restore url entered by user before following line.
  if (!userId) redirect("/login");

  //TODO : but if user was not logged in, the user would have been redirected to login page when trying to access the dashboard, so ideally we shouldn't even reach this point without a valid user ID.
  // TODO : should we redirect to login page here? or just show message? if we redirect, we can add a message in query params to show on login page.

  // we're already validating the URL in the UI before submitting the form, so we can skip validation here,
  // but we should still do it to be safe, because users can bypass UI validation, and we shouldn't trust client input.
  // TODO : we can remove full validation from UI later. or use parseGithubUrl function in UI to just check url structure.
  const raw = formData.get("github_url") as string;
  const parsed = GithubUrlSchema.safeParse(raw);
  if (!parsed.success)
    return {
      error: parsed.error.errors[0].message,
      message: "Invalid Github URL.",
    };

  let createdId: string | undefined;
  let chatId: string | undefined;

  const { owner, repo } = parseGithubUrl(parsed.data);
  //TODO : we're not doing actual github validation, just taking out owner from url, do fetchMetadata or some other check here.
  //in github.ts
  try {
    const [meta, latestSha] = await Promise.all([
      //latestSha is used for set lastCommitSha on the new Repository row so the staleness checks work on first chat open. This is correct — keep it.
      //array destructuring to get results of both promises in one line.
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]); //get's both results in one array? yes, Promise.all takes an array of promises and returns a new promise that resolves to an array of the resolved values of the input promises. In this case, meta will contain the result of fetchRepoMetadata and latestSha will contain the result of fetchLatestCommitSha once both promises have resolved.

    let existing = await prisma.repository.findUnique({
      where: { githubId: meta.id },
      select: { id: true },
    });

    if (!existing) {
      // TODO : for existing repos, how is ui doing ingestion handling?
      const created = await prisma.repository.create({
        data: {
          githubId: meta.id,
          githubUrl: parsed.data,
          owner,
          name: repo,
          description: meta.description ?? null,
          lastCommitSha: latestSha,
        },
        select: { id: true },
      });

      const contributors = await fetchContributors(owner, repo);
      // TODO : let it be fetched when we need it. not altogether here.

      await prisma.contributor.createMany({
        data: contributors.map((c) => ({
          repositoryId: created.id,
          githubLogin: c.login,
          avatarUrl: c.avatar_url,
          totalCommits: c.contributions,
        })),
        skipDuplicates: true,
      });
      existing = created;
    }
    createdId = existing.id;
    chatId = await getOrCreateChat(userId, createdId);
  } catch (error) {
    console.error(error);
    return { error: "Failed to add repository from Github." };
    // TODO : can be something else. there's s many await used in try.
  }
  revalidateTag("repositories", "max");
  revalidateTag(`repo-${createdId}`, "max");
  revalidatePath("/dashboard"); //happens for all users? even if only one creates a new chat?
  // yes, because the dashboard is server-rendered and the cache is shared across users.
  redirect(
    `/dashboard/chat?repoId=${createdId}&chatId=${chatId}&github_url=${encodeURIComponent(parsed.data)}&repo_name=${encodeURIComponent(repo)}`,
  );
  // Keeping the githubURL in params lets the sidenav chat history links be self-contained and lets the page handle deep links.
}

export async function deleteRepository(id: string) {
  // TODO : should return message in case of error. is it showing error now?
  // because of the transaction, if any of the operations fail,
  // it will throw an error and not complete the transaction, so it won't delete the repository or the chats.
  // We should catch that error and return a message to the user.

  const session = await auth();
  let userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) redirect("/login");
// restore state n delete repo after authentication? but we only want current user's chats to be deleted, not every user that chatted with this repo

  await prisma.$transaction(async (tx) => {
    await tx.chat.deleteMany({
      // TODO : why delete many? we only want to delete chat of a user,
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

  revalidateTag("repositories", "max");
  revalidateTag(`repo-${id}`, "max");
  revalidatePath("/dashboard");
}

// TODO : BELOW ARE NOT SERVER ACTIONS, helpers etc i think. move to separate file if needed, or place at the end of this file to separate from main server actions.


export async function sendChatMessageWithFeatures(params: {
  repoId: string;
  chatId: string;
  userText: string;
  selectedFeatures: MessageFeature[];
  // TODO : modify to send prompt specific to the selected actions individually
}): Promise<string> {
  const { repoId, chatId, userText, selectedFeatures } = params;

  const features =
    selectedFeatures.length > 0
      ? selectedFeatures
      : (["repo_chat"] as MessageFeature[]);

  // TODO : put this in chaining above before adding repo chat feature? but user text is checked in ui already right? but we should also check here to be safe, because users can bypass UI validation, and we shouldn't trust client input. We want to make sure that if the user has selected only the repo_chat feature, they must provide some text to ask to the repo chat, otherwise it doesn't make sense to send an empty message with just the repo_chat feature. For other features, we might allow an empty user text if it still triggers some meaningful response (like generating questions based on contributors), but for repo_chat specifically, we should require some user input to ask a question or give a prompt to the chat.
  if (
    !userText.trim() &&
    features.length === 1 &&
    features[0] === "repo_chat"
  ) {
    throw new Error("Please enter a message for repo chat.");
  }

  const priorUserMsgCount = await prisma.message.count({
    where: { chatId, role: "user" },
  });

  // TODO : can we trigger ingestion when sending message? check if repo is ingested or not, if not, trigger it and then send message, so that user doesn't have to wait for ingestion to complete and then send message again. but if we trigger ingestion here, we need to make sure that the message is sent only after ingestion is complete, because otherwise the chat response might not be accurate if the repo data is not yet available for the RAG service. So we can trigger ingestion here if needed, and then wait for it to complete before proceeding to send the message and get the chat response.
  // TODO : like check latestsha while sending each message, and if not present, also check ingestion, and if not up to date show on ui option to chat with latest sha, then ingest again. and otherwise on first message, ingest latest sha if not already most recent ingestion.
  // TODO : or is it possible when user clicks chat with repo in repo evaluator itself, while chat is created, ingestion also starts in parallel, not like in sync, while chat page is created n rendered n user writes first message, tlll then in background the ingestion can take place.
  // TODO : but should we go for ingesting contributor commits, or repo code, or both? because for some features like generating questions based on contributors, we might only need contributor data to be ingested, and for repo chat, we might need the code embeddings to be ingested. so we can have more granular ingestion that only ingests the necessary data based on the features selected by the user, which can save time and resources compared to ingesting everything at once.
  if (priorUserMsgCount === 0) {
    await triggerRepoIngestion(repoId);
  }

  await prisma.message.create({
    data: {
      chatId,
      role: "user",
      content: userText.trim(),
      features,
    },
  });

  const repoForSha = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastCommitSha: true },
  });
  if (repoForSha?.lastCommitSha) {
    await prisma.chat.update({
      where: { id: chatId },
      data: { lastChatSha: repoForSha.lastCommitSha },
    });
  }
  // TODO : SHOW UI NOTIFICATION LIKE DATE ETC ABOUT REPO WAS UPDATED AT THIS POINT

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true },
  });

  if (!repo) throw new Error("Repository not found.");

  // TODO : since we can remove adding contributors at add repo time, we should check if contributors are present in db or not, if not then fetch from github and add to db, and then fetch from db to generate questions, so that we can ensure that we have the latest contributor data in our database before generating questions based on it. This way, if there have been new contributors or changes in contributions since the repo was added, we can reflect that in the generated questions without having to wait for a separate process to add contributors to the database.
  // TODO : although since project main aim is to show contributor specific summaries, and give specific questions for contibutors, i guess we can do it early
  // TODO : but get below info if there is some contributor specific feature selected. AND FOR NORMAL CHAT MESSAGES TOO IN UI SHOW OPTION TO SELECT CONTRIBUTOR RELATED QUESTION OR REPO RELATED QUESTION SO WE CAN USE SPECIFIC DATA. SOME AUTO SELECT BASED ON USER'S PROMPT? PLUS MANUAL SELECTION OVERWRITE?
  const contributors = await prisma.contributor.findMany({
    where: { repositoryId: repoId },
    select: { id: true, githubLogin: true, totalCommits: true },
    orderBy: [{ totalCommits: "desc" }, { githubLogin: "asc" }],
  });

  const blocks: string[] = []; // all features response array, we will join them with separator and store as one message in db, and also return the combined response to show in UI. we can also use this array to show different features response in different sections in UI if needed, by keeping track of which block corresponds to which feature.

  if (features.includes("generate_questions")) {
    if (contributors.length === 0) {
      blocks.push("[Evaluation Questions]\nNo contributors found.");
    } else {
      // In actions.ts — replace the per-contributor loop
const questionsByContrib = await generateQuestionsForAllContributors( //TODO : create function n call batch-contributor-questions endpoint
  repoId,
  contributors.map((c) => ({ id: c.id, login: c.githubLogin })),
  chatId,
);
      blocks.push(
        `[Evaluation Questions]\n${questionsByContrib.join("\n\n")}`,
      );
    }
  }

  // TODO : will need to change this when we attach individual prompt for evaluation question feature, and repo chat prompt.
  if (features.includes("repo_chat")) {
    const chatPrompt =
      userText.trim() || "Give me a quick overview of the repository.";
    const answer = await askRepoChat(repoId, chatPrompt);
    blocks.push(`[Repository Chat]\n${answer}`);
  }
  // TODO : error handling for responses from RAG needed?

  const combined = blocks.join("\n\n---------------------------\n\n");
  await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content: combined,
      features,
    },
  });
  //TODO : error handling for db write?

  revalidateTag(`repo-${repoId}`, "max");
  revalidatePath("/dashboard");
  return combined;
  //WE SHOW RESPONSE IN UI THROUGH THE RETURNED DATA. WHEN OPENING OLDER CHAT WE FETCH MESSAGES FROM DB, SO THE ASSISTANT MESSAGE WITH COMBINED RESPONSE WILL BE SHOWN IN UI. WHEN SENDING NEW MESSAGE, THE NEW ASSISTANT MESSAGE WITH COMBINED RESPONSE WILL BE APPENDED TO CHAT IN UI.
}

// TODO : combine generatereposummary and keep a check of latest sha.
export async function generateAndStoreRepoSummary(
  repoId: string,
  currentSha: string,
): Promise<string> {
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { lastSummarySha: true },
  });
  if (repo?.lastSummarySha === currentSha) {
    const stored = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { repoSummary: true },
    });
    return stored?.repoSummary ?? "";
  }
  const summary = await generateRepoSummary(repoId);
  //TODO : error handling for summary generation? because if it fails, we don't want to update the repo summary in db, and we want to show an error message to the user. We can catch any errors thrown by generateRepoSummary and handle them accordingly, maybe by logging the error and returning a default message or rethrowing the error to be handled by the caller.
  await prisma.repository.update({
    where: { id: repoId },
    data: { repoSummary: summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, "max");
  return summary;
}



//TODO : like above we should also combine below function with generateContributorSummary into one function. check latesh sha outdated, only then or no summary, only then generate n store. else return stored summary, because it will be latest one
// TODO : we can send all contributors together to RAG service to generate summaries for all of them in one go, instead of making separate requests for each contributor, which can improve performance and reduce latency, especially for repositories with many contributors. We can send an array of contributors in a single request and get back a structured response with summaries for each contributor, which can also help us maintain the association between contributors and their summaries more easily.
export async function generateAndStoreContribSummary(
  repoId: string,
  contributorLogin: string,
  currentSha: string,
): Promise<string> {
  const summary = await generateContributorSummary(repoId, contributorLogin);
  await prisma.contributor.update({
    where: {
      repositoryId_githubLogin: {
        repositoryId: repoId,
        githubLogin: contributorLogin,
      },
    },
    data: { summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, "max");
  return summary; // todo : error handling for summary generation and db update?
}


export async function getOrCreateChat(
  userId: string,
  repositoryId: string,
): Promise<string> {
  let chat = await prisma.chat.findUnique({
    where: { userId_repositoryId: { userId, repositoryId } }, //there's no and operator in prisma,
    // but we can achieve the same by using a compound unique key in the schema,
    // which is userId_repositoryId in this case.
  });

  if (!chat) {
    chat = await prisma.chat.create({
      data: { userId, repositoryId },
    });// ToDO : error handling for chat creation? because if it fails, we should handle that gracefully and maybe log the error, but we might still want to return a message indicating that the chat could not be created, depending on how critical it is to have the chat created for the user. We can catch any errors thrown by the prisma.chat.create call and decide how to handle them based on our application's needs.
  }

  revalidateTag(`repo-${repositoryId}`, "max");
  revalidatePath("/dashboard");
  return chat.id;
}



//TODO : where do we use this function? and is there similar one for contributor ingestion?
export async function checkAndUpdateRepo(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return;

  const latestSha = await fetchLatestCommitSha(repo.owner, repo.name);
  if (latestSha !== repo.lastCommitSha) {
    await triggerRepoIngestion(repoId);
  }
}

export async function fetchCurrentGithubSha(
  owner: string,
  repoName: string,
): Promise<string> {
  return fetchLatestCommitSha(owner, repoName);
  // TODO : do we need this function? or can we directly use fetchLatestCommitSha wherever we need to check the latest sha? we can remove this function if it's not adding any additional logic or abstraction, and just use fetchLatestCommitSha directly in our codebase to get the latest commit SHA when needed.
}

//we can do it in same function which has steps to check the shas differ
export async function updateChatViewedSha(
  chatId: string,
  sha: string,
): Promise<void> {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastViewedSummarySha: sha },
  });
}

// TODO : need to correctly link contributor related messages with this sha. and repo one w/ repo. and the selection of contributor vs repo we will provide in input message needs to be cleanly used for this
// TODO : we can update sha in same place we check sha difference. and contributor sha need not be stored for each contributor. one for all contributors because we ingest it at same time. ensure the ingestion was successful before updating sha
export async function updateContribViewedSha(
  chatId: string,
  contributorId: string,
  sha: string,
): Promise<void> {
  await prisma.chatContribViewedSha.upsert({
    where: { chatId_contributorId: { chatId, contributorId } },
    create: { chatId, contributorId, viewedSha: sha },
    update: { viewedSha: sha },
  });
}

// TODO : instead of calling each contributor question generation separately, we can have a single function that takes an array of contributors and generates questions for all of them in one go, which can reduce the number of API calls to the RAG service and improve performance. We can modify the generateQuestions function to accept an array of contributors and return a structured response with questions for each contributor, and then we can call this modified function from our server action when we need to generate questions for multiple contributors at once.
export async function generateAndStoreAllContribSummaries(
  repoId: string,
  currentSha: string,
): Promise<Record<string, string>> {
  const contributors = await prisma.contributor.findMany({
    where: { repositoryId: repoId },
    select: { githubLogin: true },
    orderBy: [{ totalCommits: "desc" }, { githubLogin: "asc" }],
  });

  const out: Record<string, string> = {};
  // Record<string, string> is a TypeScript utility type that defines an object type with string keys and string values. In this case, it's used to create an object where the keys are the GitHub login names of the contributors and the values are their corresponding summaries. By using Record<string, string>, we can ensure that the out object has a consistent structure where all keys and values are strings, which can help with type safety and code readability when we populate this object with contributor summaries.

  //TODO : we can send all contributors together to RAG service to generate summaries for all of them in one go, instead of making separate requests for each contributor, which can improve performance and reduce latency, especially for repositories with many contributors. We can send an array of contributors in a single request and get back a structured response with summaries for each contributor, which can also help us maintain the association between contributors and their summaries more easily. and also we can modify the RAG service to accept multiple contributors and return summaries for all of them in one response.
  for (const c of contributors) {
    const summary = await generateContributorSummary(repoId, c.githubLogin); // TODO : error handling for summary generation? because if it fails for one contributor, we might want to continue generating summaries for the other contributors instead of stopping the entire process. We can catch any errors thrown by generateContributorSummary for each contributor and decide how to handle them based on our application's needs, such as logging the error and maybe setting a default summary for that contributor in the out object.
    await prisma.contributor.update({
      where: {
        repositoryId_githubLogin: {
          repositoryId: repoId,
          githubLogin: c.githubLogin,
        },
      },
      data: { summary, lastSummarySha: currentSha },
    });
    out[c.githubLogin] = summary;
  } // TODO : error handling for db update? because if it fails for one contributor, we might want to continue updating summaries for the other contributors instead of stopping the entire process. We can catch any errors thrown by the prisma.contributor.update call for each contributor and decide how to handle them based on our application's needs, such as logging the error and maybe continuing with the next contributor without updating the summary for the one that failed.

  revalidateTag(`repo-${repoId}`, "max");
  return out; 
}

// TODO : where is this called? and can it be incorporated in the logic where we ingest new sha code itself? instead of separate function?
export async function updateChatViewedContribSummarySha(
  chatId: string,
  sha: string,
): Promise<void> {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastViewedContribSummarySha: sha },
  });
}


// "use server" = “Expose this function as an endpoint”
// Without it:
// Function is private to server code
// With it:
// Function becomes callable across client → server boundary


// When to make app/api/chat/route.ts type endpoints instead of server action in lib/actions.ts?
// Rule of thumb:
// Server Actions — form submissions, mutations called from a React component, simple one-off calls tightly coupled to a page.
// API Routes — anything consumed by a third party, webhooks, streaming endpoints (ReadableStream), or when you need full control over the HTTP response (headers, status codes).
// For this project everything is internal, so keeping server actions is correct.


// revalidateTag vs revalidatePath
// revalidatePath("/dashboard") — busts the full-route cache for that path segment. Use it when multiple users share the same rendered output.
// revalidateTag("repositories") — busts only cache entries labelled with that tag. Prefer this; it's more granular.
// Use revalidatePath sparingly (only on actions that affect shared/global state) and rely on revalidateTag for per-user or per-resource data.
