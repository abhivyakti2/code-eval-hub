"use server";
//Marks functions in that file as Server Actions. You still need "use server" to mark a function as: callable from the client (via forms, useActionState, etc.)
// without it normal server-side function. It can only be used: inside other server code.

// create API routes without needing to create separate files in the /api directory.
// but is it better than api directory? for simple actions that are closely tied to a specific page or component, server actions can be more convenient and lead to cleaner code. No api calls needed, just direct function calls. But for more complex logic, or when you want to reuse the same logic across multiple pages or components, it might be better to create API routes in the /api directory. It really depends on the specific use case and how you want to organize your code.
// TODO : when to make app/api/chat/route.ts type endpoints instead of server action in lib/actions.ts?

import { revalidatePath, revalidateTag } from "next/cache";
// TODO : understand revalidation later, when to use tag vs path, and how it works with caching.
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
//is it needed to import MessageFeature type here? yes, because we are using it in the sendChatMessageWithFeatures function to type the features of a message. It helps ensure that we are only using valid features that are defined in our Prisma schema, and it provides better type safety and autocompletion in our code editor when working with message features. and since we're just using type not data, security is not a concern here.
// don’t use import type for Prisma enums because they are real runtime values, not just types.

export type SignUpState = {
  errors?: {
    //shape matches the result of zod's flatten method, which organizes errors by field
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
  message?: string | null;
};

export type LoginState = {
  errors?: {
    email?: string[];
    password?: string[];
  };
  message?: string | null;
};

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

const CreateUser = SignUpSchema; //TODO : why not just use SignUpSchema directly in register function?

export async function register(prevState: SignUpState, formData: FormData) {
  const validatedFields = CreateUser.safeParse({
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
      return {
        message: "Account created, but failed to log in. Please log in.",
      };
      // TODO : also can redirect to login page with message in query params.
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
): Promise<LoginState | void> {
  //void needed because return is inconsistent.
  // we return LoginState when there's an error, and nothing when it's successful,
  // so we need to allow for both possibilities in the return type
  // else useActionState will complain about type mismatch.
  //why didn't we do it in register? because in register, we always return SignUpState, even if it's successful, we return a message.
  // TODO : can't we return loginstate always?

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
          return { message: "Invalid credentials." };
        default:
          return { message: "Something went wrong." };
      }
    }
    throw error;
  }
  //no revalidation needed here because after login, user will be redirected to dashboard,
  // and the dashboard page will fetch fresh data from the database, so we don't need to worry about stale cache in this case.
  // TODO : doesn't same happen for sign up? and in sign up too we don't always return state, so why void for login and not for sign up?
}

