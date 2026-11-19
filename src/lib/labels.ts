// Libellés partagés serveur/client (aucune dépendance Node).
export const DOC_TYPE_VALUES = ["course", "photo", "exercise", "exam", "note"] as const;
export type DocTypeValue = (typeof DOC_TYPE_VALUES)[number];

export const DOC_TYPE_LABELS: Record<DocTypeValue, string> = {
  course: "Cours",
  photo: "Photo",
  exercise: "Exercice C",
  exam: "Annale PDF",
  note: "Note/Question",
};

export const parseType = (t?: string): DocTypeValue | undefined =>
  DOC_TYPE_VALUES.includes(t as DocTypeValue) ? (t as DocTypeValue) : undefined;

export const THEME_COOKIE = "bb1_theme";
export type Theme = "light" | "dark";

export const UPLOAD_ACCEPT = ".pdf,.md,.c,.h,.py,.txt,.jpg,.jpeg,.png,.webp,.docx,.pptx";
export const MAX_UPLOAD_MB = 50;

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (d: Date) => dateFmt.format(d);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** URL publique (authentifiée) d'un fichier stocké. */
export function fileUrl(filePath: string, download = false): string {
  const p = filePath.split("/").map(encodeURIComponent).join("/");
  return `/files/${p}${download ? "?download=1" : ""}`;
}
