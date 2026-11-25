"use client";

// Canal Telegram des alertes : pop-up proposée après le premier tutoriel, et lien des paramètres.
import { useEffect } from "react";

/** Canal Telegram des alertes (devoirs, contrôles, projets finaux). */
export const TELEGRAM_CHANNEL_URL = "https://t.me/+g1uNw0nsGGxkNDU0";

/** Lien « Rejoindre le canal » (ouvre Telegram dans un nouvel onglet). */
export function TelegramChannelLink({ className = "btn btn-primary h-9", onClick, autoFocus }: { className?: string; onClick?: () => void; autoFocus?: boolean }) {
  return (
    <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer" autoFocus={autoFocus} onClick={onClick} className={className}>
      Rejoindre le canal Telegram
    </a>
  );
}

/** Pop-up proposant de rejoindre le canal (Échap ou clic à côté pour fermer). */
export function TelegramInvite({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-3" role="dialog" aria-modal="true" aria-labelledby="telegram-title">
      <div aria-hidden className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl">
        <h2 id="telegram-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span aria-hidden>📣</span>
          Rejoindre le canal Telegram
        </h2>
        <div className="mt-2 flex flex-col gap-2 text-[14.5px] leading-relaxed text-ink-2">
          <p>Le canal envoie les alertes de la promo : nouveaux devoirs, contrôles et projets finaux, avec des rappels avant la date.</p>
          <p>Rejoins-le si tu veux être prévenu sans ouvrir le site. Le lien reste dans les paramètres.</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="btn h-9">
            Plus tard
          </button>
          <TelegramChannelLink autoFocus onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
