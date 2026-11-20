import type { ClientResponse, FinTSClient } from "lib-fints";

/*
 * lib-fints stellt HKTAN nur in einen Auftrag, wenn HIPINS ihn als „mit TAN“ führt (dist/dialog.js,
 * createCurrentCustomerMessage). Die Consorsbank führt den Umsatzabruf dort ohne TAN (HKKAZ:N), lehnt ihn mit ihrem
 * App-Verfahren ohne HKTAN aber mit 9075 ab (Test gegen die Bank in Speicherstadt/haben#1387; ebenso der offene
 * python-fints#218, der HKTAN bei der Consorsbank deshalb für HKKAZ, HKSAL und HKCCS immer mitschickt,
 * force_twostep_tan). Nach einer 9075 gilt der Umsatzabruf darum
 * für diesen Client als „mit TAN“. Die Änderung steht in den BPD, die Haben mit der Verbindung speichert: Auch der nächste
 * Abruf schickt den TAN-Schritt gleich mit, bis die Bank neue BPD schickt; dann kommt einmal mehr 9075, und Haben merkt es
 * sich wieder. Eine Bank, die nie 9075 schickt, merkt nichts davon.
 */

/** Umsatzabruf als MT940 (HKKAZ) oder CAMT (HKCAZ); lib-fints wählt selbst */
const UMSATZABRUF = new Set(["HKKAZ", "HKCAZ"]);

/** „Dialog abgebrochen - starke Authentifizierung erforderlich“ (Rückmeldungscodes der DK, Stand 03.02.2026) */
const SCA_ERFORDERLICH = 9075;

/**
 * Lehnte die Bank den Umsatzabruf mit 9075 ab, obwohl er laut HIPINS ohne TAN geht, gilt er ab jetzt als „mit TAN“.
 * true heißt: Es hat sich etwas geändert, ein zweiter Versuch geht mit TAN-Schritt hinaus.
 */
export function umsatzabrufMitTanSchritt(client: FinTSClient, response: ClientResponse): boolean {
  if (response.success || !response.bankAnswers.some((a) => a.code === SCA_ERFORDERLICH)) return false;
  const ohneTan = (client.config.bankingInformation.bpd?.allowedTransactions ?? []).filter((t) => UMSATZABRUF.has(t.transId) && !t.tanRequired);
  for (const vorgang of ohneTan) vorgang.tanRequired = true;
  return ohneTan.length > 0;
}
