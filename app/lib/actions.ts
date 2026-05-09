"use server";
//Marks functions in that file as Server Actions. You still need "use server" to mark a function as: callable from the client (via forms, useActionState, etc.)
// without it normal server-side function. It can only be used: inside other server code.

// create API routes without needing to create separate files in the /api directory.
// but is it better than api directory? for simple actions that are closely tied to a specific page or component, server actions can be more convenient and lead to cleaner code. No api calls needed, just direct function calls. But for more complex logic, or when you want to reuse the same logic across multiple pages or components, it might be better to create API routes in the /api directory. It really depends on the specific use case and how you want to organize your code.

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError } from "next-auth";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { MessageFeature } from "@prisma/client";

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
import { fetchRepoOwnerName, fetchRepoLastCommitSha } from "@/app/lib/data";
import {
  triggerRepoIngestion,
  generateQuestions,
  generateRepoSummary,
  generateContributorSummary,
  askRepoChat,
} from "./rag-client";
import { SignUpState, LoginState, AddRepoState } from "./definitions";

type RepoMeta = { owner: string; name: string };

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function toUserFriendlyErrorMessage(rawMessage: string, fallback: string): string {
  const message = rawMessage.toLowerCase();

  if (
    message.includes("can't reach database server") ||
    message.includes("prismaclientinitializationerror") ||
    message.includes("database")
  ) {
    return "Database is temporarily unavailable. Please try again in a moment.";
  }

  if (message.includes("rate limit") || message.includes("http 429")) {
    return "Service is currently busy. Please wait a moment and try again.";
  }

  if (message.includes("not ingested")) {
    return "Repository data is still being prepared. Please try again in a moment.";
  }

  if (message.includes("repository not found")) {
    return "Repository could not be found. Please refresh and try again.";
  }

  return fallback;
}

async function ensureContributorsLoaded(repoId: string, repo: RepoMeta) {
  const count = await prisma.contributor.count({ where: { repositoryId: repoId } });
  if (count > 0) return;

  const contributors = await fetchContributors(repo.owner, repo.name);
  await prisma.contributor.createMany({
    data: contributors.map((contributor) => ({
      repositoryId: repoId,
      githubLogin: contributor.login,
      avatarUrl: contributor.avatar_url,
      totalCommits: contributor.contributions,
    })),
    skipDuplicates: true,
  });
}

const SignUpSchema = z
  .object({
    email: z.string().email({ message: "Please enter a valid email." }),
    password: z.string().min(6, { message: "Password must be at least 6 characters." }),
    confirmPassword: z.string().min(6, { message: "Please confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const LoginSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email." }),
  password: z.string().min(1, { message: "Password is required." }),
});

const GithubUrlSchema = z
  .string()
  .trim()
  .url({ message: "Please enter a valid URL." })
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.hostname !== "github.com") return false;
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length >= 2;
    } catch {
      return false;
    }
  }, { message: "Please enter a valid Github repository URL." });
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
    await prisma.user.create({ data: { email, password: hashedPassword } });
  } catch {
    return { message: "Database error: Failed to create account." };
  }

  try {
    await signIn("credentials", formData);
    //formData also contains confirmPassword, but it will be ignored by the
    // credentials provider(we defined the authorize method), so it won't cause any issue.
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=account_created_login_failed");
      // We redirect to login with a query param instead of returning an error message because the user is actually created successfully, but signIn can fail due to various reasons (e.g. session issues) that we don't want to surface as "Failed to create account."
      //this error is handled in the login page to show a message like "Account created successfully, please log in."
    }
    throw error;
  }

  //tags are like labels you stick on cached data.
  // You add them when caching/fetching data.
  // Tags are stored in the Next.js Data Cache (server-side)
  // It’s an internal server cache managed by Next.js
  revalidateTag("repositories", "max");
  redirect("/dashboard");
}

export async function authenticate(
  prevState: LoginState | void,
  formData: FormData,
): Promise<LoginState> {
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
          //TODO : error message will be technical, we should show a generic message to the user, but log the technical message for debugging
        default:
          return { message: "Something went wrong." };
      }
    }
    throw error;
  }

  return {};
}

export async function logout() {
  try {
    await signOut({ redirectTo: "/login" });
  } catch (error) {
    console.error("logout: signOut failed", error);
    // TODO : but without signout how will new session be created? won't login redirect back to dashboard because session still exists? we should probably clear session cookie manually here to ensure user is logged out even if signOut fails
    redirect("/login");
  }
}

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

