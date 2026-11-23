// Professeurs : relevés dans les emplois du temps Boostcamp (« Enseignant : M. NOM PRÉNOM »),
// et liens pour leur écrire (messagerie de l'ordinateur ou Outlook en ligne de l'école).
import type { ScheduleEvent } from "@/lib/calendar-view";

export type FoundTeacher = { name: string; subjects: string[] };

function field(description: string, re: RegExp): string | null {
  const m = description.match(re);
  return m ? m[1].trim() : null;
}

/** Enseignants des séances, avec les matières où ils interviennent (triées), dans l'ordre d'apparition. */
export function extractTeachers(events: Pick<ScheduleEvent, "description">[]): FoundTeacher[] {
  const found = new Map<string, { name: string; subjects: Set<string> }>();
  for (const e of events) {
    if (!e.description) continue;
    const list = field(e.description, /^Enseignants?\s*:\s*(.+)$/im);
    if (!list) continue;
    const subject = field(e.description, /^Matière\s*:\s*(.+)$/im);
    for (const raw of list.split(/,\s*(?=(?:M\.|Mme|Mlle|Dr)\s)/)) {
      const name = raw.trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 80) continue;
      const key = name.toLowerCase();
      const t = found.get(key) ?? { name, subjects: new Set<string>() };
      if (subject) t.subjects.add(subject);
      found.set(key, t);
    }
  }
  return [...found.values()].map((t) => ({ name: t.name, subjects: [...t.subjects].sort((a, b) => a.localeCompare(b, "fr")) }));
}

/** « M. VANDAMME SIMON » → « M. Vandamme Simon ». */
export function displayTeacherName(name: string): string {
  return name
    .split(" ")
    .map((w) => (/^(M\.|Mme|Mlle|Dr)$/.test(w) ? w : w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())))
    .join(" ");
}

/** Liens d'écriture : mailto (messagerie installée) et brouillon Outlook en ligne (compte de l'école). */
export function mailLinks(p: { to: string[]; subject?: string; body?: string }): { mailto: string; outlook: string } {
  const to = p.to.join(",");
  const query = [
    p.subject ? `subject=${encodeURIComponent(p.subject)}` : "",
    p.body ? `body=${encodeURIComponent(p.body)}` : "",
  ].filter(Boolean);
  const outlook = new URL("https://outlook.office.com/mail/deeplink/compose");
  outlook.searchParams.set("to", to);
  if (p.subject) outlook.searchParams.set("subject", p.subject);
  if (p.body) outlook.searchParams.set("body", p.body);
  return { mailto: `mailto:${to}${query.length ? `?${query.join("&")}` : ""}`, outlook: outlook.toString() };
}
