import { formatDate } from "./format.ts";
import type { Notice } from "./use-action.ts";

/** Meldung nach dem Hochladen des ELSTER-Zertifikats; mit PIN sagt sie, ob das Ablaufdatum aus der Datei kam (#1366) */
export function certificateUploadNotice(result: { validUntil: string | null; readFromFile: boolean }, withPin: boolean): NonNullable<Notice> {
  if (result.readFromFile && result.validUntil)
    return { tone: "ok", text: `Zertifikat verschlüsselt gespeichert, gültig bis ${formatDate(result.validUntil)}.` };
  if (!withPin) return { tone: "ok", text: "Zertifikat verschlüsselt gespeichert." };
  return {
    tone: "info",
    text: result.validUntil
      ? "Zertifikat verschlüsselt gespeichert. Mit dieser PIN ließ sich das Ablaufdatum nicht aus der Datei lesen; es gilt dein Eintrag."
      : "Zertifikat verschlüsselt gespeichert, ohne Ablaufdatum: Mit dieser PIN ließ es sich nicht aus der Datei lesen. Lade die Datei mit der richtigen PIN noch einmal hoch oder trag das Datum von Hand ein.",
  };
}