export async function addRepository(
  prevState: AddRepoState,
  formData: FormData,
): Promise<AddRepoState> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const raw = formData.get("github_url") as string;
  const parsed = GithubUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0].message,
      message: "Invalid Github URL.",
    };
  }

  const { owner, repo } = parseGithubUrl(parsed.data);

  try {
    const [meta, latestSha] = await Promise.all([
      fetchRepoMetadata(owner, repo),
      fetchLatestCommitSha(owner, repo),
    ]);

    const existing = await prisma.repository.findUnique({
      where: { githubId: meta.id },
      select: { id: true },
    });

    const repositoryId =
      existing?.id ??
      (await prisma.repository.create({
        data: {
          githubId: meta.id,
          githubUrl: parsed.data,
          owner,
          name: repo,
          description: meta.description ?? null,
          lastCommitSha: latestSha,
        },
        select: { id: true },
      })).id;

    const chatId = await getOrCreateChat(userId, repositoryId);

    void triggerRepoIngestion(repositoryId).catch((error) => {
      console.error("Background ingestion failed:", error);
    });

    revalidateTag("repositories", "max");
    revalidateTag(`user-${userId}-repositories`, "max");
    revalidateTag(`repo-${repositoryId}`, "max");

    redirect(
      `/dashboard/chat?repoId=${repositoryId}&chatId=${chatId}&github_url=${encodeURIComponent(parsed.data)}&repo_name=${encodeURIComponent(repo)}`,
    );
  } catch (error) {
    console.error(error);
    return { error: "Failed to add repository from Github." };
  }
}

export async function deleteRepository(id: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login"); 

  await prisma.$transaction(async (tx) => {
    await tx.chat.deleteMany({
      where: { userId, repositoryId: id },
    });

    const stillLinked = await tx.chat.count({ where: { repositoryId: id } });
    if (stillLinked === 0) {
      await tx.repository.delete({ where: { id } });
    }
  });

  revalidateTag("repositories", "max");
  revalidateTag(`user-${userId}-repositories`, "max");
  revalidateTag(`repo-${id}`, "max");
}

export async function sendChatMessageWithFeatures(params: {
  repoId: string;
  chatId: string;
  userText: string;
  selectedFeatures: MessageFeature[];
}): Promise<string> {
  const { repoId, chatId, userText, selectedFeatures } = params;
  const features = selectedFeatures.length > 0 ? selectedFeatures : (["repo_chat"] as MessageFeature[]);

  if (!userText.trim() && features.length === 1 && features[0] === "repo_chat") {
    throw new Error("Please enter a message for repo chat.");
  }

  try {
    const [priorUserMsgCount, repo] = await Promise.all([
      prisma.message.count({ where: { chatId, role: "user" } }),
      fetchRepoOwnerName(repoId),
    ]);

    if (priorUserMsgCount === 0) {
      void triggerRepoIngestion(repoId).catch((error) => {
        console.error("Background ingestion failed:", error);
      });
    }

    const lastCommitShaPromise = fetchRepoLastCommitSha(repoId);
    const contributorLoadPromise = ensureContributorsLoaded(repoId, repo);

    await prisma.message.create({
      data: {
        chatId,
        role: "user",
        content: userText.trim(),
        features,
      },
    });

    const lastCommitSha = await lastCommitShaPromise;
    if (lastCommitSha) {
      // what is happening here? and are we updating last sha without repo ingestion of newer commits? 
      await prisma.chat.update({
        where: { id: chatId },
        data: { lastChatSha: lastCommitSha },
      });
    }

    await contributorLoadPromise;

    const contributors = await prisma.contributor.findMany({
      where: { repositoryId: repoId },
      select: { id: true, githubLogin: true, totalCommits: true },
      orderBy: [{ totalCommits: "desc" }, { githubLogin: "asc" }],
    });

    const blocks: string[] = [];

    if (features.includes("generate_questions")) {
      if (contributors.length === 0) {
        blocks.push("[Evaluation Questions]\nNo contributors found.");
      } else {
        const questionsByContrib = await Promise.all(
          contributors.map(async (contributor) => {
            const questions = await generateQuestions(
              repoId,
              contributor.id,
              contributor.githubLogin,
              chatId,
              "contributor",
              "general",
              repo,
            );
            return `@${contributor.githubLogin}\n- ${questions.join("\n- ")}`;
          }),
        );
        blocks.push(`[Evaluation Questions]\n${questionsByContrib.join("\n\n")}`);
      }
    }

    if (features.includes("repo_chat")) {
      const chatPrompt = userText.trim() || "Give me a quick overview of the repository.";
      const answer = await askRepoChat(repoId, chatPrompt);
      blocks.push(`[Repository Chat]\n${answer}`);
    }

    const combined = blocks.join("\n\n---------------------------\n\n");
    await prisma.message.create({
      data: {
        chatId,
        role: "assistant",
        content: combined,
        features,
      },
    });

    revalidateTag(`repo-${repoId}`, "max");
    revalidateTag(`chat-${chatId}`, "max");
    return combined;
    // TODOS : revalidate tags can also cause error, they should not be in try catch, outside instead, separate from the actual message creation and fetching logic, otherwise any error in revalidation will cause the whole action to fail and user won't see the message created successfully, which is not ideal, we should log revalidation errors but not throw them
  } catch (error) {
    console.error("sendChatMessageWithFeatures failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(message, "Failed to send message. Please try again."),
    );
  }
}