// TODO : this isn't a server action, move non server actions to separate file and import to use in server action. or move down to this file's end.
export async function logout() {
  await signOut({ redirectTo: "/login" }); // TODO : no try catch?
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

// TODO : move state types to separate file? since they are used in both server actions and UI components. or keep them here since they are closely related to the actions?
export type AddRepoState = {
  error?: string | null;
  repoId?: string;
  chatId?: string;
  message?: string | null;
};
// error will be about url validation or database error, message will be more general, like "Failed to add repository." or "Repository added successfully." We can use message to show success messages as well, not just error messages.

export type ValidateRepoUrlState = {
  valid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  normalizedURL?: string;
}; //state and zod schema are different
//is creating type bestpractice to do this?

export async function validatedGithubRepoUrl(
  rawUrl: string,
): Promise<ValidateRepoUrlState> {
  const parsed = GithubUrlSchema.safeParse(rawUrl.trim()); //TODO : is trim needed here? i think we do it in ui file too?
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.errors[0].message,
    };
  }
  //TODO : only url structure can be checked to show immediate error feedback in UI, if structure okay, no need to show anything like valid, or valdating while checking structure
  try {
    const { owner, repo } = parseGithubUrl(parsed.data);
    await fetchRepoMetadata(owner, repo); //why are we fetching metadata here? isn't validating the url enough?
    //fetching metadata is a way to validate that the repository actually exists on GitHub and is accessible.
    // A URL might be well-formed but point to a non-existent repository.
    // TODO : apart from metadata anything else can verify repo exists?
    return {
      valid: true,
      owner,
      repo,
      normalizedURL: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    //catches error thrown by fetchRepoMetadata when the repository doesn't exist or is not accessible, and returns a validation error message in that case.
    return {
      valid: false,
      error: "Repository does not exist or is not accessible.",
    };
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

  if (!userId) {
    // why we try to get it from the database using the email?
    // because in some cases, especially with certain authentication providers or configurations,
    // the session object might not include the user ID directly.
    //TODO: but if auth doesn't give user, it means user isn't authenticated no? but in that case request should have lead to login page.
    // However, it often includes the user's email, which we can use to look up
    // the user in our database and retrieve their ID. This is a fallback mechanism
    // to ensure we can still identify the user even if the session doesn't have the ID for some reason.
    // TODO : but we are not putting email in token right? so it can't be in session. VERIFY
    //TODO: check if this is needed for the provider i'm using.
    const email = session?.user?.email;
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      userId = user?.id;
    }
  }

  if (!userId) return { error: "Please login again." };
  //TODO : but if user was not logged in, the user would have been redirected to login page when trying to access the dashboard, so ideally we shouldn't even reach this point without a valid user ID.
  // TODO : should we redirect to login page here? or just show message? if we redirect, we can add a message in query params to show on login page.

  // we're already validating the URL in the UI before submitting the form, so we can skip validation here,
  // but we should still do it to be safe, because users can bypass UI validation, and we shouldn't trust client input.
  // TODO : we can remove full validation from UI later. or use parseGithubUrl function in UI to just check url structure.
  const raw = formData.get("github_url") as string;
  const parsed = GithubUrlSchema.safeParse(raw);
  // TODO : change validatedGithubRepoUrl function to only check url structure and call it in UI, and then here just do the fetchRepoMetadata to check if repo exists, so we can give faster feedback in UI about url structure, and only when structure is correct, we do the more expensive check to see if repo actually exists.
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
      //array destructuring to get results of both promises in one line.
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]); //get's both results in one array? yes, Promise.all takes an array of promises and returns a new promise that resolves to an array of the resolved values of the input promises. In this case, meta will contain the result of fetchRepoMetadata and latestSha will contain the result of fetchLatestCommitSha once both promises have resolved.

    let existing = await prisma.repository.findUnique({
      where: { githubId: meta.id },
      select: { id: true },
    });
    //TODO : why do we need commitsha at this point? can leave it till actual message/chat related to repo happens, because summary generation and other features that depend on commit sha will only be triggered when user interacts with the repo in some way, so we can fetch latest commit sha at that point instead of doing it upfront when adding the repo, which can save some unnecessary API calls to GitHub if user just wants to add the repo but not interact with it right away.

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
  //TODO : we don't need repourl in search params, githubid could be better right?
}

export async function deleteRepository(id: string) {
  // TODO : should return message in case of error. is it showing error now?
  // because of the transaction, if any of the operations fail,
  // it will throw an error and not complete the transaction, so it won't delete the repository or the chats.
  // We should catch that error and return a message to the user.

  const session = await auth();
  let userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    // TODO: this can be made a middleware since it's repeated in multiple functions. SAME CONCERNS AS IN ADD REPO REGARDING THIS THING
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
const RAG_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";

// TODO : why are we using it? when repo already is in db? in that case while checking if repo exists in db, can't we fetch this info there only?
async function getRepoOwnerName(
  repoId: string,
): Promise<{ owner: string; name: string }> {
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true },
  });

  if (!repo) {
    throw new Error("Repository not found.");
  }

  return repo;
}

