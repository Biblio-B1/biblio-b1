import { ThemeToggle } from "./ThemeToggle";

const STRIPES = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c"];

/** Mise en page des pages publiques (connexion, installation, invitation). */
export function AuthShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 pb-16">
        <div className="flex items-center gap-2.5 text-[15px] font-semibold">
          <span aria-hidden className="flex h-5 items-end gap-[2px]">
            {STRIPES.map((c, i) => (
              <span key={c} className="w-[3px] rounded-[1px]" style={{ background: c, height: `${12 + ((i * 5) % 9)}px` }} />
            ))}
          </span>
          Biblio B1
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="page-title">{title}</h1>
          {intro && <div className="text-[14px] text-ink-2">{intro}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
