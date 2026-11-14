import { ACCENT_PATTERN } from "@haben/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import type { Logo } from "@haben/einvoice";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "./company.ts";
import { loadLogo, logoInfo } from "./logo.ts";

/*
 * Zeichen der Firma in der Navigation (#504): Wer mehrere Firmen als eigene Instanzen führt, erkennt die Firma an einer
 * eigenen Farbe des „H“ oder am Logo. Die Einstellung ist absichtlich von der Beleggestaltung getrennt: Akzentfarbe und
 * Layout der Belege lassen sich ändern, ohne dass sich das Zeichen ändert, und Firmen mit gleich aussehenden Belegen
 * bekommen trotzdem verschiedene Zeichen. Das Logo der Belege gibt es nur auf ausdrückliche Wahl.
 */

export class NavMarkError extends UserError {}

export const navMarkSchema = z.discriminatedUnion("art", [
  z.object({ art: z.literal("standard") }),
  z.object({ art: z.literal("farbe"), farbe: z.string().max(7) }),
  z.object({ art: z.literal("logo") }),
]);
export type NavMarkInput = z.infer<typeof navMarkSchema>;

export interface NavMarkSetting {
  /** Eigene Farbe des „H“ (#RRGGBB) oder null für die Farbe des Themes */
  color: string | null;
  /** Logo der Belege statt des „H“, solange es eins gibt */
  logo: boolean;
}

export async function loadNavMark(): Promise<NavMarkSetting> {
  const company = await loadCompany();
  return { color: company.navColor, logo: company.navLogo };
}

/**
 * Speichert die Wahl. Die Farbe bleibt bei „Logo“ erhalten: Fehlt das Logo später, zeigt die Navigation wieder die
 * Farbe, und die Karte bietet sie beim Zurückwechseln an. „Standard“ löscht beides.
 */
export async function saveNavMark(actor: string, input: NavMarkInput): Promise<void> {
  const choice = navMarkSchema.parse(input);
  if (choice.art === "farbe" && !ACCENT_PATTERN.test(choice.farbe)) throw new NavMarkError("Die Farbe hat die Form #RRGGBB, z. B. #1D4ED8.");
  const set =
    choice.art === "standard"
      ? { navColor: null, navLogo: false }
      : choice.art === "farbe"
        ? { navColor: choice.farbe.toUpperCase(), navLogo: false }
        : { navLogo: true };
  await loadCompany();
  await withActor(actor, async (tx) => {
    if (choice.art === "logo" && (await tx.select({ id: schema.companyLogo.id }).from(schema.companyLogo)).length === 0) {
      throw new NavMarkError("Es gibt noch kein Logo. Lade es unter Einstellungen › Beleggestaltung hoch.");
    }
    await tx
      .update(schema.company)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.company.id, 1));
  });
}

/** Das Zeichen für Betreiber (#1036): `haben status --json` gibt es aus, das Instanzen-Werkzeug bringt es ins Firmenportal */
export interface NavMarkStand {
  /** Eigene Farbe (#RRGGBB); bleibt auch bei „Logo“ gesetzt und gilt, wenn das Logo fehlt */
  farbe: string | null;
  /** Logo als Zeichen gewählt und vorhanden; an der Prüfsumme erkennt das Werkzeug ein neues Logo, ohne es zu laden */
  logo: { format: "png" | "jpg"; sha256: string } | null;
}

/** Wahl der Firma, nur lesend: Anders als `loadCompany` legt das keine Firma an, `haben status` schreibt nichts */
async function gewaehlt(): Promise<{ navColor: string | null; navLogo: boolean } | undefined> {
  const [row] = await db.select({ navColor: schema.company.navColor, navLogo: schema.company.navLogo }).from(schema.company).where(eq(schema.company.id, 1));
  return row;
}

/** Wie die Navigation (`navMark` in lib/navigation.ts): das Logo nur, wenn es gewählt ist und es eins gibt */
export async function readNavMark(): Promise<NavMarkStand> {
  const wahl = await gewaehlt();
  const info = wahl?.navLogo ? await logoInfo() : null;
  return { farbe: wahl?.navColor ?? null, logo: info ? { format: info.format, sha256: info.sha256 } : null };
}

/** Das Logo als Zeichen für `haben kennzeichen`; undefined, wenn es nicht gewählt ist oder fehlt (wie /api/kennzeichen) */
export async function readNavMarkLogo(): Promise<Logo | undefined> {
  return (await gewaehlt())?.navLogo ? await loadLogo() : undefined;
}
