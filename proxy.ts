import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
 
export default NextAuth(authConfig).auth;  //it returns a middleware function that checks if the user is authenticated. If not, it redirects to the login page. If yes, it allows the request to proceed to the next handler (e.g., the page or API route).
// if the middleware finds unauthenticated request, it's lead to login page 

export const config = {
  // https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'], //exclude static files and api routes, and '/' page.
   // matcher regex breakdown:
   // (?!...) is a negative lookahead that excludes paths starting with 'api', '_next/static', '_next/image', or ending with '.png'.
   // .* matches any path that doesn't match the excluded patterns.
};


//Like loading.tsx, it’s a special file in Next.js.
//Every request → proxy runs → then page loads