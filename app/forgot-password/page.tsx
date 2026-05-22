import Link from "next/link";
import { Suspense } from "react";
import ForgotPasswordForm from "@/app/ui/forgot-password-form";
import { playfairDisplay } from "@/app/ui/fonts";
import { Logo } from "../ui/logo";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-row items-center justify-center gap-3 text-center">
          <Logo className="h-14 w-14 text-blue-400" />
          <Link href="/" className={`${playfairDisplay.className} text-3xl font-bold text-white`}>
            CodeEvalHub
          </Link>
        </div>
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
