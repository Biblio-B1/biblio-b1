import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { countBySubject } from "@/server/library";
import { listSubjects } from "@/server/subjects";

export const dynamic = "force-dynamic";

/** Coquille des pages authentifiées : sidebar matières + barre du haut. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = getDb();
  const counts = countBySubject(db);
  const subjects = listSubjects(db).map((s) => ({
    slug: s.slug,
    name: s.name,
    color: s.color,
    count: counts.get(s.id) ?? 0,
  }));
  return (
    <div className="flex min-h-dvh">
      <Sidebar subjects={subjects} unclassified={counts.get(null) ?? 0} user={{ name: user.name, role: user.role }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 border-b border-line" />}>
          <TopBar />
        </Suspense>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
