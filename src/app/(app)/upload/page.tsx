import { getDb } from "@/server/db/client";
import { listSubjects } from "@/server/subjects";
import { UploadFlow } from "./UploadFlow";

export const metadata = { title: "Déposer des fichiers" };

export default function UploadPage() {
  const subjects = listSubjects(getDb()).map((s) => ({ id: s.id, name: s.name, color: s.color }));
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Déposer des fichiers</h1>
        <p className="text-ink-2">La matière est proposée automatiquement ; vérifiez-la puis ajoutez en un clic.</p>
      </header>
      <UploadFlow subjects={subjects} />
    </div>
  );
}
