import { formatEuro } from "@haben/core";
import { formatZeitraumAbJahresanfang } from "../../lib/format.ts";
import type { getFinanzamt } from "../../server/functions/finanzamt.ts";

export type Data = Awaited<ReturnType<typeof getFinanzamt>> & { today: string };

/** Zahlen für die Herabsetzung; nur im Einzelunternehmen, eine GmbH oder UG hat keine Einkommensteuer-Vorauszahlungen */
export type Basis = NonNullable<Data["basis"]>;

export type Topic = "vorauszahlung" | "nachricht";

export type SendResult = { ok: boolean; code: number; message: string; transferTicket: string | null };

/** Status im Verlauf */
export const STATUS_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Gesendet" } as const;

export const TOPIC_LABEL = { vorauszahlung: "Herabsetzung der Vorauszahlungen", nachricht: "Nachricht", bankverbindung: "Bankverbindung ändern" } as const;

export const DATENART_LABEL: Record<string, string> = {
  ESB: "Steuerbescheid (Daten)",
  EPMitteilung: "Mitteilung",
  DivaBescheidESt: "Einkommensteuerbescheid",
  DivaBescheidUSt: "Umsatzsteuerbescheid",
  DivaBescheidGewSt: "Gewerbesteuer-Messbescheid",
  DivaBescheidKSt: "Körperschaftsteuerbescheid",
  DivaBescheidFEIN: "Feststellungsbescheid",
  DivaSonstigerVA: "Sonstiger Bescheid",
};

/**
 * Hinweis im Reiter „Vorauszahlungen herabsetzen“, wenn die Person angegeben hat, dass nichts festgesetzt ist (#1287).
 * Der Antrag bleibt verfügbar: Der Haken ist eine Angabe der Person, kein Bescheid. Wer ihn zu Unrecht gesetzt hat,
 * kommt so weiterhin zum Antrag; wer wirklich nichts festgesetzt hat, spart sich einen gegenstandslosen Brief.
 */
export function vorauszahlungHinweis(keineVorauszahlungen: boolean): string | null {
  if (!keineVorauszahlungen) return null;
  return (
    "Nach deinen Angaben sind keine Vorauszahlungen festgesetzt. Ein Herabsetzungsantrag ist dann gegenstandslos, " +
    "es sei denn, das Finanzamt hat inzwischen wieder etwas festgesetzt. Die Angabe steht unter Einstellungen › Persönliche Angaben."
  );
}

/** Formloser Antrag nach § 37 Abs. 3 EStG mit den Zahlen aus der Buchhaltung */
export function prepaymentLetter(data: Data, b: Basis, current: number | null, wanted: number | null, reason: string, usePrognose: boolean) {
  const art = b.einkunftsart === "gewerbe" ? "Gewerbebetrieb" : "selbständiger Arbeit";
  const lines = [
    "Sehr geehrte Damen und Herren,",
    "",
    `hiermit beantrage ich, die Vorauszahlungen zur Einkommensteuer für ${b.year} ab dem nächsten Fälligkeitstermin` +
      (wanted !== null ? ` auf ${formatEuro(wanted)} je Quartal` : "") +
      " herabzusetzen (§ 37 Abs. 3 EStG).",
    "",
    `Mein Gewinn aus ${art} beträgt nach meiner Buchführung für ${formatZeitraumAbJahresanfang(b.until)} ${formatEuro(b.profitSoFar)}. ` +
      `Auf das Jahr hochgerechnet erwarte ich einen Gewinn von rund ${formatEuro(b.profitForecast)} (Vorjahr: ${formatEuro(b.profitLastYear)}).` +
      (current !== null ? ` Die bisher festgesetzten Vorauszahlungen von ${formatEuro(current)} je Quartal sind deshalb zu hoch.` : ""),
    ...(usePrognose
      ? [
          "",
          `Nach meiner Berechnung ergibt sich daraus nach Abzug der Vorsorgeaufwendungen und Sonderausgaben eine voraussichtliche ` +
            `Einkommensteuer von ${formatEuro(b.prognose.einkommensteuer)}` +
            (b.prognose.soli || b.prognose.kirchensteuer
              ? ` zuzüglich ${[b.prognose.soli ? `${formatEuro(b.prognose.soli)} Solidaritätszuschlag` : "", b.prognose.kirchensteuer ? `${formatEuro(b.prognose.kirchensteuer)} Kirchensteuer` : ""].filter(Boolean).join(" und ")}`
              : "") +
            ".",
        ]
      : []),
    ...(reason.trim() ? ["", reason.trim()] : []),
    "",
    "Eine Gewinnermittlung für den bisherigen Zeitraum reiche ich auf Anforderung gerne nach.",
    "",
    "Mit freundlichen Grüßen",
    data.company.name,
  ];
  return { betreff: `Antrag auf Herabsetzung der Einkommensteuer-Vorauszahlungen ${b.year}`, text: lines.join("\n") };
}
