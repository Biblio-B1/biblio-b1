import Link from "next/link";
import { Spine } from "@/components/layout/Spine";
import { DOC_TYPE_LABELS, formatDate } from "@/lib/labels";
import type { Document, Subject } from "@/lib/api/types";
import { docHref } from "@/lib/routes";

/** Liste de documents façon étagère : tranche colorée de la matière + titre + méta. */
export function DocumentList({
  docs,
  subjects,
  showSubject = true,
  empty,
}: {
  docs: Document[];
  subjects: Subject[];
  showSubject?: boolean;
  empty?: React.ReactNode;
}) {
  if (docs.length === 0) return <div className="rounded-lg border border-dashed border-line-strong p-6 text-ink-2">{empty}</div>;
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {docs.map((d) => {
        const s = d.subjectId ? byId.get(d.subjectId) : undefined;
        return (
          <li key={d.id}>
            <Link href={docHref(d.id)} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4">
              <Spine color={s?.color ?? null} className="h-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{d.title}</span>
                <span className="block truncate text-[13px] text-ink-3">
                  {DOC_TYPE_LABELS[d.type]}
                  {showSubject && (s ? `, ${s.name}` : ", sans matière")}
                  {!d.subjectConfirmed && s ? " (à confirmer)" : ""}
                </span>
              </span>
              <time className="hidden shrink-0 text-[13px] text-ink-3 tabular-nums sm:block" dateTime={d.createdAt.toISOString()}>
                {formatDate(d.createdAt)}
              </time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** `extra` : paramètres à conserver (ex. { slug } pour une matière). */
export function TypeFilter({ active, base, q, extra = {} }: { active?: string; base: string; q?: string; extra?: Record<string, string> }) {
  const href = (t?: string) => {
    const p = new URLSearchParams(extra);
    if (t) p.set("type", t);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const items: [string | undefined, string][] = [[undefined, "Tout"], ...Object.entries(DOC_TYPE_LABELS)];
  return (
    <nav aria-label="Filtrer par type" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map(([t, label]) => (
        <Link
          key={label}
          href={href(t)}
          aria-current={active === t ? "page" : undefined}
          className={`h-8 shrink-0 rounded-full border px-3 text-[13.5px] leading-[30px] transition-colors ${
            active === t ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