export async function triggerRepoIngestion(repoId: string) {
  // TODO : should only happen if not ingested or when there's new commits,
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw new Error("Repository not found");
  //TODO : where are we putting repo in table before ingestion? in addrepository?
  // TODO : check if latest sha is already ingested here itself. or in add repo.

  const res = await fetch(`${RAG_URL}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_id: repoId,
      owner: repo.owner,
      repo_name: repo.name,
      last_sha: repo.lastCommitSha,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    //we are trying to parse the error response body as JSON,
    // but if the response is not valid JSON
    // (for example, if the server returns an HTML error page),
    // it will throw an error. By catching that error and returning null,
    // we can avoid crashing our application and handle the error more gracefully.
    // TODO : but if the response is not json, how will we get the error message to show to user? we won't be able to show specific error message from server, but at least we can show a generic error message that something went wrong with the ingestion, instead of the application crashing or showing an unhandled error.

    const detail = errorBody?.detail ?? `HTTP ${res.status}`;
    //if errorBody is null or doesn't have a detail property, we use the HTTP status code as the detail message.
    // This ensures that we always have some information about the error to include in our thrown error message.
    // status code is always present in the response, so we will at least have that information to indicate what went wrong, even if we can't get a specific error message from the server.

    throw new Error(`RAG ingestion failed: ${detail}`);
  }

  const data = await res.json();
  await prisma.repository.update({
    where: { id: repoId },
    data: { lastCommitSha: data.latest_sha },
  });

  revalidateTag(`repo-${repoId}`, "max");
  revalidatePath("/dashboard");
}

async function askRepoChat(repoId: string, question: string): Promise<string> {
  // TODO : why not use await directly here? because we might need to call it again if the first call fails due to the repo not being ingested, so we define it as a separate function that we can call multiple times if needed. If we used await directly here, we would have to duplicate the fetch logic in both the initial call and the retry call, which would be less clean and more error-prone. By defining it as a separate function, we can keep our code DRY (Don't Repeat Yourself) and easier to maintain.
  const call = async () =>
    fetch(`${RAG_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_id: repoId, question }),
    });
  // TODO : understand why? arrow funcition used because we want to define a function that we can call multiple times, and it allows us to keep the fetch logic in one place without having to duplicate it for the retry case. It also makes the code cleaner and more organized by encapsulating the fetch logic in a separate function that can be easily called whenever we need to ask a question to the repo chat.

  let res = await call();

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = String(errorBody?.detail ?? "");
    // why specially typecast to string here? because detail can be of any type (string, object, array, etc.) depending on how the server formats its error responses, and we want to ensure that we can safely call toLowerCase() on it without risking a runtime error if it's not a string. By casting it to a string, we can handle cases where detail might be undefined or not a string, and it will just become 'undefined' or '[object Object]' as a string, which won't cause our application to crash when we try to call toLowerCase() on it.
    // TODO : use typecasting in trigger ingestion too if it's correct.

    if (res.status === 400 && detail.toLowerCase().includes("not ingested")) {
      // 400 Bad Request status code indicates that the server cannot process the request due to a client error, and in this case, the error message indicates that the repository has not been ingested yet. This is a specific scenario where we can attempt to trigger the ingestion process and then retry the chat request, as the lack of ingestion is likely the reason for the failure of the initial chat request.
      // TODO:check ingestion state before triggering ingestion? or in ingestion we can check.
      await triggerRepoIngestion(repoId);
      res = await call();
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(
      `RAG chat failed: ${errorBody?.detail ?? `HTTP ${res.status}`}`,
    );
  }

  const data = await res.json();
  return data.answer as string;
  //what's different between as string n typecasting to string? both are ways to tell TypeScript that we expect data.answer to be a string, but they have different implications. Using "as string" is a type assertion that tells TypeScript to treat data.answer as a string without performing any runtime checks, so if data.answer is not actually a string at runtime, it could lead to unexpected behavior or errors. On the other hand, using typecasting (e.g., String(data.answer)) would convert data.answer to a string at runtime, which can help prevent errors if data.answer is not already a string, but it may also lead to unintended consequences if data.answer is an object or array that gets converted to a string like "[object Object]" or "1,2,3". In this case, since we expect the RAG service to return a string answer, using "as string" is appropriate as long as we are confident in the response format from the RAG service.
  // TODO : If we want to be extra cautious, we could add a runtime check to ensure that data.answer is indeed a string before returning it.
}

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
      const perContributorQuestions: string[] = []; // contributor questions array
      for (const c of contributors) {
        // TODO : SEND REQUEST PER CONTRIBUTOR? IS IT BETTER TO SEND TOGETHER? because if we send together, we can reduce the number of API calls to the RAG service, which can improve performance and reduce latency. We can send an array of contributors in a single request and get back a structured response with questions for each contributor, instead of making separate requests for each contributor, which can add up and cause delays, especially for repositories with many contributors. By sending them together, we can also take advantage of any optimizations the RAG service might have for handling batch requests.
        const questions = await generateQuestions(
          repoId,
          c.id,
          c.githubLogin,
          chatId,
          "contributor",
          "general",
        );
        // TODO : WHY NEED CHATID? and remove type of question 'general' etc.
        perContributorQuestions.push(
          `@${c.githubLogin}\n${questions.map((q, i) => `${i + 1}.${q}`).join("\n")}`,
        );
      }
      blocks.push(
        `[Evaluation Questions]\n${perContributorQuestions.join("\n\n")}`,
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
  const summary = await generateRepoSummary(repoId);
  //TODO : error handling for summary generation? because if it fails, we don't want to update the repo summary in db, and we want to show an error message to the user. We can catch any errors thrown by generateRepoSummary and handle them accordingly, maybe by logging the error and returning a default message or rethrowing the error to be handled by the caller.
  await prisma.repository.update({
    where: { id: repoId },
    data: { repoSummary: summary, lastSummarySha: currentSha },
  });
  revalidateTag(`repo-${repoId}`, "max");
  return summary;
}

