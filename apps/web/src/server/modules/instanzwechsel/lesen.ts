import { MAX_LOGO_BYTES } from "@haben/core";
import { z } from "zod";
import { geprueft, UserError } from "../../errors.ts";
import { MAX_DOCUMENT_SIZE } from "../../grenzen.ts";
import { MAX_INVOICE_ATTACHMENTS } from "../rechnungen/index.ts";
import { MAX_BACKGROUND_BYTES } from "../stammdaten/index.ts";
import { SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION } from "./format.ts";
import { checksumProblem, unembed } from "./integritaet.ts";

/*
 * Einstellungsdatei (#488) lesen, bevor etwas geschrieben wird: JSON, Prüfsumme der ganzen Datei, Format und Version,
 * Aufbau, dann jede eingebettete Datei gegen ihren SHA-256. Die Werte selbst prüfen danach die Module mit den Schemas
 * ihrer Formulare.
 */

export class SettingsFileError extends UserError {}

/** Logo, Briefpapier und alle Standardanhänge an ihrer Grenze, in Base64, dazu reichlich Platz für die Stammdaten */
export const MAX_SETTINGS_FILE_BYTES =
  Math.ceil(((MAX_LOGO_BYTES + MAX_BACKGROUND_BYTES + MAX_INVOICE_ATTACHMENTS * MAX_DOCUMENT_SIZE) * 4) / 3) + 50 * 1024 * 1024;

const objekt = z.record(z.string(), z.unknown());
const zeilen = z.array(objekt);
const eingebettet = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), data: z.string() });
const bild = eingebettet.extend({ format: z.enum(["png", "jpg"]) });

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
  quoteDefaultAttachments: z.array(eingebettet.extend({ filename: z.string().max(300) })).max(100),
  customPages: zeilen,
  procedureDetails: objekt.nullable(),
  vatFrequencies: zeilen,
});

export type SettingsFile = Omit<z.infer<typeof aufbauSchema>, "logo" | "background" | "quoteDefaultAttachments"> & {
  logo: Uint8Array | null;
  background: Uint8Array | null;
  quoteDefaultAttachments: { filename: string; bytes: Uint8Array }[];
};

function datei(bezeichnung: string, file: z.infer<typeof eingebettet>): Uint8Array {
  const bytes = unembed(file);
  if (!bytes) throw new SettingsFileError(`${bezeichnung}: Die Prüfsumme der Datei stimmt nicht, sie ist beschädigt.`);
  return bytes;
}

export function readSettingsFile(text: string): SettingsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsFileError("Die Datei ist kein JSON. Erwartet wird die Datei aus „Einstellungen exportieren“.");
  }
  const kopf = (parsed ?? {}) as { format?: unknown; version?: unknown };
  if (kopf.format !== SETTINGS_EXPORT_FORMAT) throw new SettingsFileError("Das ist keine Einstellungsdatei von Haben.");
  if (typeof kopf.version === "number" && kopf.version > SETTINGS_EXPORT_VERSION)
    throw new SettingsFileError("Die Datei stammt aus einer neueren Version von Haben. Aktualisiere diese Instanz und versuche es dann noch einmal.");
  const problem = checksumProblem(parsed);
  if (problem) throw new SettingsFileError(problem);
  const aufbau = geprueft(aufbauSchema, parsed, "Einstellungsdatei");
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
