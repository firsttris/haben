import { EXPENSE_CATEGORY_KEYS } from "@haben/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import type { Tx } from "../../db/index.ts";
import { geprueft, mitBezeichnung, UserError } from "../../errors.ts";
import { firmendatenUebernehmen } from "../auswertungen/index.ts";
import { insertImportedOwnAccount, refreshOwnAccountNames } from "../eigene-konten/index.ts";
import { customPageInputSchema, insertCustomPage } from "../eigene-seiten/index.ts";
import { mailCommonSchema, putMailTemplates } from "../mail/index.ts";
import { nummernformateUebernehmen, standardanhaengeUebernehmen } from "../rechnungen/index.ts";
import {
  artikelUebernehmen,
  einheitenUebernehmen,
  einrichtungUebernehmen,
  firmaErgaenzen,
  gestaltungUebernehmen,
  kontakteUebernehmen,
  textbausteineUebernehmen,
  alteStandardEinleitungen,
} from "../stammdaten/index.ts";
import { saveFrequencyIn } from "../umsatzsteuer/index.ts";
import { procedureDetailsSchema, putProcedureDetails } from "../verfahrensdoku/index.ts";
import { readSettingsZip, type SettingsFile } from "./lesen.ts";
import { nichtNeuMeldung, schonAngelegt } from "./neu.ts";

/*
 * Einstellungsdatei in eine neue Instanz übernehmen (#488): Datei lesen und prüfen, dann alles in einer Transaktion,
 * jeder Teil über das Modul, dem die Tabelle gehört, mit den Prüfungen seiner Formulare. Schlägt ein Teil fehl, bleibt
 * die Instanz, wie sie war, und die Meldung nennt den Eintrag.
 */

export class InstanzwechselError extends UserError {}

export interface SettingsImportResult {
  contacts: number;
  articles: number;
  textBlocks: number;
  layouts: number;
  /** Absender und Vorlagen der E-Mails: übernommen, oder nicht, weil der Versand hier noch nicht eingerichtet ist; null = keine in der Datei */
  mail: boolean | null;
}

/** Wie die Frage zur Voranmeldung in der Einrichtung: ein Wechsel im Jahr nur zu Beginn eines Quartals */
const frequencySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  fromMonth: z.union([z.literal(1), z.literal(4), z.literal(7), z.literal(10)]),
  frequency: z.enum(["monatlich", "vierteljaehrlich", "keine"]),
});

const ownAccountSchema = z.object({
  kontenrahmen: z.enum(["SKR03", "SKR04"]),
  account: z.string(),
  name: z.string(),
  parentCategory: z.enum(EXPENSE_CATEGORY_KEYS),
  archivedAt: z.string().min(1).nullable(),
});

export async function importSettings(actor: string, archive: Uint8Array, today: string): Promise<SettingsImportResult> {
  const datei = readSettingsZip(archive);
  const result = await withActor(actor, async (tx) => {
    // Zwei Übernahmen gleichzeitig sähen beide eine leere Instanz
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('haben-einstellungen-uebernehmen', 0))`);
    const belegt = await schonAngelegt(tx);
    if (belegt.length > 0) throw new InstanzwechselError(nichtNeuMeldung(belegt));
    return uebernehmen(tx, actor, datei, today);
  });
  // Die Namen eigener Konten stehen in einem Cache, den erst die bestätigte Transaktion füllen darf
  await refreshOwnAccountNames();
  return result;
}

async function uebernehmen(tx: Tx, actor: string, datei: SettingsFile, today: string): Promise<SettingsImportResult> {
  if (datei.company) {
    await firmendatenUebernehmen(tx, datei.company, today);
    await firmaErgaenzen(tx, datei.company);
    await nummernformateUebernehmen(tx, datei.company);
  }
  // Nach den Firmendaten, sonst erledigte deren Speichern die offenen Fragen aus der Datei
  if (datei.einrichtung) await einrichtungUebernehmen(tx, datei.einrichtung);
  // In der Reihenfolge der Datei (Jahr, Monat): saveFrequencyIn ersetzt im selben Jahr alles ab dem Monat
  for (const raw of datei.vatFrequencies) await saveFrequencyIn(tx, geprueft(frequencySchema, raw, "Voranmeldungszeitraum"));
  await gestaltungUebernehmen(tx, { profiles: datei.letterheadProfiles, logo: datei.logo, background: datei.background, layouts: datei.layouts });
  // Einheiten vor den Artikeln, Kontakte vor ihren Ansprechpartnern und Textbausteinen
  await einheitenUebernehmen(tx, datei.units);
  await artikelUebernehmen(tx, datei.articles);
  await kontakteUebernehmen(tx, actor, datei.contacts, datei.contactPersons);
  await textbausteineUebernehmen(tx, datei.textBlocks);
  if (datei.company) await alteStandardEinleitungen(tx, datei.company);
  for (const raw of datei.ownAccounts) {
    const konto = geprueft(ownAccountSchema, raw, "Eigenes Konto");
    await mitBezeichnung(`Eigenes Konto ${konto.account}`, () => insertImportedOwnAccount(tx, actor, { ...konto, archived: konto.archivedAt !== null }));
  }
  await standardanhaengeUebernehmen(tx, datei.quoteDefaultAttachments);
  for (const raw of datei.customPages) {
    const seite = geprueft(customPageInputSchema, raw, "Eigene Seite");
    await mitBezeichnung(`Eigene Seite „${seite.name}“`, () => insertCustomPage(tx, seite));
  }
  if (datei.procedureDetails) await putProcedureDetails(tx, geprueft(procedureDetailsSchema, datei.procedureDetails, "Angaben zur Verfahrensdokumentation"));
  const mail = datei.mail ? await putMailTemplates(tx, geprueft(mailCommonSchema, datei.mail, "E-Mail")) : null;
  return { contacts: datei.contacts.length, articles: datei.articles.length, textBlocks: datei.textBlocks.length, layouts: datei.layouts.length, mail };
}
