import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getUserByEmail } from "@/db/queries/users";
import { DECOY_HASH, verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/validation";

import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await getUserByEmail(parsed.data.email);

        // Always pay the Argon2 cost, present user or not (see DECOY_HASH).
        const valid = await verifyPassword(user?.passwordHash ?? DECOY_HASH, parsed.data.password);
        if (!user || !valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
});
