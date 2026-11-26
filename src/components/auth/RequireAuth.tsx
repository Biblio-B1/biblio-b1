"use client";

// Garde d'accès des pages : visiteur → connexion, compte en attente → page d'attente, page admin
// pour un non-admin → accueil. Confort d'affichage uniquement : la vraie barrière est la RLS.
import { PageSkeleton } from "@/components/Skeleton";
import { isModerator } from "@/lib/roles";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

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
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const target = loading
    ? null
    : !session
      ? "/login"
      : profile && profile.status !== "active"
        ? "/pending"
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
