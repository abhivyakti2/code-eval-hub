"use client";

import {
  AtSymbolIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/lib/actions";
import { ForgotPasswordState } from "@/app/lib/definitions";
import { Button } from "@/app/ui/button";

export default function ForgotPasswordForm() {
  const initialState: ForgotPasswordState = { message: null, error: null };
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  const showMessage = !!state?.message || !!state?.error;

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900/80 px-6 pb-4 pt-8 shadow-sm shadow-slate-950/30">
        <h1 className="mb-3 text-2xl text-slate-100">
          Reset your password.
        </h1>
        <p className="mb-5 text-sm text-slate-300">
          Enter your account email and we&apos;ll send you a reset link.
        </p>

        <label
          className="mb-3 mt-5 block text-xs font-medium text-slate-200"
          htmlFor="email"
        >
          Email
        </label>
        <div className="relative">
          <input
            className="peer block w-full rounded-md border border-slate-700 bg-slate-950/70 py-[9px] pl-10 text-sm text-slate-100 outline-2 placeholder:text-slate-500"
            id="email"
            type="email"
            name="email"
            placeholder="Enter your email address"
            required
          />
          <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 peer-focus:text-cyan-300" />
        </div>

        <Button className="mt-4 w-full" disabled={isPending}>
          {isPending ? "Sending..." : "Send reset link"}
          {!isPending && (
            <ArrowRightIcon className="ml-auto h-5 w-5 text-slate-50" />
          )}
        </Button>

        {showMessage && (
          <div className="mt-3 flex items-start gap-2">
            {state?.error ? (
              <ExclamationCircleIcon className="mt-0.5 h-5 w-5 text-red-500" />
            ) : (
              <CheckCircleIcon className="mt-0.5 h-5 w-5 text-emerald-400" />
            )}
            <p
              className={`text-sm ${state?.error ? "text-red-500" : "text-emerald-300"}`}
            >
              {state?.error ?? state?.message}
            </p>
          </div>
        )}

        <div className="mt-4 text-center text-sm">
          <Link
            href="/login"
            className="font-semibold text-cyan-300 hover:text-cyan-200"
          >
            Back to login
          </Link>
        </div>
      </div>
    </form>
  );
}
