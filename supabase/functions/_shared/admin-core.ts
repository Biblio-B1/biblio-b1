// Règle du refus d'une demande de compte : seul un administrateur actif refuse, et seulement un
// compte encore en attente (jamais un compte actif : la suppression est définitive).
export type ProfileState = { role: "admin" | "member"; status: "active" | "pending" };

export function canReject(caller: ProfileState | null, target: Pick<ProfileState, "status"> | null): boolean {
  return caller?.role === "admin" && caller.status === "active" && target?.status === "pending";
}
