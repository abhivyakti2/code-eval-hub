import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/app/lib/db";

async function getUser(email: string) {
  try {
    return await prisma.user.findUnique({ where: { email } });
  } catch (error) {
    // console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

// TODO : also add auto signout after certain period of inactivity, 
// can be done by setting session maxAge in next auth config, 
// and also by implementing a client side timer that calls signOut 
// after certain period of inactivity. 
export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: { 
    //not arbitrary, these are the only callbacks next auth recognizes.
    //but inside these callbacks we can do whatever we want, 
    // and we can add any properties we want to the token and session objects.
    //where is token n session sent from by nextauth into the function parameter? they are passed from the property callbacks in the NextAuth configuration. When a user signs in, NextAuth will call the jwt callback to create a JWT token, and it will pass the token and user objects as parameters. Similarly, when a session is checked, NextAuth will call the session callback and pass the session. 
    // they're stored in object of the shape : { token: JWT, user: User } for jwt callback, and { session: Session, token: JWT } for session callback.
    async jwt({ token, user }) {
      if (user) {
        (token as { id?: string }).id = (user as { id: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = (token as { id?: string }).id;
      }
      return session;
    },
  },
  //why different functions for token n session check? use cases are : jwt() is called when user signs in, and we want to add custom properties to the token that will be stored in the cookie. session() is called whenever the session is checked, for example when we call getSession() on the client side, and we want to add custom properties to the session object that will be available on the client side.
  //what kind of properties do we want for jwt(), and which for session()? apart from user id that's in both, in jwt() we might want to add properties that are relevant for authentication and authorization, such as user roles or permissions, which can be used in the backend to protect certain routes or resources. In session(), we might want to add properties that are relevant for the client side, such as user preferences or settings, which can be used to customize the user experience on the frontend.
  providers: [
    Credentials({ //calls authorize when we call signIn('credentials', formData). 
    // needs to be named authorize only, specific to credentials provider, next auth will call it when we call signIn with credentials provider.
    // can use phone number or whatever instead of email, no restrictions, we define the schema and validation ourselves.
      async authorize(credentials) { // credentials is the form data we pass in signIn, in this case it should have email and password properties, but we can define it however we want.
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);
          //.string() returns a ZodString object, which has the method email() that adds an email validation to the string, and min(6) that adds a minimum length validation of 6 characters to the string. safeParse() is used to validate the credentials object against the defined schema, and it returns an object with a success property that indicates whether the validation was successful or not, and a data property that contains the parsed credentials if the validation was successful, or an error property that contains the validation errors if the validation failed.
        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null; // next auth will handle this and return an error 
          // to the client, we just need to return null here. CHECK HOW? can we pass message along with null? yes, we can return { error: "Invalid credentials" } instead of null, and then on the client side we can check for error in the response from signIn and display the message accordingly.
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        // console.log("Invalid credentials");
        return null;
      },
    }),
  ],
});
