import { ACCENT_PATTERN } from "@haben/core";
import type { Letterhead } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "./company.ts";
import { loadLogo } from "./logo.ts";

/** Briefkopf von Rechnungen, Angeboten und Mahnungen: Logo und Akzentfarbe aus den Einstellungen */

export class AccentColorError extends UserError {}

/** Logo und Akzentfarbe für ein neues PDF; schon festgeschriebene Belege behalten ihr PDF */
export async function loadLetterhead(): Promise<Letterhead> {
  const [logo, company] = await Promise.all([loadLogo(), loadCompany()]);
  return { accent: company.accentColor, ...(logo ? { logo } : {}) };
}

export async function saveAccentColor(actor: string, color: string): Promise<void> {
  if (!ACCENT_PATTERN.test(color)) throw new AccentColorError("Die Akzentfarbe hat die Form #RRGGBB, z. B. #1F6F5C.");
  await loadCompany();
  await withActor(actor, (tx) => tx.update(schema.company).set({ accentColor: color.toUpperCase(), updatedAt: new Date() }).where(eq(schema.company.id, 1)));
}
