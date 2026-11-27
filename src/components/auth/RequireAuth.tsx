"use client";

// Garde d'accès des pages : visiteur → connexion, compte en attente → page d'attente, page admin
// pour un non-admin → accueil. Confort d'affichage uniquement : la vraie barrière est la RLS.
import { PageSkeleton } from "@/components/Skeleton";
import { isModerator } from "@/lib/roles";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

/** Pages d'ajout ou de réglages personnels : inutiles en mode invité (lecture seule). */
const GUEST_BLOCKED = ["/upload", "/notes/new", "/settings", "/admin"];

export function RequireAuth({
  admin = false,
  moderator = false,
  children,
}: {
  admin?: boolean;
  /** Administrateur ou délégué(e). */
  moderator?: boolean;
  children: React.ReactNode;
}) {
  const { session, profile, loading, isGuest } = useAuth();
  const router = useRouter();
  const pathname = (usePathname() || "/").replace(/\/$/, "") || "/";
  const target = loading
    ? null
    : !session
      ? "/login"
      : profile && profile.status !== "active"
        ? "/pending"
        : isGuest && GUEST_BLOCKED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
          ? "/"
          : admin && profile && profile.role !== "admin"
          ? "/"
          : moderator && profile && !isModerator(profile.role)
            ? "/"
            : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (loading || target || !profile) {
    return (
      <PageSkeleton />
    );
  }
  return <>{children}</>;
}
