import '@/app/ui/global.css';
import {inter} from '@/app/ui/fonts';
import {Metadata} from 'next';

export const metadata: Metadata={
  title: {
    template: '%s | CodeEvalHub',
    default: 'CodeEvalHub'
  },
  description: 'AI-powered GitHub repository evaluator with RAG-based chat.',
  metadataBase: new URL('https://code-eval-hub.vercel.app') //update with actual URL
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode; // input is object, type will also be object, for property children, type is React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
