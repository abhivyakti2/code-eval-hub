"use client";

import { useActionState, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { addRepository } from "@/app/lib/actions";
import { validateGithubUrlFormat } from "@/app/lib/validate";
import { Button } from "@/app/ui/button";
import { AddRepoState } from "@/app/lib/definitions";
import clsx from "clsx";

export default function RepoEvaluatorSection() {
  const initialState: AddRepoState = {};
  const [state, dispatch, isPending] = useActionState(
    addRepository,
    initialState,
  );

  const [urlInput, setUrlInput] = useState("");
  const [debounced] = useDebounce(urlInput, 400);

  const validation = useMemo(() => {
    const value = debounced.trim();
    if (!value)
      return { status: "idle" as const, message: "", normalizedURL: undefined };
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
      normalizedURL: undefined,
    };
  }, [debounced]);

  const { status: urlStatus, message: urlMessage } = validation;

  return (
    <form
      action={dispatch}
      className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-900/40 to-slate-900/40 p-5"
    >
      <label htmlFor="repoUrl" className="text-sm font-medium text-slate-200">
        Repository URL
      </label>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="repoUrl"
          name="github_url"
          type="url"
          placeholder="https://github.com/owner/repo"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onBlur={() => {
            if (validation.normalizedURL) setUrlInput(validation.normalizedURL);
          }}
          className={clsx(
            "flex-1 rounded-md border bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 transition",
            urlStatus === "invalid"
              ? "border-rose-500/50 focus:ring-rose-500"
              : urlStatus === "valid"
                ? "border-emerald-500/40 focus:ring-emerald-500"
                : "border-slate-800 focus:ring-cyan-500",
          )}
        />
        <Button
          type="submit"
          disabled={(urlInput.length > 0 && urlStatus !== "valid") || isPending}
        >
          {isPending ? "Creating chat..." : "Chat with Repo"}
        </Button>
      </div>

      {urlStatus !== "idle" && (
        <p
          className={clsx(
            "mt-2 text-xs",
            urlStatus === "valid" ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {urlMessage}
        </p>
      )}

      {state.error && (
        <p className="mt-3 text-xs text-rose-300">{state.error}</p>
      )}
    </form>
  );
}
