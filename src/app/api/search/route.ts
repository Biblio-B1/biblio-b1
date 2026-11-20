import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { parseSearchQuery, search } from "@/server/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q=&subject=&kind=&author=&from=&to=&limit= — le middleware ne contrôle que le cookie : la session est validée ici. */
export async function GET(req: Request) {
  await requireUser();
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = parseSearchQuery(raw);
  if (!parsed) return NextResponse.json({ error: "Paramètres de recherche invalides." }, { status: 400 });
  const results = search(getDb(), parsed.params);
  return NextResponse.json({ results });
}
