"use client";

import { useActionState, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { addRepository } from "../../lib/actions";
import { validateGithubUrlFormat } from "@/app/lib/validate";
import { Button } from "@/app/ui/button";
import { AddRepoState } from "@/app/lib/definitions";
import clsx from "clsx";

export default function RepoEvaluatorSection() {
  const initialState: AddRepoState = {};

  // TODO : addRepository should create chat for user, but if repo is not in repo db, it should first insert it in repo table.
  const [state, dispatch, isPending] = useActionState(addRepository, initialState);
  // action state is used when we want to track the state of a server action, such as loading, success, or error states.
  // whereas use server is used to define a server action that can be called from the client side, and it doesn't provide built-in state management for loading or error states.
  // for forms, useActionState can be more convenient as it allows you to easily manage the form submission state and display feedback to the user based on the action's status.

  const [urlInput, setUrlInput] = useState("");
  const [debounced] = useDebounce(urlInput, 400);

  const validation = useMemo(() => {
    const value = debounced.trim();
    if (!value) {
      return {
        status: "idle" as const,
        message: "",
        normalizedURL: undefined as string | undefined,
      };
    }

    const result = validateGithubUrlFormat(value);
    if (result.valid) {
      return {
        status: "valid" as const,
        message: "Repository looks valid.",
        normalizedURL: result.normalizedURL,
      };
    }

    return {
      status: "invalid" as const,
      message: result.error ?? "Invalid repository URL.",
      normalizedURL: undefined as string | undefined,
    };
  }, [debounced]);

  const urlStatus = validation.status;
  const urlMessage = validation.message;
  // TODO : understand what runs when, i.e use effect, set timeout, and cleanup function, and how they work together to achieve the desired behavior of validating the repository URL after user stops typing for 600ms, and providing feedback to user based on the validation result.

  //TODO : check if add repo only adds new repo in repo table
  // or adds repo to users repos?
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-6 shadow-sm shadow-slate-950/30">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Repository URL</h2>
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
          onBlur={() => {
            if (validation.normalizedURL) {
              setUrlInput(validation.normalizedURL);
            }
          }}
          // e automatically is sent to onChange function, and we can get the value from e.target.value, and update the urlInput state, which will trigger the useEffect to validate the url after user stops typing for 600ms.
          //TODO  : why don't we directly connect value to useRef of input value? by ref= ...?
          className="flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        {/* TODO : validateGithubRepoExists should be called n cecked before addrepo so we can show on this page only if repo doesn't exist etc. */}
        <Button
          type="submit"
          disabled={
            (urlInput.trim().length > 0 && urlStatus !== "valid") || isPending
          }
        >
          {isPending ? "Creating chat..." : "Chat with Repo"}
        </Button>
      </form>
      {urlStatus !== "idle" && (
        <p
          className={clsx("mt-2 text-sm", {
            "text-emerald-300": urlStatus === "valid",
            "text-rose-300": urlStatus === "invalid",
          })}
        >
          {urlMessage}
        </p>
      )}

      {/* TODO : use the aria-describedby method to display error*/}
      {/* which errors are shown below? they are the errors from the dispatch server action*/}
      {state.error && (
        <p className="mt-2 text-sm text-rose-300">{state.error}</p>
      )}
    </div>
  );
}
