import { MAX_OUTPUT_CHARS } from "./types.ts";

/** Accumulateur de texte plafonné à MAX_OUTPUT_CHARS. */
export class OutputBuffer {
  text = "";
  truncated = false;

  write(s: string): void {
    if (this.truncated) return;
    const room = MAX_OUTPUT_CHARS - this.text.length;
    if (s.length > room) {
      this.text += s.slice(0, room);
      this.truncated = true;
    } else {
      this.text += s;
    }
  }
}

export const TRUNCATED_NOTE = "\n[Sortie tronquée : plus de 1 000 000 caractères]\n";

export function truncationNote(...buffers: OutputBuffer[]): string {
  return buffers.some((b) => b.truncated) ? TRUNCATED_NOTE : "";
}
