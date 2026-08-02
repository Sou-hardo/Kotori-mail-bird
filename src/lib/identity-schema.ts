import { z } from "zod";
export const identitySchema = z.object({
  label: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  role: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  pronouns: z.string().optional(),
  signature: z.string().min(1),
  closing: z.string().min(1),
  isDefault: z.boolean().default(false),
});
