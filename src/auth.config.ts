import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config: no database access, no Argon2. The Credentials provider
 * (which needs both) is added in auth.ts. Keeping them split follows the Auth.js v5
 * pattern and leaves the door open to a `proxy.ts` route guard later.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  // The Credentials provider (which needs the DB + Argon2) is added in auth.ts.
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "owner";
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.role = token.role ?? "owner";
      return session;
    },
    authorized({ auth }) {
      // Used if a proxy.ts guard is added; harmless otherwise.
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
