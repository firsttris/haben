/*
 * Umgliederung eines negativen Umsatzsteuer-Saldos in der Anlage EÜR (#933, Vorgabe aus #708). Zeile 58
 * (E6005101, an das Finanzamt gezahlte Umsatzsteuer) und Zeile 18 (E6000701, erstattete Umsatzsteuer) nehmen
 * laut Schema kein Vorzeichen an; eine Erstattung ist eine Betriebseinnahme und gehört deshalb in Zeile 18.
 */
import { formatEuro } from "@haben/core";
import { EUER_FIELDS, type EuerFigures } from "./euer-felder.ts";

export interface EuerUstGliederung {
  /** Beträge für die Anlage EÜR: Zeile 18 und Zeile 58 ohne Vorzeichen */
  figures: EuerFigures;
  /** Was umgegliedert wurde, je Zeile eine Meldung für die Vorprüfung */
  umgliederungen: string[];
}

/**
 * Gliedert einen negativen Saldo zwischen Zeile 58 (E6005101, an das Finanzamt gezahlte Umsatzsteuer) und Zeile 18
 * (E6000701, vom Finanzamt erstattete Umsatzsteuer) um, statt ihn mit Vorzeichen zu übermitteln (#933, Vorgabe aus
 * #708): Ein negativer Betrag in Zeile 58 heißt, dass im Jahr mehr Umsatzsteuer erstattet als gezahlt wurde. Die
 * Erstattung ist eine Betriebseinnahme und gehört in Zeile 18; die Zahlung ist eine Betriebsausgabe in Zeile 58.
 * Beide Zeilen weisen den Betrag getrennt und ohne Vorzeichen aus, umgekehrt genauso für einen negativen Betrag in
 * Zeile 18. Sind beide Zeilen negativ, zählt der Saldo des Jahres: überwiegt die Erstattung, steht er in Zeile 18,
 * überwiegt die Zahlung in Zeile 58; die Meldung nennt die Beträge, die dort tatsächlich standen. Der Gewinn der Anlage EÜR ändert sich dadurch nicht, weil derselbe Betrag auf der anderen Seite der
 * Ermittlung steht; gebuchte Daten bleiben unverändert.
 */
export function euerUstUmgliedern(f: EuerFigures): EuerUstGliederung {
  const gezahlteUst = f.gezahlteUst ?? 0;
  const erstatteteUst = f.erstatteteUst ?? 0;
  if (gezahlteUst >= 0 && erstatteteUst >= 0) return { figures: f, umgliederungen: [] };
  const kzGezahlt = EUER_FIELDS.gezahlteUst.kz;
  const kzErstattet = EUER_FIELDS.erstatteteUst.kz;
  const schluss = "beide Zeilen ohne Vorzeichen. Der Gewinn bleibt gleich, gebuchte Daten ändern sich nicht.";
  if (gezahlteUst < 0 && erstatteteUst < 0) {
    // Beide Zeilen seitenverkehrt: eine Meldung nennt die Beträge, die dort standen, und das Ergebnis des Jahres
    const saldo = gezahlteUst - erstatteteUst; // positiv: unterm Strich gezahlt, negativ: erstattet
    const stand = `In Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“) standen ${formatEuro(-gezahlteUst)} und in Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“) standen ${formatEuro(-erstatteteUst)}, beide mit Vorzeichen:`;
    const ergebnis =
      saldo > 0
        ? ` unterm Strich wurden ${formatEuro(saldo)} Umsatzsteuer gezahlt. Der Betrag steht jetzt als Betriebsausgabe in Zeile 58, Zeile 18 bleibt leer,`
        : saldo < 0
          ? ` unterm Strich wurde ${formatEuro(-saldo)} Umsatzsteuer erstattet. Der Betrag steht jetzt als Betriebseinnahme in Zeile 18, Zeile 58 bleibt leer,`
          : " die Beträge heben sich auf, beide Zeilen bleiben leer,";
    return {
      figures: { ...f, gezahlteUst: Math.max(saldo, 0), erstatteteUst: Math.max(-saldo, 0) },
      umgliederungen: [`${stand}${ergebnis} ${schluss}`],
    };
  }
  if (gezahlteUst < 0) {
    return {
      figures: { ...f, gezahlteUst: 0, erstatteteUst: erstatteteUst + -gezahlteUst },
      umgliederungen: [
        `In Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“) standen ${formatEuro(-gezahlteUst)}: im Jahr wurde mehr Umsatzsteuer erstattet als gezahlt. Der Betrag steht in der Anlage EÜR jetzt als Betriebseinnahme in Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“), ${schluss}`,
      ],
    };
  }
  return {
    figures: { ...f, gezahlteUst: gezahlteUst + -erstatteteUst, erstatteteUst: 0 },
    umgliederungen: [
      `In Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“) standen ${formatEuro(-erstatteteUst)}: im Jahr wurde mehr Umsatzsteuer gezahlt als erstattet. Der Betrag steht in der Anlage EÜR jetzt als Betriebsausgabe in Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“), ${schluss}`,
    ],
  };
}
