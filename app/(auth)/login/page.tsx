import LoginForm from "@/app/ui/login-form";
import { Suspense } from "react";

export default function LoginPage() {
  return (
    // Wrap LoginForm in Suspense to delay rendering until it's fully ready on the client.
    // This avoids hydration issues caused by client-only hooks (like useState/useEffect).
    // Without a fallback, nothing is shown until the component is ready (silent loading).
    // Hydration is attaching JavaScript to HTML that was already rendered on the server, and React expects that HTML to match what the client would render.
    // TODO: Add a fallback UI (e.g., skeleton or loader) to improve UX during this delay.
    <Suspense>
      <LoginForm />
      {/* login form uses useSearchParams hook, which is a client-side hook getting value from url params, Server render → may not know callbackUrl causing a mismatch
       between server HTML and client-rendered HTML, Client loads → renders correct version directly, then Suspense unblocks rendering of the component 
       It’s not similar to onClick because onClick doesn’t change what’s rendered, but callbackUrl does—and hydration only works if the rendered output is identical.
       Hydration mismatch can happen when we use :
       Date.now()
        Math.random()
        window.*
        localStorage
        URL-dependent hooks (sometimes)
        in client-side code without say useState initialized to a default value that server sends it with, because then the html changes after hydration, i.e doesn't cause hydration mismatch 
        If your UI depends on something that can change between server and client at render time, you either delay it (Suspense) or move it to useEffect.*/}
    </Suspense>
  );
}
