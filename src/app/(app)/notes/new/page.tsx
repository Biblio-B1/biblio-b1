import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listSubjects } from "@/server/subjects";
import { NoteEditor } from "./NoteEditor";

export const metadata = { title: "Nouvelle fiche" };

export default async function NewNotePage() {
  await requireUser();
  const subjects = listSubjects(getDb()).map((s) => ({ id: s.id, name: s.name }));
  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">Nouvelle fiche</h1>
      <NoteEditor subjects={subjects} />
    </div>
  );
}
