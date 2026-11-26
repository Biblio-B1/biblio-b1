"use client";

import { FormSkeleton } from "@/components/Skeleton";
import { listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";
import { NoteEditor } from "./NoteEditor";

export default function NewNotePage() {
  const { data: subjects } = useData(listSubjects, []);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">Nouvelle fiche</h1>
      {subjects ? <NoteEditor subjects={subjects.map((s) => ({ id: s.id, name: s.name }))} /> : <FormSkeleton fields={2} />}
    </div>
  );
}