export async function generateRepoSummary(repoId: string): Promise<string> {
  // TODO : should only happen when there's new commits, and user clicks on
  // "Regenerate Summary" button, or when any user first adds the repo,
  // but not if some user already added the repo and summary is generated,
  // because summary generation can be resource intensive, so we can avoid
  // unnecessary generation by only doing it when there are new commits,
  // and when repo has no stored summary

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { owner: true, name: true },
  });

  if (!repo) {
    throw new Error("Repository not found.");
  }

  const summarize = async () =>
    fetch(`${RAG_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo_id: repoId,
        owner: repo.owner,
        repo_name: repo.name,
      }),
      // why send owner name n reponame? maybe rag service needs it for repo api, and we're not sharing db to rag, it only has bucket
    });

  let res = await summarize(); 

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail as string | undefined;  
    // TODO : inconsistent with other typecasting or doing as string. all need to be uniform.

    // check repo embeddings are there or not and ingest.
    if (res.status === 400 && detail?.toLowerCase().includes("not ingested")) {
      // TODO : check commitsha, if latest then no need to ingest. but carefully only update reposummarysha/ latest sha only after successful ingestions 
      await triggerRepoIngestion(repoId);
      res = await summarize();
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail ?? "Unknown error from RAG service."; // TODO : again here different typecasting, make uniform. and also check if detail is present or not before using it, because if it's not present, we don't want to end up with a message that says "Summary generation failed: undefined",BUT WE'RE PUTTING A DEFAULT VALUE IF IT'S NOT THERE
    throw new Error(`Summary generation failed: ${detail}`);
  }

  const data = await res.json(); // TODO : error handling for json parsing? because if the response is not valid JSON, it will throw an error. We can catch that error and handle it gracefully, maybe by logging the error and returning a default message or rethrowing the error to be handled by the caller.
  return data.summary as string;
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

//fetch - requesting rag, not like next.js direct internal request
export async function generateContributorSummary(
  repoId: string,
  contributorLogin: string,
): Promise<string> {
  const { owner, name } = await getRepoOwnerName(repoId); // TODO : can't we send owner n name from caller itself since we are already fetching it in generate and store function, instead of fetching it again here? we can modify the generateAndStoreContribSummary function to fetch the owner and name, and then pass them as parameters to this function to avoid redundant database queries and improve performance.
  
  const res = await fetch(`${RAG_URL}/contributor-summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_id: repoId,
      owner,
      repo_name: name,
      contributor_login: contributorLogin,
    }),
  });

  //TODO : here also can't there be chance the repo isn't ingested? check first n ingest first then generate summary, similar to what we did in repo summary generation? because if the contributor data is not ingested, the RAG service might return an error indicating that it cannot generate a summary for the contributor, so we should check for that specific error message and trigger ingestion if needed before retrying the summary generation request.
  if (!res.ok) throw new Error("Contributor summary failed."); // TODO : keep error handling consistent of rest functions
  const data = await res.json();

  await prisma.contributor.update({
    where: {
      repositoryId_githubLogin: {
        repositoryId: repoId,
        githubLogin: contributorLogin,
      },
    },
    data: { summary: data.summary },
  }); // TODO : error handling for db update? because if the update fails, we should handle that gracefully and maybe log the error, but we might still want to return the generated summary even if we fail to store it in the database, depending on how critical it is to have the summary stored. We can catch any errors thrown by the prisma.contributor.update call and decide how to handle them based on our application's needs.
  return data.summary as string;
}

