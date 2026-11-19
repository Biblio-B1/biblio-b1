import { highlight } from "@/lib/highlight";

const MAX_HIGHLIGHT = 200_000;

/** Code source coloré côté serveur (Shiki, thèmes clair/sombre), numéros de ligne. */
export async function CodeView({ code: raw, lang }: { code: string; lang?: string }) {
  const code = raw.replace(/\r?\n$/, "");
  if (code.length > MAX_HIGHLIGHT) {
    return <pre className="shiki overflow-x-auto bg-surface font-mono text-[13.5px]">{code}</pre>;
  }
  const html = await highlight(code, lang);
  return <div className="code-lines" dangerouslySetInnerHTML={{ __html: html }} />;
}
