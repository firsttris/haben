/**
 * Warum zu einer Buchung keine Datei da ist, entscheidet, was über ihr steht (#1235, #1318, #1322). Vier Gründe, fünf
 * Sätze: Zwei Gründe laden zum Bestätigen ein und haben dafür einen eigenen Satz, die beiden anderen je einen, und wo
 * sich nicht bestätigen lässt, steht der allgemeine Satz über die fehlende Datei.
 *
 * - kein Beleglink: Der Accountable-Stapel nennt für die Buchung gar keine Beleg-GUID. Es gibt keinen Einzelbeleg, das
 *   lässt sich bestätigen.
 * - Datei fehlt im Export: Die Buchung trägt eine Beleg-GUID, nur die Datei fehlt im Export. Ein Einzelbeleg kann
 *   existieren, bestätigen lässt sich das nicht.
 * - Dokument vorhanden: Daten.xlsx, Spalte Y meldet zu der Rechnung ein Dokument, es hängt an einer anderen Zeile. Das
 *   gilt nur für Zeilen ohne eigene Beleg-GUID; mit GUID nennt der Satz oben den Einzelbeleg. Bestätigen lässt sich beides nicht.
 * - Quelle ohne Beleg: WISO und die Lexoffice-Sicherung setzen das Merkmal ohne Beleg-GUID. Über einen Einzelbeleg sagt
 *   das nichts. Bei der Sicherung führt der Import nur Buchungen ohne Belegbild so (#1318), dort lässt es sich
 *   bestätigen; sonst nicht.
 */
import type { OhneBelegGrund } from "../../server/modules/archiv/index.ts";

export type { OhneBelegGrund };

export function ohneBelegText(grund: OhneBelegGrund, product: string, bestaetigbar: boolean): string {
  if (grund === "kein_beleglink" && bestaetigbar) {
    return `Diese Buchung kommt ohne Einzelbeleg; ${product} führt dazu keine Datei. Wer das geprüft hat, hält es hier fest. Für den Vorsteuerabzug braucht es weiter die Rechnung (§ 15 Abs. 1 Nr. 1 UStG).`;
  }
  if (grund === "quelle_ohne_beleg" && bestaetigbar) {
    return `${product} führt diese Buchung als Buchung ohne Beleg; ein Belegbild gab es dazu in der Quelle nie. Wer das geprüft hat, hält es hier fest. Für den Vorsteuerabzug braucht es weiter die Rechnung (§ 15 Abs. 1 Nr. 1 UStG).`;
  }
  if (grund === "datei_fehlt_im_export") {
    return `${product} nennt zu dieser Buchung keine Datei. Ob es einen Einzelbeleg gibt, sagt das nicht: Die Buchung trägt eine Beleg-GUID, die Datei fehlt nur im Export. Bestätigen lässt sich das hier nicht.`;
  }
  if (grund === "dokument_vorhanden") {
    return "Accountable führt zu dieser Rechnung ein Dokument; es hängt an einer anderen Zeile derselben Rechnung. Bestätigen lässt sich das hier nicht.";
  }
  return `Zu dieser Buchung hat ${product} keine Datei geliefert. Bestätigen lässt sich das hier nicht.`;
}

/**
 * Satz in der Rückfrage „Bestätigung zurücknehmen?“ (#1317). Was danach gilt, hängt an der Quelle: Im Accountable-Stapel
 * bleibt der Beleg „ohne Beleg“, und der Abgleich zählt ihn weiter nicht als fehlende Datei (#1235). Bei sevDesk fällt er
 * auf „ohne Datei“ zurück und zählt dort wieder zu den Belegen ohne Datei.
 */
export function ruecknahmeText(ohneBeleg: boolean): string {
  return ohneBeleg
    ? "Der Beleg gilt danach wieder als offen, wie vor der Bestätigung."
    : "Der Beleg gilt danach wieder als offen; der Abgleich zählt ihn wieder zu den Belegen ohne Datei.";
}

/** Meldung nach der Rücknahme; derselbe Unterschied wie in der Rückfrage */
export function ruecknahmeHinweis(ohneBeleg: boolean): string {
  return `Bestätigung zurückgenommen. ${ruecknahmeText(ohneBeleg)}`;
}
