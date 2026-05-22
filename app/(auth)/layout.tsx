import Link from "next/link";
import { playfairDisplay } from "@/app/ui/fonts";
import { Logo } from "../ui/logo";

export default function AuthLayout({
    children,
}:{
    children: React.ReactNode
    // layout automatically gets the children which is the content of the page that uses this layout, in this case, the login or register form.
}){
    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 to-slate-900 p-6">
            <div className="w-full max-w-md">
                <div className="mb-6 flex flex-row justify-center items-center gap-3 text-center">
                    <Logo className="h-14 w-14 text-blue-400"/>
                    <Link href="/" className={`${playfairDisplay.className} text-3xl text-white`}>
                        CodeEvalHub
                    </Link>
                </div>
                {children} 
                {/* The children will be the login or register form, depending on the route. */}
            </div>
        </main>
    );
}
