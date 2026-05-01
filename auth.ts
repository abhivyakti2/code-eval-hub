import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/app/lib/db";


async function getUser(email: string) {
  try {
    return await prisma.user.findUnique({ where: { email } });
    //we've not mentioned which fields to select, so it will return all fields of the user, including password. we need password to compare with the hashed password in the database, but we should be careful not to return the password to the client side. next auth will only return the properties of the user object that are not marked as private, so as long as we don't mark password as private, it will be available in the authorize function, but it won't be sent to the client side in the session object.
  } catch (error) {
    // console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}


export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: { 
    //not arbitrary, these are the only callbacks next auth recognizes.
    //but inside these callbacks we can do whatever we want, 
    // and we can add any properties we want to the token and session objects.
    //where is token n session sent from by nextauth into the function parameter? they are passed from the property callbacks in the NextAuth configuration. When a user signs in, NextAuth will call the jwt callback to create a JWT token, and it will pass the token and user objects as parameters. Similarly, when a session is checked, NextAuth will call the session callback and pass the session. 
    // they're stored in object of the shape : { token: JWT, user: User } for jwt callback, and { session: Session, token: JWT } for session callback. are they stored in the cookie? the JWT token is stored in the cookie, but the session object is not stored in the cookie. The session object is created on the server side and sent to the client side when the session is checked, but it is not stored in the cookie. The JWT token is used to authenticate the user on subsequent requests, and it can contain custom properties that we define in the jwt callback. The session object can also contain custom properties that we define in the session callback, and it is available on the client side when we call getSession() or useSession() hooks from next-auth/react.
    async jwt({ token, user }) {
      if (user) {
        (token as { id?: string }).id = (user as { id: string }).id;
      }
      return token;
    },
    //session is stored where on server side? session is not stored on the server side, it is created on the fly whenever the session is checked. When a user signs in, NextAuth creates a JWT token that contains the user's information and stores it in a cookie on the client side. Whenever the client makes a request to the server, NextAuth checks the cookie for the JWT token, verifies it, and then creates a session object based on the information in the token. The session object is then sent to the client side when we call getSession() or useSession() hooks from next-auth/react. So, the session object is not stored on the server side, but it is created dynamically based on the JWT token that is stored in the cookie on the client side.
    // but if it's dynamically created, how does it persist across requests? it persists across requests because the JWT token is stored in the cookie on the client side, and it is sent with every request to the server. Whenever the server receives a request, NextAuth checks the cookie for the JWT token, verifies it, and then creates a session object based on the information in the token. So, as long as the JWT token is valid and present in the cookie, the session object can be created on the fly for each request.
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = (token as { id?: string }).id;
        // if session is created using token already, then why are we adding user id here? because the session object is created based on the information in the JWT token, but it does not automatically include all the properties from the token. We need to explicitly add any custom properties that we want to be available in the session object. In this case, we are adding the user id from the token to the session.user object so that it can be accessed on the client side when we call getSession() or useSession() hooks from next-auth/react. This way, we can have access to the user id in our frontend components and use it for various purposes, such as displaying user-specific information or making authenticated API requests.
        // what properties does session automatically include from the token? by default, the session object includes the user's name, email, and image properties if they are available in the token. However, it does not automatically include any custom properties that we add to the token in the jwt callback. We need to explicitly add any custom properties that we want to be available in the session object in the session callback, as we are doing here with the user id. So, if we want to have access to any custom properties from the token in our frontend components, we need to make sure to add them to the session object in the session callback.
      }
      return session;
      //are we removing password from session object here? no, we are not removing the password from the session object here because we are not adding it to the session object in the first place. The session object is created based on the information in the JWT token, and we are only adding the user id to the session object. The password is not included in the JWT token, so it is not available in the session object. This way, we can ensure that sensitive information like the password is not exposed on the client side through the session object.
    },
  },


  //why different functions for token n session check? use cases are : jwt() is called when user signs in, and we want to add custom properties to the token that will be stored in the cookie. session() is called whenever the session is checked, for example when we call getSession() on the client side, and we want to add custom properties to the session object that will be available on the client side.
  //what kind of properties do we want for jwt(), and which for session()? apart from user id that's in both, in jwt() we might want to add properties that are relevant for authentication and authorization, such as user roles or permissions(because it goes with requests user makes, so we need to know if user is allowed to access those resources), which can be used in the backend to protect certain routes or resources. In session(), we might want to add properties that are relevant for the client side, such as user preferences or settings, which can be used to customize the user experience on the frontend.
  providers: [
    Credentials({ 

      // next auth calls authorize when we call signIn('credentials', formData). 
    // needs to be named authorize only, specific to credentials provider.
    // can use phone number or whatever instead of email, no restrictions, we define the schema and validation ourselves.
      async authorize(credentials) { 
        // credentials is the form data we pass in signIn, in this case it should have email and password properties, but we can define it however we want.
        
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);
          //.string() returns a ZodString object, which has the method email() that adds an email validation to the string, and min(6) that adds a minimum length validation of 6 characters to the string. safeParse() is used to validate the credentials object against the defined schema, and it returns an object with a success property that indicates whether the validation was successful or not, and a data property that contains the parsed credentials if the validation was successful, or an error property that contains the validation errors if the validation failed.
        
          if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) {
            throw new Error("No user found with that email."); // surfaces as CredentialsSignin
          }
          //can also return just null if we don't want to specify error message, and it will still surface as CredentialsSignin error on the client side, but by throwing an error with a specific message, we can provide more context about why the sign-in failed, which can be helpful for debugging and improving the user experience on the client side. When we throw an error in the authorize function, NextAuth will catch that error and pass the message to the client side, where we can display it to the user to inform them about the reason for the failed sign-in attempt.
          
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (!passwordsMatch) {
            throw new Error("Incorrect password."); // surfaces as CredentialsSignin
          }
          return user; // but user also contains password, is it marked as private? no, it's not marked as private, but next auth will only return the properties of the user object that are not marked as private in the session object that is sent to the client side. so it will be sent to client side in session object? no, it won't be sent to the client side in the session object because we are not adding it to the session object in the session callback. we are only adding the user id to the session object, so only the user id will be available on the client side when we call getSession() or useSession() hooks from next-auth/react. the password will not be available on the client side, but it will be available in the authorize function for us to compare with the hashed password in the database.
        }
        return null; 
    }}),
  ],
});



//NextAuth is a library that provides authentication and authorization for Next.js applications. It supports multiple authentication providers, including credentials, OAuth, and more. In this code, we are using the credentials provider to authenticate users with their email and password. We define the authorize function to validate the credentials and return the user object if the credentials are valid. We also use callbacks to add custom properties to the JWT token and session objects, which can be used for authentication and authorization purposes.