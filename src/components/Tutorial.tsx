"use client";

// Tutoriel de première connexion. S'ouvre tout seul tant que le profil n'a pas tutorial_done_at,
// et à la demande (événement TUTORIAL_EVENT, bouton « Revoir le tutoriel » des paramètres).
// Chaque étape met en avant le lien du menu concerné (sur ordinateur, menu visible).
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { MENU_CLOSE_EVENT, MENU_EVENT } from "@/components/layout/Sidebar";
import { getSupabase } from "@/lib/supabase/client";
import { TUTORIAL_STEPS, targetSelector } from "@/lib/tutorial";

export const TUTORIAL_EVENT = "bb1-tutorial";

/** Téléphone : le menu est un tiroir fermé, qu'il faut ouvrir pour montrer ses liens. */
const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

type Rect = { top: number; left: number; width: number; height: number };

function visibleRect(selector: string): Rect | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  return null;
}

export function Tutorial() {
  const { profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Première connexion (compte validé) : on ouvre le tutoriel une fois.
  useEffect(() => {
    if (profile?.status === "active" && profile.tutorial_done_at === null) {
      setStep(0);
      setOpen(true);
    }
  }, [profile?.status, profile?.tutorial_done_at]);

  useEffect(() => {
    const onOpen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TUTORIAL_EVENT, onOpen);
    return () => window.removeEventListener(TUTORIAL_EVENT, onOpen);
  }, []);

  const finish = useCallback(async () => {
    setOpen(false);
    if (isPhone()) window.dispatchEvent(new Event(MENU_CLOSE_EVENT));
    if (profile && !profile.tutorial_done_at) {
      await getSupabase().from("profiles").update({ tutorial_done_at: new Date().toISOString() }).eq("id", profile.id);
      await refreshProfile();
    }
  }, [profile, refreshProfile]);

  const current = TUTORIAL_STEPS[step];
  const last = step === TUTORIAL_STEPS.length - 1;

  // Position du lien mis en avant (recalculée au défilement et au redimensionnement).
  useLayoutEffect(() => {
    if (!open || !current?.target) {
      setRect(null);
      if (open && isPhone()) window.dispatchEvent(new Event(MENU_CLOSE_EVENT));
      return;
    }
    const sel = targetSelector(current.target);
    const update = () => setRect(visibleRect(sel));
    // Sur téléphone, on ouvre le menu puis on mesure le lien une fois le tiroir affiché.
    if (isPhone()) window.dispatchEvent(new Event(MENU_EVENT));
    update();
    const raf = window.requestAnimationFrame(() => {
      for (const el of document.querySelectorAll(sel)) {
        if (el.getBoundingClientRect().width > 0) {
          el.scrollIntoView({ block: "nearest" });
          break;
        }
      }
      update();
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, TUTORIAL_STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open || !current) return null;

  const pad = 6;
  // Téléphone : la carte se place en haut si le lien mis en avant est dans la moitié basse.
  const cardOnTop = rect !== null && rect.top + rect.height / 2 > window.innerHeight / 2;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-body">
      {rect ? (
        // Halo autour du lien du menu : l'ombre géante assombrit tout le reste de la page.
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg outline-2 outline-offset-2 outline-focus outline-solid transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.7), 0 0 18px 4px var(--focus)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/70" />
      )}

      <div
        className={`absolute inset-x-3 mx-auto max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl sm:inset-x-6 md:bottom-auto md:top-1/2 md:-translate-y-1/2 ${
          cardOnTop ? "top-3" : "bottom-3"
        } ${
          rect ? "md:left-72 md:right-auto md:mx-0 md:w-[28rem]" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-ink-3">
            Tutoriel · {step + 1}/{TUTORIAL_STEPS.length}
          </p>
          <button type="button" onClick={() => void finish()} className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink">
            Passer le tutoriel
          </button>
        </div>
        <h2 id="tutorial-title" className="mt-2 flex items-center gap-2 text-lg font-semibold text-ink">
          <span aria-hidden>{current.emoji}</span>
          {current.title}
        </h2>
        <div id="tutorial-body" className="mt-2 flex flex-col gap-2 text-[14.5px] leading-relaxed text-ink-2">
          {current.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        {current.href && (
          <Link
            href={current.href.path}
            onClick={() => void finish()}
            className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-2"
          >
            {current.href.label} maintenant →
          </Link>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex gap-1" aria-hidden>
            {TUTORIAL_STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-ink" : "w-1.5 bg-line-strong"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn h-9">
                Précédent
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? void finish() : setStep(step + 1))}
              className="btn btn-primary h-9"
            >
              {last ? "C'est parti !" : step === 0 ? "Commencer" : "Suivant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
