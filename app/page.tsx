import { ArrowRightIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <CodeBracketIcon className="h-16 w-16 text-blue-400" />
        <h1 className="text-4xl font-bold text-white">Code Eval Hub</h1>
        <p className="max-w-md text-slate-300">
          AI-powered GitHub repository evaluator. Analyse repos, evaluate
          contributors, and chat with your codebase using RAG.
        </p>
        <Link
          href="/login"
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 text-white hover:bg-blue-400"
        >
          Get Started <ArrowRightIcon className="h-5 w-5" />
        </Link>
      </div>
    </main>
  );
}