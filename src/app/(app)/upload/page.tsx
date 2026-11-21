"use client";

import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { UploadFlow } from "./UploadFlow";

export default function UploadPage() {
  const { data: subjects } = useData(listSubjects, []);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Déposer des fichiers</h1>
        <p className="text-ink-2">La matière est proposée automatiquement ; vérifiez-la puis ajoutez en un clic.</p>
      </header>
      {subjects ? (
        <UploadFlow subjects={subjects.map((s) => ({ id: s.id, name: s.name, color: s.color }))} />
      ) : (
        <p className="text-sm text-ink-3">Chargement…</p>
      )}
    </div>
  );
}
