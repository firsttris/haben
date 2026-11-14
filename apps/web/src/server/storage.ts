import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { env } from "./env.ts";

export { sha256Of } from "@firsttris/gobd-kern/dateispeicher";
export { type DocumentKind, sniff } from "@firsttris/gobd-kern/dateityp";

/** Belegdateien liegen unveränderlich unter ihrem SHA-256: <DOCUMENTS_DIR>/ab/abcdef… */
const speicher = dateispeicher({ verzeichnis: () => env().DOCUMENTS_DIR, bezeichnung: "Belegdatei" });

export const storeFile = speicher.speichern;
export const loadFile = speicher.laden;
export const removeFile = speicher.entfernen;
export const checkFiles = speicher.pruefenAlle;
