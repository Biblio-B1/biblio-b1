import { Spine } from "@/components/layout/Spine";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { formatKeywordLines, listSubjects, type SubjectRules } from "@/server/subjects";
import { createSubjectAction, updateSubjectAction } from "./actions";
import { SubjectForm } from "./SubjectForm";

export const metadata = { title: "Matières et règles" };

const rulesOf = (r: unknown): SubjectRules =>
  r && typeof r === "object" && "pathPatterns" in r && "keywords" in r
    ? (r as SubjectRules)
    : { pathPatterns: [], keywords: {} };

export default async function SubjectsAdminPage() {
  await requireUser("admin");
  const subjects = listSubjects(getDb());
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
            <h2 id={`subj-${s.id}`} className="flex items-center gap-2 font-semibold">
              <Spine color={s.color} className="h-4" />
              {s.name}
              <code className="font-mono text-[12.5px] font-normal text-ink-3">{s.slug}</code>
            </h2>
            <SubjectForm
              idPrefix={s.id}
              action={updateSubjectAction.bind(null, s.id)}
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
          action={createSubjectAction}
          resetOnSuccess
          submitLabel="Ajouter la matière"
          initial={{ name: "", color: "#0891b2", pathPatterns: "", keywords: "" }}
        />
      </section>
    </div>
  );
}
