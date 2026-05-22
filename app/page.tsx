import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { playfairDisplay } from '@/app/ui/fonts';
import { Logo } from '@/app/ui/logo';

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-blue-900 to-slate-900 p-6">
      {/* grid background */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />
      {/* hero glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(96,165,250,0.15),transparent_70%)]" />

      <div className="relative flex flex-col items-center gap-6 text-center">
        <Logo className="h-14 w-14" />
        <h1 className={`${playfairDisplay.className} text-5xl font-semibold text-white md:text-6xl`}>
          Code Eval Hub
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-slate-300">
          AI-powered GitHub repository evaluator. Analyse repos, evaluate
          contributors, and chat with your codebase using RAG.
        </p>
        <Link
          href="/login"
          className="group flex items-center gap-2 rounded-full bg-blue-500 px-7 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-blue-400"
        >
          Get Started
          <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </main>
  );
}