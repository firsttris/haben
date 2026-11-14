import { parseOrigin, parsePortalFirmen, type PortalFirma } from "@haben/core";
import { z } from "zod";

/*
 * Konfiguration des Portals (#504, Stufe 2) aus der Umgebung. Wie Haben startet das Portal mit einer fehlerhaften
 * Angabe nicht und nennt die Variable; die Regeln für den OIDC-Client sind dieselben wie in apps/web/src/server/env.ts.
 */

export interface PortalConfig {
  /** Origin des Portals, z. B. https://portal.example.de; daraus die Redirect-URI /callback */
  url: string;
  /** Schlüssel für die Signatur der Cookies */
  secret: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Leer: openid profile email, dazu groups, wenn die Discovery es nennt */
  scopes?: string[];
  displayName: string;
  groupsClaim: string;
  firmen: PortalFirma[];
  /** Ob http für loopback-Adressen des Anmeldedienstes gilt (nicht mit NODE_ENV=production) */
  httpLoopback: boolean;
}

const schema = z.object({
  /** Öffentliche Adresse des Portals */
  PORTAL_URL: z.string().refine((value) => parseOrigin(value) !== null, "nur https://domain ohne Pfad, Query und Zugangsdaten (http nur für localhost)"),
  PORTAL_SECRET: z.string().min(32, "mindestens 32 Zeichen, etwa aus openssl rand -base64 32"),
  /** Name|https://adresse|inhaber-gruppe je Firma, getrennt durch ; (parsePortalFirmen) */
  PORTAL_FIRMEN: z.string().default(""),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_SCOPES: z.string().optional(),
  OIDC_DISPLAY_NAME: z.string().trim().min(1).max(80).default("SSO"),
  /** Name genau eines Claims, kein Pfad und kein Ausdruck; dieselbe Regel wie in Haben */
  OIDC_GROUPS_CLAIM: z
    .string()
    // Punkte nur in URL-förmigen Namen (OIDC Core 5.1.2, kollisionsfrei): „realm_access.roles“ sähe wie ein Pfad aus
    .regex(/^(?:https?:\/\/[A-Za-z0-9_:/.-]{1,92}|[A-Za-z0-9_:/-]{1,100})$/, "ein einzelner Claimname aus Buchstaben, Ziffern, _ : / - oder eine URL")
    .default("groups"),
  NODE_ENV: z.string().optional(),
});

/** Liest und prüft die Umgebung; im Fehlerfall je Variable eine Zeile */
export function ladeKonfiguration(quelle: Record<string, string | undefined>): { config: PortalConfig } | { fehler: string[] } {
  // Leere Werte gelten als nicht gesetzt, wie in einer .env mit „OIDC_SCOPES=“
  const werte = Object.fromEntries(Object.entries(quelle).filter(([, wert]) => wert !== undefined && wert.trim() !== ""));
  const ergebnis = schema.safeParse(werte);
  if (!ergebnis.success) return { fehler: ergebnis.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  const env = ergebnis.data;
  const firmen = parsePortalFirmen(env.PORTAL_FIRMEN);
  if ("fehler" in firmen) return { fehler: [`PORTAL_FIRMEN: ${firmen.fehler}`] };
  // Wie Haben: ohne openid käme kein ID-Token, jede Anmeldung schlüge erst dann fehl
  if (env.OIDC_SCOPES && !env.OIDC_SCOPES.trim().split(/\s+/).includes("openid")) return { fehler: ["OIDC_SCOPES: muss openid enthalten"] };
  const httpLoopback = env.NODE_ENV !== "production";
  const issuer = new URL(env.OIDC_ISSUER);
  if (!(issuer.protocol === "https:" || (httpLoopback && issuer.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname)))) {
    return { fehler: ["OIDC_ISSUER: nur https (http nur für localhost außerhalb von NODE_ENV=production)"] };
  }
  return {
    config: {
      url: parseOrigin(env.PORTAL_URL)!,
      secret: env.PORTAL_SECRET,
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      scopes: env.OIDC_SCOPES?.trim().split(/\s+/),
      displayName: env.OIDC_DISPLAY_NAME,
      groupsClaim: env.OIDC_GROUPS_CLAIM,
      firmen: firmen.firmen,
      httpLoopback,
    },
  };
}
