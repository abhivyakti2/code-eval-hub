import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
 
//Like loading.tsx, it’s a special file in Next.js.
//Every request → proxy runs → then page loads
export default NextAuth(authConfig).auth;  //creates middleware to call authorized on return
// if the middleware finds unauthenticated request, it's lead to login page 
export const config = {
  // https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'], //exclude static files and api routes, and '/' page.
   
};