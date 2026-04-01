import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import type { GoogleProfile } from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const { getUserByEmail } = await import("@/lib/db");
          const user = await getUserByEmail(credentials.email as string);
          if (!user) return null;
          // Guard: SSO-only accounts cannot use credentials login
          if (user.googleId && user.passwordHash === null) return null;
          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash as string
          );
          if (!valid) return null;
          return { id: user.id, name: user.name, email: user.email };
        } catch (err) {
          console.error("[auth] authorize error:", err);
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const name = user.name;
        const email = user.email;
        const googleId = account.providerAccountId;
        const pictureUrl =
          (profile as GoogleProfile)?.picture ?? user.image ?? "";

        if (!name || !email || !googleId) {
          return "/login?error=missing_claims";
        }

        try {
          const { upsertUserFromGoogle } = await import("@/lib/db");
          const { user: dbUser } = await upsertUserFromGoogle({
            name,
            email,
            googleId,
            pictureUrl,
          });
          // Store the db user id on the user object for the jwt callback
          user.id = dbUser.id;
          return true;
        } catch {
          return "/login?error=sso_error";
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (user) token.id = user.id;
      if (account?.provider === "google") {
        token.pictureUrl =
          (profile as GoogleProfile)?.picture ?? user?.image ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) session.user.id = token.id as string;
      if (token?.pictureUrl)
        (session.user as { pictureUrl?: string }).pictureUrl =
          token.pictureUrl as string;
      return session;
    },
  },
});
