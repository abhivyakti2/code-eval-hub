import { CodeBracketIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { Suspense } from "react";
import ResetPasswordForm from "@/app/ui/reset-password-form";
import { instrumentSerif } from "@/app/ui/fonts";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-row items-center justify-center gap-3 text-center">
          <CodeBracketIcon className="h-14 w-14 text-blue-400" />
          <Link href="/" className={`${instrumentSerif.className} text-3xl font-bold text-white`}>
            CodeEvalHub
          </Link>
        </div>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
