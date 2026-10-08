import type { Notice } from "./use-action.ts";

export type ElsterKind = "validate" | "test" | "send";
export const ELSTER_KIND_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung" } as const;

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
