import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
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
          console.log("[auth] lookup email:", credentials.email, "found:", !!user);
          if (!user) return null;
          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash
          );
          console.log("[auth] password valid:", valid);
          if (!valid) return null;
          return { id: user.id, name: user.name, email: user.email };
        } catch (err) {
          console.error("[auth] authorize error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.id) session.user.id = token.id as string;
      return session;
    },
  },
});
