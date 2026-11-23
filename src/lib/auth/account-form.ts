// Validation des formulaires de la page Paramètres (dans le navigateur, avant l'envoi à Supabase).
import { personField } from "./signup-form";

export function validateRename(input: { prenom: string; nom: string }): { ok: true; name: string } | { ok: false; error: string } {
  const prenom = personField("prénom").safeParse(input.prenom);
  if (!prenom.success) return { ok: false, error: prenom.error.issues[0]?.message ?? "Prénom invalide." };
  const nom = personField("nom").safeParse(input.nom);
  if (!nom.success) return { ok: false, error: nom.error.issues[0]?.message ?? "Nom invalide." };
  const name = `${prenom.data} ${nom.data}`;
  if (name.length > 40) return { ok: false, error: "Votre nom complet est trop long (40 caractères max)." };
  return { ok: true, name };
}

/** Pré-remplissage : le nom complet est enregistré « Prénom Nom ». */
export function splitName(name: string): { prenom: string; nom: string } {
  const [prenom = "", ...rest] = name.trim().split(/\s+/);
  return { prenom, nom: rest.join(" ") };
}

export function validatePasswordChange(input: { current: string; password: string; confirm: string }): { ok: true } | { ok: false; error: string } {
  if (!input.current) return { ok: false, error: "Saisissez votre mot de passe actuel." };
  if (input.password.length < 8) return { ok: false, error: "Le mot de passe doit contenir au moins 8 caractères." };
  if (input.password.length > 200) return { ok: false, error: "Le mot de passe est trop long." };
  if (input.password !== input.confirm) return { ok: false, error: "Les deux mots de passe ne correspondent pas." };
  if (input.password === input.current) return { ok: false, error: "Le nouveau mot de passe doit être différent de l'actuel." };
  return { ok: true };
}

export function renameErrorMessage(message: string): string {
  if (/profiles_name_lower_idx|duplicate key/i.test(message)) return "Ce nom est déjà pris par un autre compte.";
  return "Le nom n'a pas pu être changé. Réessayez plus tard.";
}
