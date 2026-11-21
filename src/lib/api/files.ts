// Fichiers privés (bucket « files ») : jamais d'URL publique, seulement des URL signées de courte
// durée, délivrées aux comptes actifs (politique files_select).
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { FILES_BUCKET, getSupabase } from "@/lib/supabase/client";

export const SIGNED_URL_TTL = 3600;

/** Chemin dans le bucket : identique au file_path enregistré (sans « / » initial). */
export function storagePathOf(filePath: string): string {
  return filePath.replace(/^\/+/, "");
}

export async function signedFileUrl(
  filePath: string,
  opts: { download?: string | boolean } = {},
  supabase: Pick<SupabaseClient, "storage"> = getSupabase(),
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(storagePathOf(filePath), SIGNED_URL_TTL, opts.download ? { download: opts.download } : undefined);
  if (error || !data?.signedUrl) throw new Error(`Fichier indisponible (${error?.message ?? "lien non créé"}).`);
  return data.signedUrl;
}

/** URL signée pour l'affichage (null pendant le chargement, "" si indisponible). */
export function useSignedUrl(filePath: string | null | undefined, download?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setUrl(null);
    signedFileUrl(filePath, { download })
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(""));
    return () => {
      cancelled = true;
    };
  }, [filePath, download]);
  return url;
}
