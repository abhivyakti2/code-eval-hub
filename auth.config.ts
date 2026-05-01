import type { NextAuthConfig } from "next-auth";
//for type-checking the authConfig object.
// type : “Import this only for type-checking. Do NOT include it in the final JavaScript.”
// not normal runtime import

// why do we need custom config object, why not directly use nextauthcongig object
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
  pages: {
    //Overrides default auth pages with custom ones.
    signIn: "/login",
    //automatically adds callbackUrl to the query params when redirecting to the sign-in page,
    // which we can access in the login form to redirect the user back to the page they were trying to access after logging in.
  },

  callbacks: {
    //authorized(fixed name) - called when user tries to access a protected route. It checks if the user is authenticated and redirects them accordingly.
    //middleware, not actual logic for handling authentication, which is in the NextAuth config in auth.ts.
    // auth is the current session object, which contains user information if the user is logged in, or null if not. it is sent to the middleware by NextAuth when a request is made to a protected route.
    //This function runs in middleware and answers:“Is this request allowed to continue?”
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      // is !! applied first or '?' ? first ? checks if auth is not null or undefined, then !! converts the result to a boolean. So if auth?.user exists, isLoggedIn will be true, otherwise false.

      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");

      if (isOnDashboard) {
        if (!isLoggedIn) return false;
      } else if (isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl)); //if user is logged in and tries to access login page, redirect them to dashboard. This is optional but improves UX by preventing logged-in users from seeing the login page. and if there was a protected page requested, if logged in, they're redirected to that page instead of dashboard because of the callbackUrl query param added by NextAuth when redirecting to login page.
      }
      return true; //if false is returned, the user will be redirected to the sign-in page.
      //how will last true be reachable? when user on dashboard and logged in, or on public page regardless of login status. in both cases, we want to allow the request to proceed, so we return true.
    },
    //authorize needs to run on login page to figure out if logged in and redirect directly, 
    // so it must mean authorize needs to run on login page as well
    // but then how does it not loop infinitely? like we reach on login page after not being logged in, then authorized runs, sees not logged in, returns false, which redirects to login page again, which runs authorized again, and so on?
    //
  },
  providers: [], 
  //not needed here because we will define providers
  // in the NextAuth config in auth.ts when we initialize NextAuth,
  // but we need to include this property to satisfy the NextAuthConfig type.
  
} satisfies NextAuthConfig; //better than ": NextAuthConfig" because it allows
// for excess properties, which is useful when we spread this object in the NextAuth config.
//excess means we can have additional properties in the NextAuth config that are not defined in the authConfig,
// without TypeScript throwing an error about missing properties. This gives us more flexibility in how we structure our NextAuth configuration while still ensuring that the authConfig adheres to the expected shape for authentication-related settings.




// Why check for the Dashboard specifically?

// If we only checked isLoggedIn, we would run into a problem:
// Without the check: If we just returned false whenever isLoggedIn was false, a user trying to visit your homepage (/) would be forced to the login page immediately.
// With the check: We only force a login if they are trying to reach a "protected" route like /dashboard.

// Why doesn't it loop?

// An infinite loop usually happens if the middleware redirects user to a page, and then that page triggers the middleware to redirect user back again.
// User goes to /login.
// isOnDashboard is false.
// isLoggedIn is false (so the else if is skipped).
// The function returns true.
// Result: The user stays on /login. No redirect, no loop! 


// Separation of Concerns in Next.js Middleware:
// Next.js Middleware runs on the Edge Runtime, which is a lightweight environment that doesn't support all Node.js APIs or certain heavy database libraries. By splitting the config:
// auth.config.ts: Contains "Edge-compatible" logic (callbacks, pages). This can run in the middleware.
// auth.ts: Includes the database adapter and providers. This runs on the full Node.js server.
// when is each run? auth.config.ts is used in proxy.ts, which is a special file that runs on every request before the page or API route is processed. This is where we put the authorized callback that checks if the user is authenticated and redirects them accordingly. 
// auth.ts is run only when we initialize NextAuth, which is typically done in an API route (e.g., /api/auth/[...nextauth].ts). This is where we define our providers and any database-related logic, such as fetching the user from the database during authentication. The separation allows us to keep the middleware logic lightweight and compatible with the Edge Runtime, while still having access to the full capabilities of Node.js for our authentication logic.
// like in logout, etc.