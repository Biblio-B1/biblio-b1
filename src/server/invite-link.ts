/** Adresses qui ne fonctionnent que sur la machine de l'administrateur (ou le Chromebook). */
export function isLocalHost(host: string): boolean {
  const t = host.trim().toLowerCase();
  const bracketed = t.match(/^\[([^\]]*)\](:\d+)?$/);
  const h = bracketed ? bracketed[1] : t.replace(/:\d+$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost") || h.endsWith(".linux.test");
}

export type InviteBaseInput = {
  /** APP_URL (sans « / » final), prioritaire s'il est défini. */
  appUrl?: string;
  host?: string | null;
  proto?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

/** Base des liens d'invitation ; `local` : l'adresse ne marchera pas pour les camarades. */
export function inviteBaseUrl(i: InviteBaseInput): { base: string; local: boolean } {
  if (i.appUrl) return { base: i.appUrl.replace(/\/+$/, ""), local: false };
  const host = i.forwardedHost?.split(",")[0].trim() || i.host?.trim() || "localhost:3000";
  const local = isLocalHost(host);
  const proto = i.forwardedProto?.split(",")[0].trim() || i.proto || (local || /^[\d.]+(:\d+)?$/.test(host) ? "http" : "https");
  return { base: `${proto}://${host}`, local };
}

export function inviteLink(token: string, base: string): string {
  return `${base}/invite/${encodeURIComponent(token)}`;
}
