import { z } from "zod";

/** Login credentials — validated in the Credentials provider's `authorize` (PRD §12). */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
