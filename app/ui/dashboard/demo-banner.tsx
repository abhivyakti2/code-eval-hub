"use client";

import { useActionState } from "react";
import { addRepository } from "@/app/lib/actions";
import { AddRepoState } from "@/app/lib/definitions";

const DEMO_REPO_URL = "https://github.com/abhivyakti2/CtrlPlusDesign";

export default function DemoBanner() {
  const initialState: AddRepoState = {};
  const [state, dispatch, isPending] = useActionState(
    addRepository,
    initialState,
  );

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-900/40 to-slate-900/40 p-5">
      <p className="text-sm text-slate-200">
        <span className="font-semibold text-cyan-300">
          🚀 Here for the demo?
        </span>{" "}
        <span className="text-slate-400">
          Embedding new repositories can be slow. Try this pre-ingested repo for
          an instant experience:
        </span>
      </p>

      <form
        action={dispatch}
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input type="hidden" name="github_url" value={DEMO_REPO_URL} />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
        >
          {isPending ? "Creating chat..." : "Try Demo Repo →"}
        </button>
        <code className="truncate rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
          {DEMO_REPO_URL}
        </code>
      </form>

      {state?.error && (
        <p className="mt-3 text-xs text-rose-400">{state.error}</p>
      )}
    </div>
  );
}
