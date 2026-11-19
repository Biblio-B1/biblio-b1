/** Tranche de livre aux couleurs de la matière (motif récurrent de l'interface). */
export function Spine({ color, className = "h-3.5" }: { color: string | null; className?: string }) {
  return color ? (
    <span aria-hidden className={`w-[4px] shrink-0 rounded-[1px] ${className}`} style={{ background: color }} />
  ) : (
    <span aria-hidden className={`w-[4px] shrink-0 rounded-[1px] border border-dashed border-ink-3 ${className}`} />
  );
}
