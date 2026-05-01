import { revalidateTag, revalidatePath } from "next/cache";
import { prisma } from "./db";

const RAG_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";

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

    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);
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

export async function askRepoChat(repoId: string, question: string): Promise<string> {
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
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);
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
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);    throw new Error(
      `RAG chat failed: ${detail}`,
    );
  }

  const data = await res.json();
  return data.answer as string;
  //what's different between as string n typecasting to string? both are ways to tell TypeScript that we expect data.answer to be a string, but they have different implications. Using "as string" is a type assertion that tells TypeScript to treat data.answer as a string without performing any runtime checks, so if data.answer is not actually a string at runtime, it could lead to unexpected behavior or errors. On the other hand, using typecasting (e.g., String(data.answer)) would convert data.answer to a string at runtime, which can help prevent errors if data.answer is not already a string, but it may also lead to unintended consequences if data.answer is an object or array that gets converted to a string like "[object Object]" or "1,2,3". In this case, since we expect the RAG service to return a string answer, using "as string" is appropriate as long as we are confident in the response format from the RAG service.
  // TODO : If we want to be extra cautious, we could add a runtime check to ensure that data.answer is indeed a string before returning it.
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
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`); // TODO : again here different typecasting, make uniform. and also check if detail is present or not before using it, because if it's not present, we don't want to end up with a message that says "Summary generation failed: undefined",BUT WE'RE PUTTING A DEFAULT VALUE IF IT'S NOT THERE
    throw new Error(`Summary generation failed: ${detail}`);
  }

  const data = await res.json(); // TODO : error handling for json parsing? because if the response is not valid JSON, it will throw an error. We can catch that error and handle it gracefully, maybe by logging the error and returning a default message or rethrowing the error to be handled by the caller.
  return data.summary as string;
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
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);
    throw new Error(`Contributor summary failed: ${detail}`);} // TODO : keep error handling consistent of rest functions
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

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);
    throw new Error(`Question generation failed: ${detail}`);
  }
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
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const detail = String(errorBody?.detail ?? `HTTP ${res.status}`);
    throw new Error(`RAG chat failed: ${detail}`);
  }
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