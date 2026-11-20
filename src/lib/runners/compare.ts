// Comparaison de sorties : `\r\n` = `\n`, espaces de fin de ligne et lignes vides finales ignorés.

export function normalizeOutput(s: string): string {
  const lines = s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}
