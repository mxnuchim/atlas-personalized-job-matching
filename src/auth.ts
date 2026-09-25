import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getUserByEmail } from "@/db/queries/users";
import { DECOY_HASH, verifyPassword } from "@/lib/password";
import {
  clearFailures,
  clientIp,
  isThrottled,
  recordFailure,
  throttleKeys,
} from "@/lib/rate-limit";
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
      authorize: async (raw, request) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const keys = throttleKeys(parsed.data.email, clientIp(request));

        // Checked before hashing, so a throttled caller costs us nothing: each Argon2
        // verify allocates 19 MiB, which is the denial-of-service half of this.
        if (await isThrottled(keys)) return null;

        const user = await getUserByEmail(parsed.data.email);

        // Always pay the Argon2 cost, present user or not (see DECOY_HASH).
        const valid = await verifyPassword(user?.passwordHash ?? DECOY_HASH, parsed.data.password);

        if (!user || !valid) {
          await recordFailure(keys);
          return null;
        }

        // Success clears the slate, so a few fat-fingered attempts never carry over.
        await clearFailures(keys);

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
