import Link from "next/link";
import { Spine } from "@/components/layout/Spine";
import { PROGRESS_STATUS_LABELS, type ProgressStatusValue } from "@/lib/labels";

const DOT: Record<ProgressStatusValue, string> = {
  todo: "border border-line-strong text-ink-3",
  doing: "border border-ink text-ink",
  mastered: "bg-ink text-bg border border-ink",
};

export function ExerciseCard({
  id,
  title,
  number,
  lang,
  status,
  subjectName,
  color,
}: {
  id: string;
  title: string;
  number: number;
  lang: string;
  status: ProgressStatusValue;
  subjectName?: string;
  color: string | null;
}) {
  return (
    <li>
      <Link href={`/training/${id}`} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4">
        <Spine color={color} className="h-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{title}</span>
          <span className="block truncate text-[13px] text-ink-3">
            Exercice {number}
            {subjectName ? `, ${subjectName}` : ""}, {lang.toUpperCase()}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12.5px] ${DOT[status]}`}>{PROGRESS_STATUS_LABELS[status]}</span>
      </Link>
    </li>
  );
}
