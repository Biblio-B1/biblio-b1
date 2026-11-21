import { NextResponse, type NextRequest } from "next/server";

// Edge runtime : on ne vérifie que la présence du cookie.
// La validation réelle de la session se fait dans requireUser()/getCurrentUser().
// /runtimes/ : moteurs WASM libres (clang, Pyodide), fichiers statiques sans donnée privée ; publics
// pour qu'aucune redirection vers /login ne soit mise en cache « immutable » (next.config.ts).
// Documents consultables par tout le monde (bibliothèque, fiche document, fichiers) :
// ces pages appellent getCurrentUser() et masquent ce qui exige un compte.
const PUBLIC = [
  /^\/login$/,
  /^\/signup$/,
  /^\/pending$/,
  /^\/setup$/,
  /^\/invite\/[^/]+$/,
  /^\/runtimes\//,
  /^\/library(\/[^/]+)?$/,
  /^\/doc\/[^/]+$/,
  /^\/files\//,
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.has("bb1_session")) return NextResponse.next();
  // Accueil sans compte : direction la bibliothèque publique.
  if (pathname === "/") return NextResponse.redirect(new URL("/library", req.url));
  // API : réponse JSON plutôt qu'une redirection HTML (le client affiche « session expirée »).
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
