// Règles des devoirs (sans accès aux données), reprises de l'ancien serveur.

export const MAX_HOMEWORK_ATTACHMENT_MB = 30;
export const MAX_HOMEWORK_ATTACHMENT_BYTES = MAX_HOMEWORK_ATTACHMENT_MB * 1024 * 1024;

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function isEnglishSubject(subject: { name: string; slug: string }): boolean {
  const n = norm(subject.name);
  const s = norm(subject.slug);
  return n.includes("anglais") || n.includes("english") || s.includes("anglais") || s.includes("english");
}

function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export type HomeworkInput = { subjectId: string; title: string; dueDate: string; englishGroup?: string | null };
export type HomeworkData = { subjectId: string; title: string; dueDate: string; englishGroup: string | null };

export function validateHomework(
  input: HomeworkInput,
  subjects: { id: string; name: string; slug: string }[],
): { ok: true; value: HomeworkData } | { ok: false; error: string } {
  const subjectId = input.subjectId.trim();
  const title = input.title.trim();
  const dueDate = input.dueDate.trim();
  if (!subjectId) return { ok: false, error: "Veuillez choisir une matière." };
  if (!title) return { ok: false, error: "Veuillez décrire le devoir à faire." };
  if (title.length > 2000) return { ok: false, error: "Description trop longue (2000 caractères max)." };
  if (!isValidIsoDate(dueDate)) return { ok: false, error: "Date de rendu invalide (format AAAA-MM-JJ attendu)." };
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return { ok: false, error: "Matière introuvable." };
  const group = input.englishGroup?.trim() || null;
  if (group && group.length > 120) return { ok: false, error: "Nom de groupe trop long (120 caractères max)." };
  const english = isEnglishSubject(subject);
  if (english && !group) return { ok: false, error: "Veuillez préciser quel groupe d'anglais est concerné." };
  return { ok: true, value: { subjectId, title, dueDate, englishGroup: english ? group : null } };
}
