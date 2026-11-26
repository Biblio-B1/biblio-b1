import { describe, expect, it } from "vitest";
import { authorizeUrl, isSchoolEmail, outlookErrorMessage, outlookRedirectUri, pkceChallenge, readIdToken } from "@/lib/outlook-link";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("liaison Outlook (Microsoft, PKCE)", () => {
  it("défi PKCE : exemple de la RFC 7636", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("adresse d'autorisation : code + PKCE, retour sur /outlook/, connexion de l'école", () => {
    const redirectUri = outlookRedirectUri("https://biblio-b1.github.io", "/biblio-b1");
    expect(redirectUri).toBe("https://biblio-b1.github.io/biblio-b1/outlook/");
    const u = new URL(authorizeUrl({ clientId: "abc", redirectUri, state: "s", nonce: "n", challenge: "c", loginHint: "lea.martin@edu.ece.fr" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "abc",
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge: "c",
      code_challenge_method: "S256",
      domain_hint: "edu.ece.fr",
      login_hint: "lea.martin@edu.ece.fr",
      scope: "openid profile email",
    });
  });

  it("lit l'adresse du compte dans l'id_token (accents compris)", () => {
    const token = `x.${b64url({ preferred_username: "Lea.Martin@edu.ece.fr", name: "Léa Martin", nonce: "n1" })}.sig`;
    expect(readIdToken(token)).toEqual({ email: "lea.martin@edu.ece.fr", name: "Léa Martin", nonce: "n1" });
    expect(isSchoolEmail("lea.martin@edu.ece.fr")).toBe(true);
    expect(isSchoolEmail("lea@gmail.com")).toBe(false);
  });

  it("messages d'erreur compréhensibles", () => {
    expect(outlookErrorMessage("access_denied")).toBe("Liaison annulée.");
    expect(outlookErrorMessage("invalid_request", "AADSTS65001: The user or administrator has not consented")).toMatch(/administrateur de l'école/);
  });
});
