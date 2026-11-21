"use client";

import { RequireAuth } from "@/components/auth/RequireAuth";
import type { FormState } from "@/components/ActionForm";
import { Spine } from "@/components/layout/Spine";
import { listSubjects } from "@/lib/api/library";
import { createSubjectAction, deleteSubjectAction, updateSubjectAction } from "@/lib/api/subjects";
import { useData } from "@/lib/api/use-data";
import { formatKeywordLines, type SubjectRules } from "@/lib/subject-rules";
import { SubjectForm } from "./SubjectForm";

const rulesOf = (r: unknown): SubjectRules =>
  r && typeof r === "object" && "pathPatterns" in r && "keywords" in r
    ? (r as SubjectRules)
    : { pathPatterns: [], keywords: {} };

function SubjectsAdmin() {
  const { data: subjects, reload } = useData(listSubjects, []);
  // Recharge la liste après chaque enregistrement réussi.
  const then =
    (fn: (prev: FormState, fd: FormData) => Promise<FormState>) =>
    async (prev: FormState, fd: FormData): Promise<FormState> => {
      const r = await fn(prev, fd);
      if (r && !r.error) reload();
      return r;
    };
  if (!subjects) return <p className="text-sm text-ink-3">Chargement…</p>;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Matières et règles de classement</h1>
        <p className="max-w-[70ch] text-ink-2">
          Chaque motif reconnu dans le nom ou le chemin d&apos;un fichier ajoute 10 points ; chaque mot-clé trouvé dans le
          texte ajoute son poids (5 occurrences au plus). La matière la mieux notée est proposée à partir de 3 points.
        </p>
      </header>

      {subjects.map((s) => {
        const rules = rulesOf(s.rules);
        return (
          <section key={s.id} aria-labelledby={`subj-${s.id}`} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`subj-${s.id}`} className="flex items-center gap-2 font-semibold">
                <Spine color={s.color} className="h-4" />
                {s.name}
                <code className="font-mono text-[12.5px] font-normal text-ink-3">{s.slug}</code>
              </h2>
              <form
                action={async () => {
                  await deleteSubjectAction(s.id);
                  reload();
                }}
              >
                <button type="submit" className="btn btn-ghost h-8 px-2 text-[13px] text-danger">
                  Supprimer
                </button>
              </form>
            </div>
            <SubjectForm
              idPrefix={s.id}
              action={then(updateSubjectAction.bind(null, s.id))}
              submitLabel="Enregistrer"
              initial={{
                name: s.name,
                color: s.color,
                pathPatterns: rules.pathPatterns.join("\n"),
                keywords: formatKeywordLines(rules.keywords),
              }}
            />
          </section>
        );
      })}

      <section aria-labelledby="new-subject" className="flex flex-col gap-4 rounded-lg border border-dashed border-line-strong p-4 md:p-5">
        <h2 id="new-subject" className="font-semibold">
          Ajouter une matière
        </h2>
        <SubjectForm
          idPrefix="new"
          action={then(createSubjectAction)}
          resetOnSuccess
          submitLabel="Ajouter la matière"
          initial={{ name: "", color: "#0891b2", pathPatterns: "", keywords: "" }}
        />
      </section>
    </div>
  );
}

export default function SubjectsAdminPage() {
  return (
    <RequireAuth admin>
      <SubjectsAdmin />
    </RequireAuth>
  );
}
