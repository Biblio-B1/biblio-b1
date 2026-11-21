// Validation du formulaire d'inscription, dans le navigateur, avant tout envoi à Supabase.
// Mêmes règles que la base (profiles.name : 2 à 40 caractères, sans « @ ») et confirmation du mot de passe.
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
  name: z
    .string()
    .trim()
    .min(2, "Le pseudo doit contenir au moins 2 caractères.")
    .max(40, "Le pseudo est trop long (40 caractères max).")
    .refine((v) => !v.includes("@"), "Le pseudo ne peut pas contenir « @ »."),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .max(200, "Le mot de passe est trop long."),
});

export type SignupInput = { email: string; name: string; password: string; confirm: string };
export type SignupData = z.output<typeof schema>;

export function validateSignup(
  input: SignupInput,
): { ok: true; value: SignupData } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  if (input.password !== input.confirm) return { ok: false, error: "Les deux mots de passe ne correspondent pas." };
  return { ok: true, value: parsed.data };
}

/** Message lisible pour les erreurs renvoyées par Supabase Auth à l'inscription. */
export function signupErrorMessage(message: string): string {
  if (/already registered|already exists/i.test(message)) return "Un compte existe déjà avec cette adresse e-mail.";
  if (/profiles_name_lower_idx|duplicate key|database error saving new user/i.test(message)) return "Ce pseudo est déjà pris.";
  if (/rate limit/i.test(message)) return "Trop de tentatives. Réessayez dans quelques minutes.";
  return "Inscription impossible pour le moment. Réessayez plus tard.";
}