export async function generateAndStoreRepoSummary(
  repoId: string,
  currentSha: string,
): Promise<string> {
  try {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { lastSummarySha: true, repoSummary: true },
    });

    if (repo?.lastSummarySha === currentSha) {
      return repo.repoSummary ?? "";
      // TODO : handle case where repoSummary is null but lastSummarySha matches currentSha, this can happen if summary generation failed previously, we should probably trigger a regeneration in this case instead of returning empty summary
    }

    const summary = await generateRepoSummary(repoId);
    await prisma.repository.update({
      where: { id: repoId },
      data: { repoSummary: summary, lastSummarySha: currentSha },
    });
    revalidateTag(`repo-${repoId}`, "max");
    return summary;
  } catch (error) {
    console.error("generateAndStoreRepoSummary failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(
        message,
        "Failed to generate repository summary. Please try again.",
      ),
    );
  }
}

export async function generateAndStoreContribSummary(
  repoId: string,
  contributorLogin: string,
  currentSha: string,
): Promise<string> {
  try {
    const repo = await fetchRepoOwnerName(repoId);
    await ensureContributorsLoaded(repoId, repo);

    const summary = await generateContributorSummary(repoId, contributorLogin, repo);
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
    return summary;
  } catch (error) {
    console.error("generateAndStoreContribSummary failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(
        message,
        "Failed to generate contributor summary. Please try again.",
      ),
    );
  }
}

export async function getOrCreateChat(
  userId: string,
  repositoryId: string,
): Promise<string> {
  let chat = await prisma.chat.findUnique({
    where: { userId_repositoryId: { userId, repositoryId } },
  });

  if (!chat) {
    chat = await prisma.chat.create({ data: { userId, repositoryId } });
  }

  revalidateTag(`repo-${repositoryId}`, "max");
  revalidateTag(`chat-${chat.id}`, "max");
  return chat.id;
}

export async function checkAndUpdateRepo(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return;

  const latestSha = await fetchLatestCommitSha(repo.owner, repo.name);
  if (latestSha !== repo.lastCommitSha) {
    await triggerRepoIngestion(repoId);
    revalidateTag(`repo-${repoId}`, "max");
  }
}

export async function fetchCurrentGithubSha(
  owner: string,
  repoName: string,
): Promise<string> {
  return fetchLatestCommitSha(owner, repoName);
}

export async function triggerRepoIngestionAction(repoId: string): Promise<void> {
  try {
    await triggerRepoIngestion(repoId);
    revalidateTag(`repo-${repoId}`, "max");
  } catch (error) {
    console.error("triggerRepoIngestionAction failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(
        message,
        "Failed to ingest repository right now. Please try again.",
      ),
    );
  }
}

export async function generateRepoSummaryAction(repoId: string): Promise<string> {
  try {
    return await generateRepoSummary(repoId);
  } catch (error) {
    console.error("generateRepoSummaryAction failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(
        message,
        "Failed to generate repository summary. Please try again.",
      ),
    );
  }
}

export async function updateChatViewedSha(
  chatId: string,
  sha: string,
): Promise<void> {
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastViewedSummarySha: sha },
  });
}

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

export async function generateAndStoreAllContribSummaries(
  repoId: string,
  currentSha: string,
): Promise<Record<string, string>> {
  try {
    const repo = await fetchRepoOwnerName(repoId);
    await ensureContributorsLoaded(repoId, repo);

    const contributors = await prisma.contributor.findMany({
      where: { repositoryId: repoId },
      select: { githubLogin: true },
      orderBy: [{ totalCommits: "desc" }, { githubLogin: "asc" }],
    });

    const results = await Promise.all(
      contributors.map(async (contributor) => {
        const summary = await generateContributorSummary(repoId, contributor.githubLogin, repo);
        await prisma.contributor.update({
          where: {
            repositoryId_githubLogin: {
              repositoryId: repoId,
              githubLogin: contributor.githubLogin,
            },
          },
          data: { summary, lastSummarySha: currentSha },
        });
        return [contributor.githubLogin, summary] as const;
      }),
    );

    const out: Record<string, string> = Object.fromEntries(results);
    revalidateTag(`repo-${repoId}`, "max");
    return out;
  } catch (error) {
    console.error("generateAndStoreAllContribSummaries failed:", error);
    const message = toErrorMessage(error);
    throw new Error(
      toUserFriendlyErrorMessage(
        message,
        "Failed to generate contributor summaries. Please try again.",
      ),
    );
  }
}

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
