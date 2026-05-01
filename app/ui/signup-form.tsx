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
import { register, SignUpState } from "@/app/lib/actions";
import Link from "next/link";

export default function SignUpForm() {
  const initialState: SignUpState = { message: null, errors: {} };

  //we can name the state whatever we want, it is just a variable. formAction is the function we will call on form submit, and isPending is a boolean that indicates if the action is currently being executed.
  const [state, formAction, isPending] = useActionState(register, initialState);
  //what does useActionState do? It is a custom hook that manages the state of an action, including the loading state and any errors or messages returned by the action. It takes an action function and an initial state as arguments, 
  // and returns the current state, a function to execute the action, and a boolean indicating if the action is currently being executed.
  // state is returned from the server action, and it can contain any data that we want to send back to the client, such as error messages or success messages. We can use this state to display feedback to the user based on the result of the action.
  // if action is successful, redirect happens right? state is useful when errors need to be displayed
  // isPending keeps updating automatically based on the state of the action, so we can use it to disable the submit button and show a loading state while the action is being executed.

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex-1 rounded-lg bg-gray-50 px-6 pb-4 pt-8">
        <h1 className={`${lusitana.className} mb-3 text-2xl`}>
          Create your account.
        </h1>
        <div className="w-full">
          <div>
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="email"
            >
              Email
            </label>
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
              <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            {/* zod validation is not done here instead done in server action because we want to keep the validation logic on the server side for security reasons? */}
            <div id="email-error" aria-live="polite" aria-atomic="true">
              {state?.errors?.email &&
                state.errors.email.map(
                  (error: string) => (
                    <p className="text-sm text-red-500" key={error}>
                      {error}
                    </p>
                  ), //circular brackets are used to return the JSX element directly from the arrow function, without needing an explicit return statement.
                  // If we used curly braces instead, we would need to add a return statement to return the JSX element.
                )}
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
                placeholder="Enter password (min 6 characters)"
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
          <div className="mt-4">
            <label
              className="mb-3 mt-5 block text-xs font-medium text-gray-900"
              htmlFor="confirmPassword"
            >
              Confirm Password
            </label>
            <div className="relative">
              <input
                className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                placeholder="Confirm your password"
                required
                minLength={6}
                aria-describedby="confirmPassword-error"
              />
              <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
            </div>
            <div
              id="confirmPassword-error"
              aria-live="polite"
              aria-atomic="true"
            >
              {state?.errors?.confirmPassword &&
                state.errors.confirmPassword.map((error: string) => (
                  <p className="text-sm text-red-500" key={error}>
                    {error}
                  </p>
                ))}
            </div>
          </div>
        </div>

        <Button className="mt-4 w-full" disabled={isPending}>
          {/* when is state pending? after the form is submitted and before the server action completes */}
          {isPending ? "Creating..." : "Sign Up"}{" "}
          <ArrowRightIcon className="ml-auto h-5 w-5 text-gray-50" />
          {/* the content inside the Button component are children sent automatically to Button component? yes they are passed as children */}
        </Button>
        {/* ? is to check if the field exists. TS safety provided by it*/}
        {state?.message && (
          <div className="flex h-8 items-end space-x-1">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">{state.message}</p>
          </div>
        )}
        {/* shows error messages apart from the field-specific ones, eg DB or login error. 
        TODO : track which errors are being sent in message */}

        <div className="mt-4 text-center text-sm">
          <p className="text-gray-600">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-blue-500 hover:text-blue-400 font-semibold"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </form>
  );
}
