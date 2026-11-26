"use client";

import { Suspense } from "react";
import { PendingBanner, usePendingRequests } from "@/components/admin/PendingRequests";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Tutorial } from "@/components/Tutorial";
import { useAuth } from "@/components/auth/AuthProvider";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { countBySubject, listSubjects } from "@/lib/api/library";
import { useData } from "@/lib/api/use-data";

/**
 * Coquille des pages membres : toutes exigent un compte validé (RequireAuth ; la RLS protège de
 * toute façon les données). Barre latérale des matières + barre du haut.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const nav = useData(async () => {
    const [subjects, counts] = await Promise.all([listSubjects(), countBySubject()]);
    return { subjects, counts };
  }, []);
  const pending = usePendingRequests(isAdmin);

  const subjects = (nav.data?.subjects ?? []).map((s) => ({
    slug: s.slug,
    name: s.name,
    color: s.color,
    count: nav.data?.counts.get(s.id) ?? 0,
  }));
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={null}>
        <Sidebar
          subjects={subjects}
          unclassified={nav.data?.counts.get(null) ?? 0}
          user={profile ? { name: profile.name, role: profile.role } : null}
          pendingUsers={pending.length}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <Suspense fallback={<div className="h-14 border-b border-line" />}>
          <TopBar signedIn />
        </Suspense>
        {/* Téléphone : marge en bas pour la barre de navigation fixe (et la zone de sécurité de l'iPhone). */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8">
          <PendingBanner requests={pending} />
          {children}
        </main>
      </div>
      <BottomNav />
      <Tutorial />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Shell>{children}</Shell>
    </RequireAuth>
  );
}
