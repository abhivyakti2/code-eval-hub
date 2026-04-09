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
    console.error("Failed to fetch user:", error);
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
    //where is token n session sent from by nextauth int the function parameter? they are passed from the property callbacks in the NextAuth configuration. When a user signs in, NextAuth will call the jwt callback to create a JWT token, and it will pass the token and user objects as parameters. Similarly, when a session is checked, NextAuth will call the session callback and pass the session. they're stored in object of the shape 
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
  providers: [
    Credentials({ //calls authorize when we call signIn('credentials', formData). 
    // needs to be named authorize only, specific to credentials provider, next auth will call it when we call signIn with credentials provider.
    // can use phone number or whatever instead of email, no restrictions, we define the schema and validation ourselves.
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);
        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null; // next auth will handle this and return an error 
          // to the client, we just need to return null here.
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        console.log("Invalid credentials");
        return null;
      },
    }),
  ],
});
