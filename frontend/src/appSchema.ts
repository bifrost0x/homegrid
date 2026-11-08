import { z } from "zod";

export const appSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter an application name.")
    .max(100)
    .refine(
      (value) => new TextEncoder().encode(value).length <= 100,
      "Use an application name of at most 100 UTF-8 bytes.",
    ),
  url: z
    .url("Enter a complete http:// or https:// URL.")
    .refine((v) => /^https?:\/\//i.test(v), "Use an HTTP or HTTPS URL."),
});
