// Validation du formulaire d'inscription, dans le navigateur, avant tout envoi à Supabase.
// Deux champs (prénom, nom) réunis en un seul nom complet « Prénom Nom » : la base ne connaît que
// profiles.name (2 à 40 caractères, sans « @ », unique sans tenir compte de la casse).
import { z } from "zod";

/** Champ de l'état civil : rempli, sans « @ », 40 caractères au plus (comme profiles.name). */
export function personField(label: string) {
  return z
    .string()
    .trim()
    .min(1, `Saisissez votre ${label}.`)
    .max(40, `Votre ${label} est trop long (40 caractères max).`)
    .refine((v) => !v.includes("@"), `Le ${label} ne peut pas contenir « @ ».`);
}

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
  prenom: personField("prénom"),
  nom: personField("nom"),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .max(200, "Le mot de passe est trop long."),
});

export type SignupInput = { email: string; prenom: string; nom: string; password: string; confirm: string };
export type SignupData = z.output<typeof schema> & { name: string };

export function validateSignup(
  input: SignupInput,
): { ok: true; value: SignupData } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  // Nom complet envoyé à Supabase (options.data.name), lu partout ailleurs (profil, notifications).
  const name = `${parsed.data.prenom} ${parsed.data.nom}`;
  if (name.length > 40) return { ok: false, error: "Votre nom complet est trop long (40 caractères max)." };
  if (input.password !== input.confirm) return { ok: false, error: "Les deux mots de passe ne correspondent pas." };
  return { ok: true, value: { ...parsed.data, name } };
}

/** Message lisible pour les erreurs renvoyées par Supabase Auth à l'inscription. */
export function signupErrorMessage(message: string): string {
  if (/already registered|already exists/i.test(message)) return "Un compte existe déjà avec cette adresse e-mail.";
  if (/profiles_name_lower_idx|duplicate key|database error saving new user/i.test(message))
    return "Ce nom est déjà pris (une personne s'est déjà inscrite avec ce prénom et ce nom).";
  if (/rate limit/i.test(message)) return "Trop de tentatives. Réessayez dans quelques minutes.";
  return "Inscription impossible pour le moment. Réessayez plus tard.";
}
