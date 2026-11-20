import { eq } from "drizzle-orm";
import { normalize } from "./classify";
import type { Db } from "./db/client";
import { subjects, type exercises } from "./db/schema";
import { getExercise } from "./progress";

type ExerciseRow = typeof exercises.$inferSelect;

export type ExerciseCheckResult = {
  correct: boolean;
  language: "c" | "python" | "generic";
  issues: string[];
  explanation: string;
  answer: string;
};

function detectLanguage(
  ex: Pick<ExerciseRow, "statement" | "solution">,
  subjectSlug: string | undefined,
  code: string,
): "c" | "python" | "generic" {
  const sample = `${code}\n${ex.solution ?? ""}`;
  const pyScore =
    (/\bdef\s+\w+\s*\(/.test(sample) ? 2 : 0) +
    (/\bprint\s*\(/.test(sample) ? 1 : 0) +
    (/\brange\s*\(/.test(sample) ? 1 : 0) +
    (/\belif\b/.test(sample) ? 2 : 0) +
    (!/[;{}]/.test(code) && /\b(for|while|if)\b.*:\s*$/m.test(code) ? 2 : 0);

  const cScore =
    (/#include\b/.test(sample) ? 3 : 0) +
    (/\b(printf|scanf|malloc|calloc|free)\s*\(/.test(sample) ? 2 : 0) +
    (/\bint\s+main\s*\(/.test(sample) ? 3 : 0) +
    (subjectSlug === "algorithmique-et-prog-c" ? 2 : 0) +
    (/[;{}]/.test(code) ? 1 : 0);

  if (pyScore > cScore && pyScore >= 2) return "python";
  if (cScore >= 1 || /\b(c|pointeur|tableau|fonction|boucle)\b/.test(normalize(ex.statement))) return "c";
  return "generic";
}

type StripResult = {
  stripped: string;
  unclosedLiteral: boolean;
  unclosedComment: boolean;
};

/** Supprime les commentaires et littéraux en conservant les sauts de ligne pour garder les numéros de ligne. */
function stripCommentsAndLiterals(code: string, language: "c" | "python" | "generic"): StripResult {
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let quote: string | null = null;
  let unclosedLiteral = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        out += "  ";
        i++;
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (ch === "\n" && quote !== '"""' && quote !== "'''") {
        unclosedLiteral = true;
        quote = null;
        out += "\n";
        continue;
      }
      if (quote.length === 3 && code.slice(i, i + 3) === quote) {
        quote = null;
        out += "   ";
        i += 2;
        continue;
      }
      if (quote.length === 1 && ch === quote) {
        quote = null;
        out += " ";
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      continue;
    }

    if (language !== "python" && ch === "/" && next === "/") {
      inLineComment = true;
      out += "  ";
      i++;
      continue;
    }
    if (language !== "python" && ch === "/" && next === "*") {
      inBlockComment = true;
      out += "  ";
      i++;
      continue;
    }
    if (language === "python" && ch === "#") {
      inLineComment = true;
      out += " ";
      continue;
    }
    if (language === "python" && (code.slice(i, i + 3) === '"""' || code.slice(i, i + 3) === "'''")) {
      quote = code.slice(i, i + 3);
      out += "   ";
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += " ";
      continue;
    }
    out += ch;
  }

  if (quote) unclosedLiteral = true;
  return { stripped: out, unclosedLiteral, unclosedComment: inBlockComment };
}

function checkDelimiterBalance(stripped: string): string | null {
  const stack: { ch: string; line: number }[] = [];
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const expectedOpen: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
  let line = 1;

  for (const ch of stripped) {
    if (ch === "\n") {
      line++;
      continue;
    }
    if (pairs[ch]) {
      stack.push({ ch, line });
    } else if (expectedOpen[ch]) {
      const top = stack.pop();
      if (!top) {
        return `Symbole '${ch}' inattendu à la ligne ${line} (aucun '${expectedOpen[ch]}' ouvert).`;
      }
      if (top.ch !== expectedOpen[ch]) {
        return `Délimiteur incohérent à la ligne ${line} : '${ch}' trouvé alors que '${pairs[top.ch]}' était attendu (ouvert à la ligne ${top.line}).`;
      }
    }
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    return `Délimiteur '${last.ch}' ouvert à la ligne ${last.line} jamais fermé ('${pairs[last.ch]}' manquant).`;
  }
  return null;
}

function checkCSpecifics(code: string, stripped: string): string[] {
  const issues: string[] = [];

  const typoMatchers: [RegExp, string][] = [
    [/\b(?:pirntf|pritnf|printff)\b/, "Faute de frappe détectée : utilisez 'printf' (et non une variante mal orthographiée)."],
    [/\b(?:sacnf|scnaf|scnaf)\b/, "Faute de frappe détectée : utilisez 'scanf'."],
    [/\bretrun\b/, "Faute de frappe détectée : utilisez 'return'."],
    [/\bviod\b/, "Faute de frappe détectée : utilisez 'void'."],
    [/#\s*inculde\b/, "Directive mal orthographiée : utilisez '#include'."],
  ];
  for (const [re, msg] of typoMatchers) {
    if (re.test(stripped)) issues.push(msg);
  }

  // Assignation '=' au lieu de comparaison '==' dans if(...) ou while(...)
  const condRe = /\b(?:if|while)\s*\(([^()]*)\)/g;
  for (const m of stripped.matchAll(condRe)) {
    const cond = m[1];
    if (/(?<![=!<>])=(?!=)/.test(cond)) {
      issues.push("Affectation '=' utilisée dans une condition if/while au lieu de l'opérateur de comparaison '=='.");
      break;
    }
  }

  // Points-virgules manquants sur les instructions simples
  const rawLines = code.split(/\r?\n/);
  const strippedLines = stripped.split(/\r?\n/);
  for (let i = 0; i < strippedLines.length; i++) {
    const line = strippedLines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (/[;{},:\\]$/.test(line)) continue;
    // Ignorer en-têtes de structures de contrôle ou signatures de fonctions suivies de '{'
    if (/^(?:if|else\s+if|for|while|switch)\s*\(.*\)$/.test(line)) continue;
    if (/^else$/.test(line)) continue;
    if (/^(?:[a-zA-Z_][\w*\s]+)\s+[a-zA-Z_]\w*\s*\([^)]*\)$/.test(line)) {
      const nextLine = strippedLines.slice(i + 1).find((l) => l.trim().length > 0)?.trim() ?? "";
      if (nextLine.startsWith("{")) continue;
    }
    const looksLikeStatement =
      /^(?:return\b|break\b|continue\b)/.test(line) ||
      /\b(?:printf|scanf|free|puts|putchar)\s*\([^)]*\)\s*$/.test(line) ||
      /^(?:int|long|short|char|float|double|unsigned|size_t)\s+.*[^)]$/.test(line) ||
      /^[a-zA-Z_*][\w\s*\[\]]*\s*(?:\+=|-=|\*=|\/=|%=|=)\s*.+$/.test(line) ||
      /^(?:[a-zA-Z_]\w*(?:\+\+|--)|(?:\+\+|--)[a-zA-Z_]\w*)$/.test(line);
    if (looksLikeStatement) {
      const nextNonEmpty = strippedLines.slice(i + 1).find((l) => l.trim().length > 0)?.trim() ?? "";
      if (!/^[+\-*/%&|^?:.]/.test(nextNonEmpty)) {
        issues.push(`Point-virgule ';' manquant à la fin de la ligne ${i + 1} (« ${rawLines[i]?.trim() ?? line} »).`);
        break;
      }
    }
  }

  const hasProgramStructure = /\bint\s+main\s*\(/.test(stripped) || /#\s*include\b/.test(code);
  if (hasProgramStructure) {
    if (/\b(?:printf|scanf)\s*\(/.test(stripped) && !/#\s*include\s*<\s*stdio\.h\s*>/.test(code)) {
      issues.push("Directive '#include <stdio.h>' manquante pour utiliser printf/scanf.");
    }
    if (/\b(?:malloc|calloc|realloc|free)\s*\(/.test(stripped) && !/#\s*include\s*<\s*stdlib\.h\s*>/.test(code)) {
      issues.push("Directive '#include <stdlib.h>' manquante pour utiliser malloc/calloc/free.");
    }
  }

  // scanf("%d", x) sans '&' pour les variables scalaires simples
  const scanfRe = /\bscanf\s*\(\s*"([^"]*)"\s*,\s*([^)]+)\)/g;
  for (const m of code.matchAll(scanfRe)) {
    const fmt = m[1];
    const args = m[2].split(",").map((a) => a.trim());
    if (/%[difluc]/.test(fmt) && !/%s/.test(fmt)) {
      for (const arg of args) {
        if (/^[a-zA-Z_]\w*$/.test(arg) && !new RegExp(`\\*\\s*${arg}\\b|\\b${arg}\\s*\\[`).test(code)) {
          issues.push(`Dans scanf, passez l'adresse de la variable avec '&' (ex. : '&${arg}') et non '${arg}' directement.`);
          break;
        }
      }
    }
  }

  // Fonction non-void sans return
  const fnRe = /\b(?:int|float|double|char|long|size_t)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  for (const m of stripped.matchAll(fnRe)) {
    const startIdx = m.index! + m[0].length;
    let depth = 1;
    let pos = startIdx;
    while (pos < stripped.length && depth > 0) {
      if (stripped[pos] === "{") depth++;
      else if (stripped[pos] === "}") depth--;
      pos++;
    }
    const body = stripped.slice(startIdx, pos);
    if (!/\breturn\b/.test(body)) {
      issues.push(`La fonction '${m[1]}' doit renvoyer une valeur avec 'return'.`);
    }
  }

  return issues;
}

function checkPythonSpecifics(code: string, stripped: string): string[] {
  const issues: string[] = [];
  const lines = stripped.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^(?:def\s+\w+\s*\(.*\)|if\s+.+|elif\s+.+|else|for\s+.+\s+in\s+.+|while\s+.+)$/.test(line) && !line.endsWith(":")) {
      issues.push(`Deux-points ':' manquant à la fin de la ligne ${i + 1} (« ${code.split(/\r?\n/)[i]?.trim()} »).`);
      break;
    }
  }
  if (/^\s*(?:pass|\.\.\.)\s*$/m.test(stripped) && stripped.replace(/\bpass\b|\.\.\./g, "").trim().length < 25) {
    issues.push("La fonction contient uniquement 'pass' ou '...' sans implémentation.");
  }
  return issues;
}

function buildFallbackAnswer(ex: Pick<ExerciseRow, "title" | "statement">, lang: "c" | "python" | "generic"): string {
  const ctx = normalize(`${ex.title}\n${ex.statement}`);

  if (lang === "python") {
    if (/\b(somme|sum)\b/.test(ctx)) {
      return `def somme(n):\n    total = 0\n    for i in range(1, n + 1):\n        total += i\n    return total`;
    }
    if (/\b(produit|product|factorielle|factorial)\b/.test(ctx)) {
      return `def produit(n):\n    res = 1\n    for i in range(1, n + 1):\n        res *= i\n    return res`;
    }
    return `def resoudre(n):\n    # Adapter selon les paramètres de l'énoncé\n    resultat = 0\n    for i in range(n):\n        resultat += i\n    return resultat`;
  }

  if (/\b(echang\w*|swap\w*)\b/.test(ctx) && /\b(pointeurs?|pointers?)\b/.test(ctx)) {
    return `#include <stdio.h>\n\nvoid echanger(int *a, int *b) {\n    int tmp = *a;\n    *a = *b;\n    *b = tmp;\n}`;
  }
  if (/\b(maximum|max)\b/.test(ctx) && /\b(tableaux?|arrays?)\b/.test(ctx)) {
    return `int maximum(const int t[], int n) {\n    int max = t[0];\n    for (int i = 1; i < n; i++) {\n        if (t[i] > max) {\n            max = t[i];\n        }\n    }\n    return max;\n}`;
  }
  if (/\b(invers\w*|reverse\w*)\b/.test(ctx) && /\b(tableaux?|arrays?)\b/.test(ctx)) {
    return `void inverser(int t[], int n) {\n    for (int i = 0; i < n / 2; i++) {\n        int tmp = t[i];\n        t[i] = t[n - 1 - i];\n        t[n - 1 - i] = tmp;\n    }\n}`;
  }
  if (/\b(sommes?|sums?)\b/.test(ctx)) {
    return `int somme(int n) {\n    int s = 0;\n    for (int i = 1; i <= n; i++) {\n        s += i;\n    }\n    return s;\n}`;
  }
  if (/\b(produits?|products?|factorielles?|factorials?)\b/.test(ctx)) {
    return `int produit(int n) {\n    int p = 1;\n    for (int i = 1; i <= n; i++) {\n        p *= i;\n    }\n    return p;\n}`;
  }
  if (/\b(premiers?|primes?)\b/.test(ctx)) {
    return `int est_premier(int n) {\n    if (n < 2) return 0;\n    for (int d = 2; d * d <= n; d++) {\n        if (n % d == 0) return 0;\n    }\n    return 1;\n}`;
  }

  return `#include <stdio.h>\n\nint main(void) {\n    // Implémenter la logique demandée par l'énoncé\n    return 0;\n}`;
}

function checkSemantics(
  ex: Pick<ExerciseRow, "title" | "statement" | "solution">,
  stripped: string,
  language: "c" | "python" | "generic",
): string[] {
  const issues: string[] = [];
  const ctx = normalize(`${ex.title}\n${ex.statement}`);
  const sol = ex.solution ?? "";

  // Code vide / purement commentaire / stub trivial
  const compact = stripped.replace(/\s+/g, "");
  if (compact.length < 4) {
    issues.push("Le code soumis ne contient aucune instruction exécutable.");
    return issues;
  }
  if (/^\s*int\s+main\s*\(\s*(?:void)?\s*\)\s*\{\s*return\s+0\s*;\s*\}\s*$/.test(stripped) && compact.length < 45) {
    issues.push("Le squelette main() est vide : aucune logique de résolution n'est implémentée.");
  }

  // Vérification des concepts attendus
  const needsLoop =
    /\b(boucle|loop|1 a n|1 to n|tableau|tableaux|array|parcourir|somme|sum|produit|product|factorielle|factorial|afficher les)\b/.test(ctx) ||
    /\b(for|while)\b/.test(sol);
  if (needsLoop && !/\b(for|while)\b/.test(stripped)) {
    issues.push("L'énoncé nécessite un parcours répétitif (boucle 'for' ou 'while') qui est absent de votre code.");
  }

  const needsPointers =
    /\b(pointeurs?|pointers?|adresses?|address)\b/.test(ctx) ||
    (/\b(echang\w*|swap\w*)\b/.test(ctx) && language === "c") ||
    /\b\w+\s*\*\s*\w+/.test(sol);
  if (needsPointers && language === "c" && !/\*/.test(stripped)) {
    issues.push("Cet exercice demande l'utilisation de pointeurs ('*' pour déclarer/déréférencer et '&' pour passer l'adresse).");
  }

  const needsCondition =
    /\b(maximum|minimum|max|min|pair|impair|even|odd|premiers?|primes?|compar\w*|positif|negatif)\b/.test(ctx) ||
    (/\bif\b/.test(sol) && !/\bfor\b/.test(sol));
  if (needsCondition && !/\bif\b|\?/.test(stripped)) {
    issues.push("Une structure conditionnelle ('if' / 'else') est attendue pour comparer ou tester les valeurs.");
  }

  // Erreurs classiques sur somme / produit
  if (/\b(sommes?|sums?)\b/.test(ctx) && !/\b(produits?|products?)\b/.test(ctx)) {
    if (/\b[a-zA-Z_]\w*\s*\*=\s*/.test(stripped) && !/\+=|\+/.test(stripped)) {
      issues.push("Pour calculer une somme, il faut additionner ('+=' ou '+') et non multiplier ('*=').");
    }
  }
  if (/\b(produits?|products?|factorielles?|factorials?)\b/.test(ctx) && !/\b(sommes?|sums?)\b/.test(ctx)) {
    if (/\b(?:int|long|double|float)?\s*(?:p|prod|produit|res|fact)\s*=\s*0\s*;?/.test(stripped)) {
      issues.push("L'accumulateur d'un produit doit être initialisé à 1 (s'il vaut 0, le résultat restera toujours 0).");
    }
    if (/\+=/.test(stripped) && !/\*=|\*/.test(stripped)) {
      issues.push("Pour un produit ou une factorielle, il faut multiplier ('*=' ou '*') et non additionner ('+=').");
    }
  }

  // Si l'exercice attend un échange de variables
  if (/\b(echang\w*|swap\w*)\b/.test(ctx) && language === "c") {
    const bodyMatches = stripped.match(/\*[a-zA-Z_]\w*\s*=\s*\*?[a-zA-Z_]\w*/g) ?? [];
    if (/\*/.test(stripped) && bodyMatches.length < 2 && !/\btmp\b|\btemp\b|\baux\b/.test(stripped)) {
      issues.push("Pour échanger deux valeurs via des pointeurs sans en écraser une, passez par une variable temporaire (ex. : int tmp = *a; *a = *b; *b = tmp;).");
    }
  }

  return issues;
}

function buildExplanation(
  ex: Pick<ExerciseRow, "title" | "statement" | "solution" | "hints">,
  issues: string[],
  language: "c" | "python" | "generic",
): string {
  const parts: string[] = [];

  if (issues.length > 0) {
    parts.push("Erreurs ou manques identifiés dans votre code :");
    for (const issue of issues) {
      parts.push(`• ${issue}`);
    }
    parts.push("");
  } else {
    parts.push("Votre code respecte la syntaxe et les structures attendues pour cet exercice.");
    parts.push("");
  }

  parts.push("Démarche et explication :");
  const ctx = normalize(`${ex.title}\n${ex.statement}`);
  if (/\b(echang\w*|swap\w*)\b/.test(ctx) && language === "c") {
    parts.push(
      "1. Passez les adresses des deux variables en paramètres avec des pointeurs (`int *a, int *b`).",
      "2. Sauvegardez la valeur pointée par `a` dans une variable temporaire (`int tmp = *a;`).",
      "3. Copiez `*b` dans `*a`, puis placez `tmp` dans `*b`.",
    );
  } else if (/\b(sommes?|sums?)\b/.test(ctx)) {
    parts.push(
      "1. Initialisez un accumulateur à `0` (élément neutre de l'addition).",
      "2. Parcourez les valeurs avec une boucle (`for` ou `while`) et ajoutez chaque terme à l'accumulateur (`+=`).",
      "3. Renvoyez ou affichez le total obtenu à la fin de la boucle.",
    );
  } else if (/\b(produits?|products?|factorielles?|factorials?)\b/.test(ctx)) {
    parts.push(
      "1. Initialisez l'accumulateur à `1` (et non à `0`, car `0 * x = 0`).",
      "2. Multipliez successivement chaque facteur dans une boucle (`*=`).",
      "3. Renvoyez ou affichez le produit final.",
    );
  } else if (/\b(maximum|minimum|max|min)\b/.test(ctx)) {
    parts.push(
      "1. Initialisez le maximum/minimum avec le premier élément (`t[0]`).",
      "2. Parcourez le reste des éléments et mettez à jour la valeur retenue avec `if` dès qu'une meilleure valeur est trouvée.",
      "3. Renvoyez le résultat après la boucle.",
    );
  } else if (/\b(invers\w*|reverse\w*)\b/.test(ctx)) {
    parts.push(
      "1. Parcourez seulement la première moitié du tableau (`i < n / 2`).",
      "2. Échangez `t[i]` avec son symétrique `t[n - 1 - i]` à l'aide d'une variable temporaire.",
    );
  } else {
    parts.push(
      "1. Identifiez les entrées nécessaires et les types adaptés.",
      "2. Structurez le traitement (conditions, boucles ou fonctions/pointeurs selon la consigne).",
      "3. Comparez votre implémentation avec la réponse de référence ci-dessous.",
    );
  }

  const hints = (ex.hints ?? []).filter((h) => h.trim());
  if (hints.length > 0) {
    parts.push("", "Indices associés :", ...hints.map((h) => `• ${h.trim()}`));
  }

  return parts.join("\n");
}

/**
 * Analyse le code soumis par l'étudiant pour un exercice donné.
 * Si le code est faux ou incomplet, renvoie les erreurs détectées, une explication pédagogique et la réponse attendue.
 */
export function checkExerciseCode(db: Db, exerciseId: string, submittedCode: string): ExerciseCheckResult {
  const ex = getExercise(db, exerciseId);
  if (!ex) throw new Error("Exercice introuvable.");

  const subject = ex.subjectId
    ? db.select({ slug: subjects.slug }).from(subjects).where(eq(subjects.id, ex.subjectId)).get()
    : undefined;
  const language = detectLanguage(ex, subject?.slug, submittedCode);
  const answer = ex.solution?.trim() || buildFallbackAnswer(ex, language);
  const code = submittedCode.trim();

  if (!code) {
    const issues = ["Aucun code n'a été saisi."];
    return {
      correct: false,
      language,
      issues,
      explanation: buildExplanation(ex, issues, language),
      answer,
    };
  }

  const { stripped, unclosedLiteral, unclosedComment } = stripCommentsAndLiterals(code, language);
  const issues: string[] = [];

  if (unclosedLiteral) {
    issues.push("Chaîne de caractères ou littéral ('...' ou \"...\") non fermé.");
  }
  if (unclosedComment) {
    issues.push("Commentaire multi-lignes '/*' non fermé par '*/'.");
  }
  const balanceErr = checkDelimiterBalance(stripped);
  if (balanceErr) issues.push(balanceErr);

  if (language === "c") {
    issues.push(...checkCSpecifics(code, stripped));
  } else if (language === "python") {
    issues.push(...checkPythonSpecifics(code, stripped));
  }

  issues.push(...checkSemantics(ex, stripped, language));

  const uniqueIssues = [...new Set(issues)];
  const correct = uniqueIssues.length === 0;

  return {
    correct,
    language,
    issues: uniqueIssues,
    explanation: buildExplanation(ex, uniqueIssues, language),
    answer,
  };
}
