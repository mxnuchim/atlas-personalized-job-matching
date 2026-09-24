import type { DefaultSession } from "next-auth";

type AppRole = "owner" | "admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }

  interface User {
    role?: AppRole;
  }
}

// The JWT interface lives in @auth/core/jwt; next-auth/jwt only re-exports it, so
// the callbacks' `token` type is only augmented by targeting the source module.
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: AppRole;
  }
}
