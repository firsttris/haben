import { formatEuro } from "@haben/core";
import type { ConfirmFact } from "../components/ConfirmDialog.tsx";
import { formatDate } from "./format.ts";
import type { Notice } from "./use-action.ts";

export type ElsterKind = "validate" | "test" | "send";
export const ELSTER_KIND_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung", vermerk: "Vermerk" } as const;

/** Pille über einer Jahreserklärung */
export interface AbgabePille {
  /** grün: die Erklärung liegt beim Finanzamt */
  ok: boolean;
  text: string;
}

/**
 * Stand einer Jahreserklärung für die Pille: in Haben übermittelt, außerhalb abgegeben oder offen. Die
 * Einkommensteuererklärung führt Haben nicht (kein Vermerk); ohne Übermittlung aus Haben ist „offen“ dort keine Pflicht,
 * sondern der Normalfall, und die Pille sagt das neutral (#869).
 */
export function abgabePille({
  sent,
  submitted,
  verwaltet = true,
}: {
  sent: string | Date | null;
  submitted: { filedOn: string | null } | null;
  verwaltet?: boolean;
}): AbgabePille {
  if (sent) return { ok: true, text: `Übermittelt am ${formatDate(sent)}` };
  if (submitted) return { ok: true, text: `Außerhalb abgegeben${submitted.filedOn ? ` am ${formatDate(submitted.filedOn)}` : ""}` };
  return { ok: false, text: verwaltet ? "Noch nicht übermittelt" : "Wird außerhalb von Haben abgegeben" };
}

/** Antwort von ERiC als Meldung; `sentText` sagt, was nach der Echtsendung passiert ist */
export function elsterNotice(
  kind: ElsterKind,
  result: { ok: boolean; code: number; message: string; transferTicket: string | null },
  sentText: string,
): Notice {
  if (!result.ok) return { tone: "danger", text: `${ELSTER_KIND_LABEL[kind]} fehlgeschlagen (${result.code}): ${result.message}` };
  const ticket = result.transferTicket ? ` Transfer-Ticket ${result.transferTicket}.` : "";
  if (kind === "validate") return { tone: "ok", text: "ERiC hat die Daten geprüft, keine Fehler." };
  return { tone: "ok", text: kind === "test" ? `Testübermittlung erfolgreich.${ticket}` : `${sentText}${ticket}` };
}

/** Echt nur, wenn der Test-Schalter aus ist und echtes Senden überhaupt geht; sonst testweise */
export function submitKind(testOnly: boolean, canSendLive: boolean): "test" | "send" {
  return !testOnly && canSendLive ? "send" : "test";
}

/** Faktenzeile vor dem Senden: Kennzahl 83 ist negativ, wenn das Finanzamt erstattet */
export function zahllastFakt(cents: number): ConfirmFact {
  return { label: cents < 0 ? "Erstattung" : "Zahllast", value: formatEuro(Math.abs(cents)), strong: true };
}

/** Wohin eine Nachricht oder neue Bankverbindung geht; eine falsche Steuernummer soll vor dem Senden auffallen */
export function finanzamtFakten(finanzamt: string, steuernummer: string): ConfirmFact[] {
  return [
    { label: "Finanzamt", value: finanzamt || "–" },
    { label: "Steuernummer", value: steuernummer || "–" },
  ];
}
