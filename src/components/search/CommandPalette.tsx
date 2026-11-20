"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconSearch } from "@/components/layout/Icons";
import { DOC_TYPE_LABELS, DOC_TYPE_VALUES, type DocTypeValue } from "@/lib/labels";

export type PaletteResult = {
  kind: DocTypeValue;
  refId: string;
  entity: string;
  title: string;
  snippet: string; // HTML sûr : échappé côté serveur, seules les balises <mark> subsistent
  href: string;
};

/** Palette de recherche globale (cmdk) : Ctrl K / Cmd K ou clic sur la barre du haut. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!open || !term) {
      seq.current++;
      setResults([]);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    const mine = ++seq.current;
    setState("loading");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${new URLSearchParams({ q: term, limit: "20" })}`, { signal: ctrl.signal });
        if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error("search");
        const data = (await res.json()) as { results: PaletteResult[] };
        if (mine !== seq.current) return;
        setResults(data.results);
        setState("done");
      } catch (e) {
        if ((e as Error).name === "AbortError" || mine !== seq.current) return;
        setResults([]);
        setState("error");
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ("");
      }}
      shouldFilter={false}
      label="Recherche globale"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="fixed top-[8vh] left-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <IconSearch className="shrink-0 text-ink-3" size={16} />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="Rechercher un cours, un exercice, une note…"
          aria-label="Rechercher"
          className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
        {state === "loading" && results.length === 0 && <div className="px-3 py-6 text-center text-[14px] text-ink-3">Recherche…</div>}
        {state === "error" && <div className="px-3 py-6 text-center text-[14px] text-danger">La recherche a échoué. Réessayez.</div>}
        {state === "done" && results.length === 0 && <div className="px-3 py-6 text-center text-[14px] text-ink-3">Aucun résultat pour « {q.trim()} ».</div>}
        {state === "idle" && <div className="px-3 py-6 text-center text-[14px] text-ink-3">Tapez pour chercher dans les cours, exercices et notes.</div>}
        {DOC_TYPE_VALUES.map((type) => {
          const items = results.filter((r) => r.kind === type);
          if (!items.length) return null;
          return (
            <Command.Group
              key={type}
              heading={DOC_TYPE_LABELS[type]}
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3"
            >
              {items.map((r) => (
                <Command.Item
                  key={`${r.entity}-${r.refId}`}
                  value={`${r.entity}-${r.refId}`}
                  onSelect={() => go(r.href)}
                  className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 data-[selected=true]:bg-sunken"
                >
                  <span className="truncate text-[14px] font-medium text-ink">{r.title}</span>
                  {r.snippet && (
                    <span className="snippet line-clamp-2 text-[13px] text-ink-2" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
        {q.trim() && state !== "error" && (
          <Command.Group>
            <Command.Item
              value="__all"
              onSelect={() => go(`/search?${new URLSearchParams({ q: q.trim() })}`)}
              className="cursor-pointer rounded-md px-2.5 py-2 text-[13px] text-ink-2 data-[selected=true]:bg-sunken"
            >
              Voir tous les résultats avec filtres
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