//TODO : again we can send all contributors together to RAG service to generate questions for all of them in one go, instead of making separate requests for each contributor, which can improve performance and reduce latency, especially for repositories with many contributors. We can send an array of contributors in a single request and get back a structured response with questions for each contributor, which can also help us maintain the association between contributors and their questions more easily. and also we can modify the RAG service to accept multiple contributors and return questions for all of them in one response.
export async function generateQuestions(
  repoId: string,
  contributorId: string | null,
  contributorLogin: string,
  chatId: string,  // TODo : this is for storing? but doesn't message get stored in other function? and we need to remove generated questions model later right? because we can just store the generated questions as a message with specific feature, and then we can also show it in chat if needed, instead of having a separate model for generated questions. we can differentiate it in messages table by using the features column to indicate that it's a generated question message, and we can also include metadata in the content or another column if needed to associate it with a specific contributor or repository.
  scope: "contributor" | "repository" = "contributor",
  //why 'repository' = 'contributor'? doesn't that set contributor
  // even when repository is selected? no, it's just a default value.
  // if the caller doesn't provide a value for scope,
  // it will default to 'contributor'. but if the caller explicitly
  // TODO : sets scope to 'repository', then it will be 'repository'.
  questionType = "general",
  // TODO : what is questiontype? we're using features, so we can remove questiontype from db
): Promise<string[]> {
  const { owner, name } = await getRepoOwnerName(repoId); // TODO : again here, we can pass owner and name from caller function to avoid redundant db query, since we already have that info in generateAndStoreContribSummary function. we can modify the generateAndStoreContribSummary function to fetch the owner and name, and then pass them as parameters to this function to improve performance by reducing unnecessary database queries.

  const res = await fetch(`${RAG_URL}/generate-questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_id: repoId,
      owner,
      repo_name: name,
      contributor_login: contributorLogin,
      question_type: questionType, 
    }), //TODO : latest version should be used. if not up to date,
    // repo ingestion should happen again.
  });

  if (!res.ok) throw new Error("Question generation failed.");
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
// TODO : error handling for db write? because if it fails, we should handle that gracefully and maybe log the error, but we might still want to return the generated questions even if we fail to store them in the database, depending on how critical it is to have the questions stored. We can catch any errors thrown by the prisma.generatedQuestion.create call and decide how to handle them based on our application's needs.
  return data.questions as string[];
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

//change - not like simple questions, specific requests, summarize, or question generation etc
// TODO : is this being used? or is sendchat message with features being used? we can remove this if we're using the other one, or we can modify the other one to handle both simple chat messages and feature-specific messages by checking the features array and acting accordingly, which can help us consolidate our chat message handling logic into a single function instead of having separate functions for different types of messages.
export async function sendChatMessage(
  chatId: string,
  repoId: string,
  question: string,
): Promise<string> {
  //later how do we fetch messages in a chat in a sequence?
  // we can fetch messages by chatId and order them by createdAt timestamp,
  await prisma.message.create({
    data: { chatId, role: "user", content: question, features: ["repo_chat"] },
  }); //TODO : error handling for db write? because if it fails, we should handle that gracefully and maybe log the error, but we might still want to return a message indicating that the user's message could not be sent, depending on how critical it is to have the message stored in the database. We can catch any errors thrown by the prisma.message.create call and decide how to handle them based on our application's needs.

  const res = await fetch(`${RAG_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_id: repoId, question }),
  });
  if (!res.ok) throw new Error("RAG chat failed.");
  // TODO : we should handle the case when the repo is not ingested yet,
  // and trigger ingestion, similar to summary generation.
  // ingestion sould happen at first message, not when user adds repo,
  // because they may not want to use chat feature,
  // and ingestion can be resource intensive, so we can delay it until it's actually needed.

  const data = await res.json();

  await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content: data.answer,
      features: ["repo_chat"],
    },
  }); // TODO : error handling for db write? because if it fails, we should handle that gracefully and maybe log the error, but we might still want to return the chat response to the user even if we fail to store it in the database, depending on how critical it is to have the assistant's response stored. We can catch any errors thrown by the prisma.message.create call and decide how to handle them based on our application's needs.

  revalidateTag(`repo-${repoId}`, "max");
  revalidatePath("/dashboard");
  return data.answer as string;
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
