import { MAX_LOGO_BYTES } from "@haben/core";
import { strFromU8 } from "fflate";
import { z } from "zod";
import { geprueft } from "../../errors.ts";
import { MAX_DOCUMENT_SIZE } from "../../grenzen.ts";
import { MAX_INVOICE_ATTACHMENTS } from "../rechnungen/index.ts";
import { MAX_BACKGROUND_BYTES } from "../stammdaten/index.ts";
import { SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION } from "./format.ts";
import { checksumProblem, type FileRef, referenced } from "./integritaet.ts";
import { SETTINGS_JSON, SettingsFileError, unzipSettings, type ZipLimits } from "./zip.ts";

/*
 * Einstellungsdatei (#488) lesen, bevor etwas geschrieben wird: ZIP mit Grenzen entpacken, dann in `einstellungen.json`
 * Format, Version, Prüfsumme und Aufbau, dann jede Datei daneben gegen ihren SHA-256. Die Werte selbst prüfen danach die
 * Module mit den Schemas ihrer Formulare.
 */

/** Logo, Briefpapier und alle Standardanhänge an ihrer Grenze, dazu reichlich Platz für die Stammdaten */
export const MAX_SETTINGS_FILE_BYTES = MAX_LOGO_BYTES + MAX_BACKGROUND_BYTES + MAX_INVOICE_ATTACHMENTS * MAX_DOCUMENT_SIZE + 50 * 1024 * 1024;

/** Die JSON, Logo, Briefpapier und die Standardanhänge, dazu Ordner */
const ZIP_LIMITS: ZipLimits = { maxEntries: 3 + MAX_INVOICE_ATTACHMENTS + 5, maxUnpackedBytes: MAX_SETTINGS_FILE_BYTES };

const objekt = z.record(z.string(), z.unknown());
const zeilen = z.array(objekt);
const verweis = z.object({ file: z.string().max(200), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
const bild = verweis.extend({ format: z.enum(["png", "jpg"]) });

const aufbauSchema = z.object({
  format: z.literal(SETTINGS_EXPORT_FORMAT),
  version: z.literal(SETTINGS_EXPORT_VERSION),
  company: objekt.nullable(),
  einrichtung: objekt.nullable(),
  letterheadProfiles: zeilen,
  logo: bild.nullable(),
  background: bild.nullable(),
  layouts: zeilen,
  units: zeilen,
  articles: zeilen,
  contacts: zeilen,
  contactPersons: zeilen,
  textBlocks: zeilen,
  ownAccounts: zeilen,
  mail: objekt.nullable(),
  quoteDefaultAttachments: z.array(verweis.extend({ filename: z.string().max(300) })).max(100),
  customPages: zeilen,
  procedureDetails: objekt.nullable(),
  vatFrequencies: zeilen,
});

export type SettingsFile = Omit<z.infer<typeof aufbauSchema>, "logo" | "background" | "quoteDefaultAttachments"> & {
  logo: Uint8Array | null;
  background: Uint8Array | null;
  quoteDefaultAttachments: { filename: string; bytes: Uint8Array }[];
};

function json(files: Record<string, Uint8Array>): unknown {
  const bytes = Object.hasOwn(files, SETTINGS_JSON) ? files[SETTINGS_JSON] : undefined;
  if (!bytes) throw new SettingsFileError(`Das ist keine Einstellungsdatei von Haben: Im ZIP fehlt ${SETTINGS_JSON}.`);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new SettingsFileError(`${SETTINGS_JSON} im ZIP ist kein gültiges JSON.`);
  }
}

export function readSettingsZip(archive: Uint8Array, limits: ZipLimits = ZIP_LIMITS): SettingsFile {
  const files = unzipSettings(archive, limits);
  const parsed = json(files);
  const kopf = (parsed ?? {}) as { format?: unknown; version?: unknown };
  if (kopf.format !== SETTINGS_EXPORT_FORMAT) throw new SettingsFileError("Das ist keine Einstellungsdatei von Haben.");
  if (typeof kopf.version === "number" && kopf.version > SETTINGS_EXPORT_VERSION)
    throw new SettingsFileError("Die Datei stammt aus einer neueren Version von Haben. Aktualisiere diese Instanz und versuche es dann noch einmal.");
  const problem = checksumProblem(parsed);
  if (problem) throw new SettingsFileError(problem);
  const aufbau = geprueft(aufbauSchema, parsed, "Einstellungsdatei");
  const datei = (bezeichnung: string, ref: FileRef): Uint8Array => {
    const bytes = referenced(files, ref);
    if (!bytes) throw new SettingsFileError(`${bezeichnung}: ${ref.file} fehlt im ZIP oder passt nicht zur Prüfsumme.`);
    return bytes;
  };
  return {
    ...aufbau,
    logo: aufbau.logo && datei("Logo", aufbau.logo),
    background: aufbau.background && datei("Briefpapier", aufbau.background),
    quoteDefaultAttachments: aufbau.quoteDefaultAttachments.map((anhang) => ({
      filename: anhang.filename,
      bytes: datei(`Standardanhang ${anhang.filename}`, anhang),
    })),
  };
}
