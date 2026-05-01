"use client";

import { lusitana } from "@/app/ui/fonts";
import {
  AtSymbolIcon,
  KeyIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { ArrowRightIcon } from "@heroicons/react/20/solid";
import { Button } from "./button";
import { useActionState } from "react";
import { authenticate, LoginState } from "@/app/lib/actions";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginForm() {

  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  // we are setting callbackUrl in the login page url when we redirect to it from a protected page.
  // for example, if we try to access /dashboard without being authenticated,
  // we will be redirected to /login?callbackUrl=/dashboard by NextAuth.
  // this way, after we log in, we can redirect the user back to the page they were trying to access.

  const initialState: LoginState = { message: null, errors: {} };
  // No hydration mismatch issues
  // The server renders initial state
  // After submit, React updates via action result
  // No mismatch because state flow is controlled
  
  const [state, formAction, isPending] = useActionState(
    authenticate,
    initialState,
  );
  //state is the object returned from the authenticate action on login.
  //isPending is a boolean that indicates whether the form submission is in progress.
  //TODO : We can use this to disable the submit button while the login request is being processed. i.e show loading state on the button.

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex-1 rounded-lg bg-gray-50 px-6 pb-4 pt-8">
        <h1 className={`${lusitana.className} mb-3 text-2xl`}>
          Please log in to continue.
        </h1>
        <div className="w-full">
          <div>
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="email"
            >
              Email
            </label>
            {/* label is block element, then how is input in the same line? Because it's a peer element i.e it's a sibling element and sibling elements are displayed inline */}
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email address"
                required
                aria-describedby="email-error"
              />
              {/* aria-describedby links the error message to the input field */}
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            <div id="email-error" aria-live="polite" aria-atomic="true">
              {state?.errors?.email &&
                state.errors.email.map((error: string) => (
                  <p className="text-sm text-red-500" key={error}>
                    {error}
                  </p>
                ))}
            </div>
          </div>
          <div className="mt-4">
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                id="password"
                type="password"
                name="password"
                placeholder="Enter password"
                required
                minLength={6}
                aria-describedby="password-error"
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            <div id="password-error" aria-live="polite" aria-atomic="true">
              {state?.errors?.password &&
                state.errors.password.map((error: string) => (
                  <p className="text-sm text-red-500" key={error}>
                    {error}
                  </p>
                ))}
            </div>
          </div>
        </div>

        <input type="hidden" name="redirectTo" value={callbackUrl} />
        {/* sent as part of the form data to the authenticate action, 
        so that after successful login, we can redirect the user to the callbackUrl. */}

        <Button className="mt-4 w-full">
          Log in <ArrowRightIcon className="ml-auto h-5 w-5 text-gray-50" />
        </Button>
        {/*How is this Button linked to form's submission? If you don’t specify a type, then by default:
        A <button> inside a <form> behaves as type="submit"*/}
        {/* TODO : aria-describedby is used to associate the error messages with the correct input field, here message in state isn' linked to a specific input field, what does it contain? */}
        {state?.message && (
          <div className="flex h-8 items-end space-x-1">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">{state.message}</p>
          </div>
        )}

        <div className="mt-4 text-center text-sm">
          <p className="text-gray-600">
            Don't have an account?{" "}
            <Link
              href="/signup"
              className="text-blue-500 hover:text-blue-400 font-semibold"
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