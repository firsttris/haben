/**
 * Warum zu einer Buchung keine Datei da ist, entscheidet, was über ihr steht (#1235). Drei Fälle, drei Sätze:
 *
 * - kein Beleglink: Der Accountable-Stapel nennt für die Buchung gar keine Beleg-GUID. Es gibt keinen Einzelbeleg, das
 *   lässt sich bestätigen.
 * - Datei fehlt im Export: Die Buchung trägt eine Beleg-GUID, nur die Datei fehlt im Export. Ein Einzelbeleg kann
 *   existieren, bestätigen lässt sich das nicht.
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
  return `Zu dieser Buchung hat ${product} keine Datei geliefert. Bestätigen lässt sich das hier nicht.`;
}
