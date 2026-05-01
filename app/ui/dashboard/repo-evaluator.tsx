"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addRepository, validateGithubUrlFormat } from "@/app/lib/actions";
import { Button } from "@/app/ui/button";
import { AddRepoState } from "@/app/lib/definitions";
import clsx from "clsx";

export default function RepoEvaluatorSection() {
  const initialState: AddRepoState = {};

  // TODO : addRepository should create chat for user, but if repo is not in repo db, it should first insert it in repo table.
  const [state, dispatch] = useActionState(addRepository, initialState);
  // action state is used when we want to track the state of a server action, such as loading, success, or error states.
  // whereas use server is used to define a server action that can be called from the client side, and it doesn't provide built-in state management for loading or error states.
  // for forms, useActionState can be more convenient as it allows you to easily manage the form submission state and display feedback to the user based on the action's status.

  const searchParams = useSearchParams();

  //TODO : how can we get these on that page? they will be on chat page not here
  const repoId = state.repoId ?? searchParams.get("repoId") ?? undefined;
  const chatId = state.chatId ?? searchParams.get("chatId") ?? undefined;
  const githubUrl = searchParams.get("github_url") ?? "";
  // these params are set when user clicks on "Chat with Repo" button after entering the github url, and we can also get them from the url when user refreshes the page or shares the link.
  // but if we click chat with repo, we move to chat page, we won't be on this component,
  //  TODO :this component cannot get the params above right?
  // how does chat page get params? above code or addRepo function or something else?

  //TODO : remove unused values
  const repoNameFromParams = searchParams.get("repo_name") ?? undefined;

  const [urlInput, setUrlInput] = useState(githubUrl);
  const [urlStatus, setUrlStatus] = useState<
    "idle" | "checking" | "valid" | "invalid"
  >("idle");
  const [urlMessage, setUrlMessage] = useState("");
  const [validatedRepoName, setValidatedRepoName] = useState("");

  const requestIdRef = useRef(0);
  const isRepoLoaded = !!repoId && !!chatId;

  useEffect(() => {
    if (isRepoLoaded) return; // TODO : but if it's loaded, won't we redirect to chat page? so this component won't be rendered at all, so the check is not needed?

    const value = urlInput.trim();
    if (!value) {
      setUrlStatus("idle");
      setUrlMessage("");
      setValidatedRepoName("");
      return;
    }

    setUrlStatus("checking");
    setUrlMessage("Checking repository...");

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      //async used here, it doesn't cause any issue right?
      //await isn't allowed in non-async function

      let result;
      try {
        result = validateGithubUrlFormat(value);
      } catch {
        //TODO : but we're only matching request reference if there's an error, should we also match it when we get a successful response? what if user types something, then quickly types something else before the first validation returns, and the first validation returns after the second one, it will override the result of the second validation, which is not what we want. so we should also check the request reference when we get a successful response, to make sure we're updating the state based on the latest validation result.
        //we're matching later before updating state too.
        if (requestId !== requestIdRef.current) return;
        setUrlStatus("invalid");
        setUrlMessage(
          "Could not validate repository right now. Please try again.",
        );
        setValidatedRepoName("");
        return;
      }
      // TODO : can wait for actual github call to validate at this point, just format checking here and then validate again when user clicks on chat with repo button, to avoid unnecessary api calls while user is typing and also provide faster feedback to user.

      if (requestId !== requestIdRef.current) return;

      if (result.valid) {
        setUrlStatus("valid");
        setUrlMessage("Repository is valid.");
        setValidatedRepoName(result.repo ?? "");
        if (result.normalizedURL && result.normalizedURL !== value) {
          //TODO : this won't work if we only do format checking here, because actual github call will not be made then
          //Not useful anyways
          setUrlInput(result.normalizedURL);
        }
      } else {
        setUrlStatus("invalid");
        setUrlMessage(result.error ?? "Invalid repository URL.");
        setValidatedRepoName("");
      }
    }, 600); // TODO : set timeout to avoid making api call on every keystroke, only validate after user stops typing for 600ms, but this also means if user types something and then deletes it, the message will still show "checking repository" until 600ms later, is that ok? or should we immediately set it back to idle when input is empty? I think it's better to immediately set it back to idle when input is empty, to provide faster feedback to user and avoid confusion.
    // TODO : this is like use debounced value, but implemented manually here because we also want to track the status of the validation and show messages to user, which useDebouncedValue doesn't provide out of the box.
    // TODO : but can't we write this logic using use debounced library too? what's the difference?

    return () => clearTimeout(timer);
    // it's finally called when component unmounts or before the next effect runs, so it will clear the previous timer when user types a new character before 600ms, to avoid multiple api calls and only validate the final input after user stops typing for 600ms.
  }, [urlInput, isRepoLoaded]);
  // TODO : understand what runs when, i.e use effect, set timeout, and cleanup function, and how they work together to achieve the desired behavior of validating the repository URL after user stops typing for 600ms, and providing feedback to user based on the validation result.

  //TODO : check if add repo only adds new repo in repo table
  // or adds repo to users repos?
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Repository URL</h2>
      <form action={dispatch} className="flex gap-2">
        <input
          // TODO : id not needed? why was it used in signin forms? for accessibility? but we don't have labels here, so maybe not needed, or we can use aria-label instead?
          type="url"
          name="github_url"
          placeholder="https://github.com/owner/repo"
          required
          value={urlInput}
          aria-label="GitHub repository URL"
          onChange={(e) => setUrlInput(e.target.value)}
          // e automatically is sent to onChange function, and we can get the value from e.target.value, and update the urlInput state, which will trigger the useEffect to validate the url after user stops typing for 600ms.
          //TODO  : why don't we directly connect value to useRef of input value? by ref= ...?
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {/* TODO : validateGithubRepoExists should be called n cecked before addrepo so we can show on this page only if repo doesn't exist etc. */}
        <Button
          type="submit"
          disabled={
            urlStatus === "checking" ||
            (urlInput.trim().length > 0 && urlStatus !== "valid")
          }
        >
          Chat with Repo
        </Button>
      </form>
      {urlStatus !== "idle" && (
        <p
          className={clsx("mt-2 text-sm", {
            "text-green-600": urlStatus === "valid",
            "text-red-500": urlStatus === "invalid",
            "text-gray-500": urlStatus === "checking",
          })}
        >
          {urlMessage}
        </p>
      )}

      {/* TODO : use the aria-describedby method to display error*/}
      {/* which errors are shown below? they are the errors from the dispatch server action*/}
      {state.error && (
        <p className="mt-2 text-sm text-red-500">{state.error}</p>
      )}
    </div>
  );
}
