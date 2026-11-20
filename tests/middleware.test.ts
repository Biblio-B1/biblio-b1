import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

describe("middleware", () => {
  it("/api sans cookie : JSON 401 ; page sans cookie : redirection /login", async () => {
    const api = middleware(new NextRequest("http://x.test/api/search?q=a"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "unauthorized" });
    const page = middleware(new NextRequest("http://x.test/training"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://x.test/login");
  });

  it("avec cookie ou page publique : passe", () => {
    const withCookie = new NextRequest("http://x.test/api/search", { headers: { cookie: "bb1_session=abc" } });
    expect(middleware(withCookie).headers.get("x-middleware-next")).toBe("1");
    expect(middleware(new NextRequest("http://x.test/login")).headers.get("x-middleware-next")).toBe("1");
    expect(middleware(new NextRequest("http://x.test/signup")).headers.get("x-middleware-next")).toBe("1");
  });

  it("moteurs WASM (/runtimes/) publics : jamais de redirection (mise en cache immutable)", () => {
    const r = middleware(new NextRequest("http://x.test/runtimes/clang/22.0.0-git20695-13/bundle.js"));
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(middleware(new NextRequest("http://x.test/runtimesX")).status).toBe(307);
  });

  it("documents publics : bibliothèque, fiche, fichiers ; accueil → bibliothèque", () => {
    for (const p of ["/library", "/library/infra-data", "/doc/0b5c2d1e-1111-4222-8333-944455556666", "/files/uploads/imported/x.pdf"]) {
      expect(middleware(new NextRequest(`http://x.test${p}`)).headers.get("x-middleware-next"), p).toBe("1");
    }
    const home = middleware(new NextRequest("http://x.test/"));
    expect(home.headers.get("location")).toBe("http://x.test/library");
    for (const p of ["/upload", "/notes/new", "/admin/invites", "/library/a/b"]) {
      expect(middleware(new NextRequest(`http://x.test${p}`)).status, p).toBe(307);
    }
  });
});
