import "@/app/ui/global.css";
import { inter } from "@/app/ui/fonts";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | CodeEvalHub",
    default: "CodeEvalHub",
  },
  description: "AI-powered GitHub repository evaluator with RAG-based chat.",
  metadataBase: new URL("https://code-eval-hub.vercel.app"), //update with actual URL
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode; // input is object, type will also be object, for property children, type is React.ReactNode
  //can also import {ReactNode} from react, n just write ReactNode, but this is more concise
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
//children directly comes from the props of the RootLayout component, and it represents the content that will be rendered inside the layout. In Next.js, when you create a layout component, it automatically receives a special prop called "children" which contains the content that is wrapped by the layout. This allows you to define a consistent structure for your pages while still allowing for dynamic content to be rendered within that structure.
//In this case, the RootLayout component is wrapping the entire application, and the {children} will be replaced by the specific content of each page that uses this layout. The className applied to the body element includes the Inter font and an antialiased style for smoother text rendering.