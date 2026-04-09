import { CodeBracketIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

export default function AuthLayout({
    children,
}:{
    children: React.ReactNode
}){
    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
            <div className="w-full max-w-md">
                <div className="mb-6 flex flex-row justify-center items-center gap-3 text-center">
                    <CodeBracketIcon className="h-14 w-14 text-blue-400"/>
                    <Link href="/" className="text-3xl font-bold text-white">
                        CodeEvalHub
                    </Link>
                    {/* <p className="max-w-sm text-sm text-slate-300">
                        AI-powered Github repository evaluator.
                    </p> */}
                </div>
                {children}
            </div>
        </main>
    );
}