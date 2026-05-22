"use client";

import {
  AtSymbolIcon,
  KeyIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/20/solid";
import { Button } from "./button";
import { useActionState, useState } from "react";
import { authenticate } from "@/app/lib/actions";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoginState } from "../lib/definitions";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  // we are setting callbackUrl in the login page url when we redirect to it from a protected page.
  // for example, if we try to access /dashboard without being authenticated,
  // we will be redirected to /login?callbackUrl=/dashboard by NextAuth.
  // this way, after we log in, we can redirect the user back to the page they were trying to access.

  const error = searchParams.get("error");
  const message = searchParams.get("message");

  const initialState: LoginState = { message: null, errors: {} };
  // No hydration mismatch issues
  // The server renders initial state
  // After submit, React updates via action result
  // No mismatch because state flow is controlled

  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[]>
  >({});

  const [state, formAction, isPending] = useActionState(
    authenticate,
    initialState,
  );

  const showMessage = !!state?.message;

  const clearField = (field: string) => {
    setFieldErrors((prev) => ({ ...prev, [field]: [] }));
  };

  const emailErrors = fieldErrors.email ?? state?.errors?.email;
  const passwordErrors = fieldErrors.password ?? state?.errors?.password;
  //state is the object returned from the authenticate action on login.
  //isPending is a boolean that indicates whether the form submission is in progress.
  //TODO : We can use this to disable the submit button while the login request is being processed. i.e show loading state on the button.

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex-1 rounded-lg border border-slate-800 bg-slate-900/80 px-6 pb-4 pt-8 shadow-sm shadow-slate-950/30">
        <h1 className="mb-3 text-2xl text-slate-100">
          Please log in to continue.
        </h1>
        <div className="w-full">
          <div>
            <label
              className="mb-3 mt-5 block text-xs font-medium text-slate-200"
              htmlFor="email"
            >
              Email
            </label>
            {/* label is block element, then how is input in the same line? Because it's a peer element i.e it's a sibling element and sibling elements are displayed inline */}
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-slate-700 bg-slate-950/70 py-[9px] pl-10 text-sm text-slate-100 outline-2 placeholder:text-slate-500"
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email address"
                required
                aria-describedby="email-error"
                onChange={() => clearField("email")}
              />
              {/* aria-describedby links the error message to the input field */}
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 peer-focus:text-cyan-300" />
            </div>
            <div id="email-error" aria-live="polite" aria-atomic="true">
              {emailErrors &&
                emailErrors.map((error: string) => (
                  <p className="text-sm text-red-500" key={error}>
                    {error}
                  </p>
                ))}
            </div>
          </div>
          <div className="mt-4">
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
                placeholder="Enter password"
                required
                minLength={6}
                aria-describedby="password-error"
                onChange={() => clearField("password")}
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500 peer-focus:text-cyan-300" />
            </div>
            <div id="password-error" aria-live="polite" aria-atomic="true">
              {passwordErrors &&
                passwordErrors.map((error: string) => (
                  <p className="text-sm text-red-500" key={error}>
                    {error}
                  </p>
                ))}
            </div>
            <div className="mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                Forgot password?
              </Link>
            </div>
          </div>
        </div>

        <input type="hidden" name="redirectTo" value={callbackUrl} />
        {/* sent as part of the form data to the authenticate action, 
        so that after successful login, we can redirect the user to the callbackUrl. */}
<div className="flex justify-center">

        <Button className="mt-4 text-white" disabled={isPending}>
          {isPending ? "Logging in..." : "Log in"}
          {!isPending && (
            <ArrowRightIcon className="ml-auto h-5 w-5 text-slate-50" />
          )}{" "}
        </Button> </div>
        {/*How is this Button linked to form's submission? If you don’t specify a type, then by default:
        A <button> inside a <form> behaves as type="submit"*/}
        {/* TODO : aria-describedby is used to associate the error messages with the correct input field, here message in state isn' linked to a specific input field, what does it contain? */}
        {state?.message && showMessage && (
          <div className="flex h-8 items-end space-x-1">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">{state.message}</p>
          </div>
        )}
        {error === "account_created_login_failed" && (
          <p className="text-sm text-amber-300">
            Account created! Please log in.
          </p>
        )}
        {message === "password_reset" && (
          <p className="text-sm text-emerald-300">
            Password reset. Please log in with your new password.
          </p>
        )}
        <div className="mt-4 text-center text-sm">
          <p className="text-slate-300">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-semibold text-cyan-300 hover:text-cyan-200"
            >
              Sign up
            </Link>
            {/* Link is an inline element */}
          </p>
        </div>
      </div>
    </form>
  );
}

//useActionState : Not great for:
// Real-time validation (onChange)
// Highly interactive forms (live typing feedback)
// Complex multi-step client-heavy flows
