// Publication immédiate sur le canal Telegram : après l'ajout d'un devoir ou d'un contrôle (pièces
// jointes comprises), on demande l'envoi tout de suite au lieu d'attendre le passage de 5 minutes.
// Si l'appel échoue, le passage planifié publie quand même l'annonce.
import { getSupabase } from "@/lib/supabase/client";

export function publishNow(): void {
  void getSupabase()
    .rpc("channel_flush")
    .then(
      () => undefined,
      () => undefined,
    );
}
