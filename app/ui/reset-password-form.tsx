"use client";

import {
  ExclamationCircleIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { resetPassword } from "@/app/lib/actions";
import { ResetPasswordState } from "@/app/lib/definitions";
import { lusitana } from "@/app/ui/fonts";
import { Button } from "@/app/ui/button";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const initialState: ResetPasswordState = { message: null, error: null, errors: {} };
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [state, formAction, isPending] = useActionState(
    resetPassword,
    initialState,
  );

  const passwordErrors = fieldErrors.password ?? state?.errors?.password;
  const confirmPasswordErrors =
    fieldErrors.confirmPassword ?? state?.errors?.confirmPassword;
  const showMessage = !!state?.message || !!state?.error;

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900/80 px-6 pb-4 pt-8 shadow-sm shadow-slate-950/30">
        <h1 className={`${lusitana.className} mb-3 text-2xl text-slate-100`}>
          Choose a new password.
        </h1>
        <input type="hidden" name="token" value={token} />

        <div>
          <label
            className="mb-3 mt-5 block text-xs font-medium text-slate-200"
            htmlFor="password"
          >
            Password
          </label>
          <div className="relative">
            <input
              className="peer block w-full rounded-md border border-slate-700 bg-slate-950/70 py-[9px] pl-10 text-sm text-slate-100 outline-2 placeholder:text-slate-500"
              id="password"
              type="password"
              name="password"
              placeholder="Enter password (min 6 characters)"
              required
              minLength={6}
              aria-describedby="password-error"
              onChange={() => {
                setFieldErrors((prev) => ({ ...prev, password: [] }));
              }}
            />
            <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 peer-focus:text-cyan-300" />
          </div>
          <div id="password-error" aria-live="polite" aria-atomic="true">
            {passwordErrors?.map((error: string) => (
              <p className="text-sm text-red-500" key={error}>
                {error}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label
            className="mb-3 mt-5 block text-xs font-medium text-slate-200"
            htmlFor="confirmPassword"
          >
            Confirm Password
          </label>
          <div className="relative">
            <input
              className="peer block w-full rounded-md border border-slate-700 bg-slate-950/70 py-[9px] pl-10 text-sm text-slate-100 outline-2 placeholder:text-slate-500"
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              placeholder="Confirm your password"
              required
              minLength={6}
              aria-describedby="confirmPassword-error"
              onChange={() => {
                setFieldErrors((prev) => ({ ...prev, confirmPassword: [] }));
              }}
            />
            <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 peer-focus:text-cyan-300" />
          </div>
          <div
            id="confirmPassword-error"
            aria-live="polite"
            aria-atomic="true"
          >
            {confirmPasswordErrors?.map((error: string) => (
              <p className="text-sm text-red-500" key={error}>
                {error}
              </p>
            ))}
          </div>
        </div>

        <Button className="mt-4 w-full" disabled={isPending || !token}>
          {isPending ? "Resetting..." : "Reset password"}
          {!isPending && (
            <ArrowRightIcon className="ml-auto h-5 w-5 text-slate-50" />
          )}
        </Button>

        {!token && (
          <div className="mt-3 flex items-start gap-2">
            <ExclamationCircleIcon className="mt-0.5 h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">
              Reset link is missing a token.
            </p>
          </div>
        )}

        {showMessage && (
          <div className="mt-3 flex items-start gap-2">
            <ExclamationCircleIcon className="mt-0.5 h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">
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
