"use client";

import { useActionState } from "react";
import { addRepository } from "@/app/lib/actions";
import { AddRepoState } from "@/app/lib/definitions";

const DEMO_REPO_URL = "https://github.com/abhivyakti2/CtrlPlusDesign"; // replace with your pre-ingested repo

export default function DemoBanner() {
  const initialState: AddRepoState = {};
  const [state, dispatch, isPending] = useActionState(
    addRepository,
    initialState,
  );

  return (
    <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-slate-400">
      <p className="mb-2">
        <span className="text-cyan-300 font-large">🚀 Here for the demo?</span>{" "}
        Embedding new repositories can be slow on the free tier. Try this
        pre-ingested repo for an instant experience:
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <form action={dispatch}>
          <input type="hidden" name="github_url" value={DEMO_REPO_URL} />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Creating chat..." : "Try Demo Repo →"}
          </button>
        </form>
        <span className="font-mono text-slate-300">{DEMO_REPO_URL}</span>
        
      </div>
      {state?.error && <p className="mt-2 text-rose-300">{state.error}</p>}
    </div>
  );
}
