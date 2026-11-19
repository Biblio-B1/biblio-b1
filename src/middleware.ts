import { NextResponse, type NextRequest } from "next/server";

// Edge runtime : on ne vérifie que la présence du cookie.
// La validation réelle de la session se fait dans requireUser()/getCurrentUser().
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/invite\/[^/]+$/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.has("bb1_session")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
