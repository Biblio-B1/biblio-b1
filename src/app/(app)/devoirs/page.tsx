import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listHomeworks } from "@/server/homeworks";
import { listSubjects } from "@/server/subjects";
import { HomeworkClient } from "./HomeworkClient";

export const metadata = { title: "Devoirs" };
export const dynamic = "force-dynamic";

export default async function DevoirsPage() {
  await requireUser();
  const db = getDb();
  const subjects = listSubjects(db).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    color: s.color,
  }));
  const homeworks = listHomeworks(db);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Devoirs</h1>
        <p className="text-ink-2">
          Espace collaboratif : ajoutez et consultez les devoirs à rendre, visibles et mis à jour pour toute la classe.
        </p>
      </header>
      <HomeworkClient subjects={subjects} homeworks={homeworks} />
    </div>
  );
}
