"use client";

// Éditeur CodeMirror 6 (chargé côté client uniquement, voir CodeExercise).
// Tab insère une indentation ; Échap puis Tab pour quitter l'éditeur au clavier.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Language } from "@/lib/runners/types";

const langExt = (l: Language) => (l === "c" ? cpp() : l === "python" ? python() : javascript());

const isDark = () => document.documentElement.classList.contains("dark");
const highlight = (dark: boolean) => syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true });

const MONO = "var(--font-jetbrains), ui-monospace, \"Cascadia Code\", monospace";

// Couleurs reprises des jetons du site (clair/sombre via les variables CSS).
const baseTheme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--ink)", fontSize: "var(--code-font-size)", borderRadius: "8px" }, // 16 px sur écran tactile (globals.css)
  "&.cm-focused": { outline: "2px solid var(--focus)", outlineOffset: "2px" },
  ".cm-content": { fontFamily: MONO, caretColor: "var(--ink)", padding: "10px 0" },
  ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6", minHeight: "14rem", maxHeight: "32rem" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--ink-3)", border: "none", borderRadius: "8px 0 0 8px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--sunken) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--line)", color: "var(--ink-2)" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--focus) 28%, transparent) !important",
  },
});

export default function CodeEditor({
  value,
  onChange,
  language,
  labelledBy,
  describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  language: Language;
  labelledBy: string;
  describedBy?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment();
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          langExt(language),
          baseTheme,
          theme.of(highlight(isDark())),
          placeholder("Votre programme…"),
          EditorView.contentAttributes.of({
            "aria-labelledby": labelledBy,
            ...(describedBy ? { "aria-describedby": describedBy } : {}),
            "aria-multiline": "true",
            role: "textbox",
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    const obs = new MutationObserver(() => v.dispatch({ effects: theme.reconfigure(highlight(isDark())) }));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      obs.disconnect();
      v.destroy();
      view.current = null;
    };
    // L'éditeur est recréé seulement si le langage change ; `value` sert de contenu initial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Remplacement externe du contenu (réinitialisation au gabarit).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="overflow-hidden rounded-lg border border-line-strong" />;
}
