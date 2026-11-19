// Coloration syntaxique Shiki partagée serveur / navigateur.
// Moteur regex JavaScript (pas de WASM) et jeu de langages restreint :
// léger côté client, identique côté serveur.
import type { HighlighterCore } from "shiki/core";

export const LANGS = {
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  shellscript: () => import("shiki/dist/langs/shellscript.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  makefile: () => import("shiki/dist/langs/makefile.mjs"),
  asm: () => import("shiki/dist/langs/asm.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
} as const;

type Lang = keyof typeof LANGS | "text";

const ALIASES: Record<string, Lang> = {
  c: "c", h: "c", cpp: "cpp", "c++": "cpp", hpp: "cpp",
  py: "python", python: "python",
  sh: "shellscript", bash: "shellscript", shell: "shellscript", zsh: "shellscript", shellscript: "shellscript", console: "shellscript",
  js: "javascript", javascript: "javascript", json: "json",
  make: "makefile", makefile: "makefile", asm: "asm", s: "asm", nasm: "asm",
  sql: "sql", java: "java", md: "markdown", markdown: "markdown",
};

export function resolveLang(name: string | undefined): Lang {
  return ALIASES[(name ?? "").toLowerCase()] ?? "text";
}

let hl: Promise<HighlighterCore> | undefined;

function highlighter(): Promise<HighlighterCore> {
  hl ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/dist/themes/github-light.mjs"), import("shiki/dist/themes/github-dark.mjs")],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return hl;
}

/** HTML coloré (thèmes clair + sombre via variables CSS). Le code est échappé par Shiki. */
export async function highlight(code: string, langName: string | undefined): Promise<string> {
  const h = await highlighter();
  const lang = resolveLang(langName);
  if (lang !== "text" && !h.getLoadedLanguages().includes(lang)) {
    await h.loadLanguage((await LANGS[lang]()).default);
  }
  return h.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: "light",
  });
}
