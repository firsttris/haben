import { formatEuro } from "@haben/core";
import type { ConfirmFact } from "../components/ConfirmDialog.tsx";
import type { Notice } from "./use-action.ts";

export type ElsterKind = "validate" | "test" | "send";
export const ELSTER_KIND_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung", vermerk: "Vermerk" } as const;

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
