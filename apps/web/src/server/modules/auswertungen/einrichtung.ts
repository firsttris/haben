import { frequencyAt, isKapitalgesellschaft } from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { BEREICH_IDS } from "../../../lib/bereiche.ts";
import { type Antworten, offeneFragen, SELBSTAENDIG, type Selbstaendig, type Stand, type Steuerangaben, steuerangabenNach } from "../../../lib/einrichtung.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { hasEmployees } from "../lohn/index.ts";
import { type Company, loadCompany } from "../stammdaten/index.ts";
import { loadFrequencies, saveFrequencyIn } from "../umsatzsteuer/index.ts";
import { lockedChange, settingsLocks, type SettingsLocks } from "./settings-guard.ts";

/*
 * Fragen zur Einrichtung (#266). Die Antworten gehen in die vorhandenen Felder der Firmendaten und den
 * Voranmeldungszeitraum, mit denselben Sperren wie dort (settings-guard.ts, zeitraum.ts); dazu die ausgeblendeten
 * Bereiche. Alles in einer Transaktion: Scheitert eine Sperre, bleibt auch der Rest, wie er war.
 */

export const einrichtungSchema = z.object({
  selbstaendig: z.enum(Object.keys(SELBSTAENDIG) as [Selbstaendig, ...Selbstaendig[]]).nullable(),
  kleinunternehmer: z.boolean().nullable(),
  versteuerung: z.enum(["ist", "soll"]).nullable(),
  voranmeldung: z.enum(["monatlich", "vierteljaehrlich"]).nullable(),
  ohneVorsteuerabzug: z.boolean().nullable(),
  kontenrahmen: z.enum(["SKR03", "SKR04"]).nullable(),
  bereiche: z.partialRecord(z.enum(BEREICH_IDS), z.boolean()),
}) satisfies z.ZodType<Antworten>;

const monat = (today: string) => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });

function steuerangaben(company: Company, voranmeldung: Steuerangaben["voranmeldung"]): Steuerangaben {
  const { rechtsform, einkunftsart, kleinunternehmer, versteuerung, ohneVorsteuerabzug, kontenrahmen } = company;
  return { rechtsform, einkunftsart, kleinunternehmer, versteuerung, ohneVorsteuerabzug, kontenrahmen, voranmeldung };
}

async function standIn(today: string, q: Db | Tx): Promise<Stand> {
  const company = await loadCompany(q);
  return {
    ...steuerangaben(company, frequencyAt(await loadFrequencies(q), monat(today))),
    eingerichtet: company.einrichtungAt !== null,
    firmendatenGespeichert: company.companySavedAt !== null,
    einrichtungOffen: company.einrichtungOffen,
    ausgeblendet: company.ausgeblendeteBereiche,
    hatMitarbeiter: await hasEmployees(),
  };
}

/** Stand zum Vorausfüllen und warum sich etwas gerade nicht ändern lässt */
export async function einrichtungStand(today: string): Promise<{ stand: Stand; locks: SettingsLocks }> {
  return { stand: await standIn(today, db), locks: await settingsLocks(today) };
}

export async function einrichtungSpeichern(actor: string, antworten: Antworten, today: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await loadCompany(tx);
    // Firmenzeile sperren wie beim Speichern der Firmendaten: Eine gleichzeitige Änderung wartet
    await tx.select({ id: schema.company.id }).from(schema.company).where(eq(schema.company.id, 1)).for("update");
    const stand = await standIn(today, tx);
    const nachher = steuerangabenNach(stand, antworten);
    const current = await loadCompany(tx);
    const locked = lockedChange(current, nachher, await settingsLocks(today, tx));
    if (locked) throw new UserError(locked);
    if (isKapitalgesellschaft(nachher.rechtsform) && Object.values(current.privateShares).some(Boolean)) {
      throw new UserError("Privatanteile gibt es nur im Einzelunternehmen. Erst in den Firmendaten entfernen, dann die Rechtsform ändern.");
    }
    const { voranmeldung, ...firma } = nachher;
    await tx
      .update(schema.company)
      .set({
        ...firma,
        // Nur „nein“ blendet aus; „ja“ und „weiß ich noch nicht“ zeigen den Bereich
        ausgeblendeteBereiche: BEREICH_IDS.filter((id) => antworten.bereiche[id] === false).sort(),
        einrichtungAt: sql`clock_timestamp()`,
        einrichtungOffen: offeneFragen(antworten),
        // Wie bewusst gespeicherte Firmendaten erst, wenn Kleinunternehmer beantwortet ist: Die Vorgabe „nein“ bestätigt sonst
        // eine Regelbesteuerung, die niemand gewählt hat (stammdaten/company.ts, kleinunternehmerStand)
        ...(antworten.kleinunternehmer === null ? {} : { companySavedAt: sql`clock_timestamp()` }),
        updatedAt: new Date(),
      })
      .where(eq(schema.company.id, 1));
    // Ab Januar wie auf der Seite der Voranmeldung; passt eine gesendete nicht mehr, lehnt saveFrequencyIn ab
    if (voranmeldung !== stand.voranmeldung) await saveFrequencyIn(tx, { year: monat(today).year, fromMonth: 1, frequency: voranmeldung });
  });
}
