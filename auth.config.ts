import type { NextAuthConfig } from 'next-auth'; //for type-checking the authConfig object.
//why do we need custom config object, why not directly use nextauthcongig object 
// when initializing NextAuth in auth.ts? is it just an instance of nextauthconfig? 
// we separate the authConfig from the NextAuth config for better organization 
// and maintainability. The authConfig contains the specific configuration related 
// to authentication flow, such as custom pages and callbacks, while the NextAuth 
// config in auth.ts will include this authConfig along with other configurations 
// like providers and session settings. This way, we can keep our authentication-
// related logic modular and easier to manage as our application grows.


// pages is a predefined property in NextAuthConfig that allows us to specify custom pages for authentication flow. 
// callbacks is another predefined property that allows us to define functions that will be called at certain points in the authentication flow, such as when a user tries to access a protected route (authorized callback).
export const authConfig = {
  pages: { //Overrides default auth pages with custom ones. 
    signIn: '/login',  //automatically adds callbackUrl to the query params when redirecting to the sign-in page, 
    // which we can access in the login form to redirect the user back to the page they were trying to access after logging in.
  },
  callbacks: { 
    //authorized(fixed name) - called when user tries to access a protected route. It checks if the user is authenticated and redirects them accordingly.
    //middleware, not actual logic for handling authentication, which is in the NextAuth config in auth.ts.
    // auth is the current session object, which contains user information if the user is logged in, or null if not. 
    authorized({auth, request: {nextUrl}}){
        const isLoggedIn=!!auth?.user;
        const isOnDashboard=nextUrl.pathname.startsWith('/dashboard');

        if(isOnDashboard){
            if(!isLoggedIn) return false;
        } else if(isLoggedIn){
            return Response.redirect(new URL('/dashboard', nextUrl));
        }
        return true; //if false is returned, the user will be redirected to the sign-in page.
    },
  },
  providers: [], //not needed here because we will define providers 
  // in the NextAuth config in auth.ts when we initialize NextAuth, 
  // but we need to include this property to satisfy the NextAuthConfig type.
} satisfies NextAuthConfig; //better than ": NextAuthConfig" because it allows 
// for excess properties, which is useful when we spread this object in the NextAuth config. 
//excess means we can have additional properties in the NextAuth config that are not defined in the authConfig,
// without TypeScript throwing an error about missing properties. This gives us more flexibility in how we structure our NextAuth configuration while still ensuring that the authConfig adheres to the expected shape for authentication-related settings.