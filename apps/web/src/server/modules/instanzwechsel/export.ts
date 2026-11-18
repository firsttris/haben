import { asc } from "drizzle-orm";
import { readAppVersion } from "../../db/app-version.ts";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { today } from "../../today.ts";
import { auswahl, FELDER } from "./felder.ts";
import { embed, withChecksum } from "./integritaet.ts";

/*
 * Einstellungen und Stammdaten als eine JSON-Datei für eine neue Instanz (#488): etwa nach dem Testen, um im neuen
 * Geschäftsjahr mit frischer Datenbank, aber ohne neue Einrichtung zu beginnen. Was mitgeht und was nicht, steht in
 * felder.ts. Dateien (Logo, Briefpapier, Standardanhänge) stehen als Base64 mit ihrem SHA-256 darin, die ganze Datei
 * trägt eine Prüfsumme (integritaet.ts). Sie enthält persönliche Angaben, Steuernummer und Bankverbindung, aber keine
 * Geheimnisse.
 */

export const SETTINGS_EXPORT_FORMAT = "haben-einstellungen";
export const SETTINGS_EXPORT_VERSION = 1;

export function settingsExportFilename(now = new Date()): string {
  return `Haben-Einstellungen-${today(now)}.json`;
}

/** Liest alles aus einem Stand, damit etwa ein Textbaustein nicht auf einen Kontakt zeigt, der in der Datei fehlt */
export async function exportSettings(now = new Date()) {
  return db.transaction(
    async (tx) => {
      const f = FELDER;
      const [firma] = await tx.select(auswahl(f.company)).from(schema.company);
      const [einrichtung] = await tx.select(auswahl(f.einrichtung)).from(schema.einrichtung);
      const profile = await tx.select(auswahl(f.letterheadProfiles)).from(schema.letterheadProfiles).orderBy(asc(schema.letterheadProfiles.name));
      const [logo] = await tx.select(auswahl(f.companyLogo)).from(schema.companyLogo);
      const [briefpapier] = await tx.select(auswahl(f.letterheadBackground)).from(schema.letterheadBackground);
      const layouts = await tx.select(auswahl(f.belegLayouts)).from(schema.belegLayouts).orderBy(asc(schema.belegLayouts.name));
      const units = await tx.select(auswahl(f.units)).from(schema.units).orderBy(asc(schema.units.label));
      const articles = await tx.select(auswahl(f.articles)).from(schema.articles).orderBy(asc(schema.articles.description), asc(schema.articles.id));
      const contacts = await tx.select(auswahl(f.contacts)).from(schema.contacts).orderBy(asc(schema.contacts.name), asc(schema.contacts.id));
      const contactPersons = await tx
        .select(auswahl(f.contactPersons))
        .from(schema.contactPersons)
        .orderBy(asc(schema.contactPersons.contactId), asc(schema.contactPersons.name), asc(schema.contactPersons.id));
      const textBlocks = await tx.select(auswahl(f.textBlocks)).from(schema.textBlocks).orderBy(asc(schema.textBlocks.name), asc(schema.textBlocks.id));
      const ownAccounts = await tx.select(auswahl(f.ownAccounts)).from(schema.ownAccounts).orderBy(asc(schema.ownAccounts.account));
      const [mail] = await tx.select(auswahl(f.mailSettings)).from(schema.mailSettings);
      const anhaenge = await tx
        .select(auswahl(f.quoteDefaultAttachments))
        .from(schema.quoteDefaultAttachments)
        .orderBy(asc(schema.quoteDefaultAttachments.createdAt), asc(schema.quoteDefaultAttachments.id));
      const customPages = await tx.select(auswahl(f.customPages)).from(schema.customPages).orderBy(asc(schema.customPages.name));
      const [verfahrensdoku] = await tx.select(auswahl(f.procedureDetails)).from(schema.procedureDetails);
      return withChecksum({
        format: SETTINGS_EXPORT_FORMAT,
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: now.toISOString(),
        appVersion: readAppVersion(),
        company: firma ?? null,
        einrichtung: einrichtung ?? null,
        letterheadProfiles: profile,
        logo: logo ? { format: logo.format, ...embed(logo.logo) } : null,
        background: briefpapier ? { format: briefpapier.format, ...embed(briefpapier.background) } : null,
        layouts,
        units,
        articles,
        contacts,
        contactPersons,
        textBlocks,
        ownAccounts,
        mail: mail ?? null,
        quoteDefaultAttachments: await Promise.all(anhaenge.map(async ({ sha256, ...anhang }) => ({ ...anhang, ...embed(await loadFile(sha256)) }))),
        customPages,
        procedureDetails: verfahrensdoku ?? null,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type SettingsExport = Awaited<ReturnType<typeof exportSettings>>;
