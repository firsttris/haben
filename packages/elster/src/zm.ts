import { isQuarter, isValidGermanUstId, ustIdProblem, zmEuro, type VatPeriod, type ZmZeile } from "@haben/core";
import { splitStrasse } from "./nachricht.ts";
import { element, ElsterEingabeError, elsterXml, TESTMERKER } from "./xml.ts";

/**
 * Zusammenfassende Meldung (§ 18a UStG) an das BZSt über ERiC: Verfahren ElsterExtern, Datenart ZMDO, Empfänger „BF“ mit
 * id „L“ im NutzdatenHeader (Prüfregeln des Plugins checkZMDO). Nutzdaten nach dem Schema zm_000005.xsd (Stand
 * 10.06.2025) im Namensraum des ELSTER-Umschlags; Reihenfolge, Wertebereiche und Pflichtfelder hat das echte Plugin
 * bestätigt (eric-echt.test.ts).
 */
export interface ZmXmlInput {
  /** Meldezeitraum: Kalendermonat 1–12 oder Kalendervierteljahr 41–44 (Schlüssel der Voranmeldung) */
  period: VatPeriod;
  /** Eigene USt-IdNr. (DE und neun Ziffern) */
  ustId: string;
  anschrift: { name: string; strasse: string; plz: string; ort: string };
  zeilen: readonly ZmZeile[];
  /** Berichtigte Meldung (meldeart 11): nur die geänderten Zeilen, entfallene mit 0 */
  berichtigt: boolean;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

/**
 * Schlüssel des Meldezeitraums im Element quart laut Schema: 1–4 Kalendervierteljahre, 21–32 Kalendermonate (5 Jahresmeldung
 * und 11–14 Zweimonatsmeldungen nutzt Haben nicht).
 */
export function zmZeitraumSchluessel(period: VatPeriod): number {
  return isQuarter(period) ? period.month - 40 : period.month + 20;
}

function zeilenProblem(input: ZmXmlInput): string | null {
  if (!isValidGermanUstId(input.ustId)) return `Eigene USt-IdNr. ungültig: ${input.ustId || "fehlt"}. Sie hat die Form DE und neun Ziffern mit Prüfziffer.`;
  // Nullmeldungen sind nicht abzugeben; eine Berichtigung ohne Zeilen ändert nichts (Prüfregeln Meldezeile_Pflicht und
  // Meldezeile_Nullmeldung_bei_Erstmeldung)
  if (input.zeilen.length === 0) return input.berichtigt ? "Es gibt nichts zu berichtigen." : "Ohne Umsätze gibt es keine Zusammenfassende Meldung.";
  if (!input.berichtigt && input.zeilen.every((z) => zmEuro(z.betrag) === 0)) return "Nullmeldungen sind nicht abzugeben.";
  const keys = new Set<string>();
  for (const z of input.zeilen) {
    const problem = ustIdProblem(z.ustId, z.art);
    if (problem) return problem;
    // ERiC verlangt eine Zeile je USt-IdNr. und Art („Bitte addieren Sie die Beträge“)
    if (keys.has(`${z.art} ${z.ustId}`)) return `${z.ustId} steht doppelt in der Meldung.`;
    keys.add(`${z.art} ${z.ustId}`);
  }
  return null;
}

export function buildZmXml(input: ZmXmlInput): string {
  const problem = zeilenProblem(input);
  if (problem) throw new ElsterEingabeError(problem);
  const a = input.anschrift;
  if (!a.name.trim() || !a.strasse.trim() || !a.ort.trim() || !/^\d{5}$/.test(a.plz)) {
    throw new ElsterEingabeError("Für die Meldung braucht es Name, Straße, fünfstellige PLZ und Ort in den Firmendaten.");
  }
  // Hausnummer und Zusatz sind eigene Felder; ohne erkennbare Hausnummer bleibt die Straße ganz
  const adresse = splitStrasse(a.strasse) ?? { strasse: a.strasse.trim(), hausnummer: undefined, zusatz: undefined };
  return elsterXml(
    {
      verfahren: "ElsterExtern",
      datenArt: "ZMDO",
      testmerker: input.test ? TESTMERKER : undefined,
      herstellerId: input.herstellerId,
      datenlieferant: a.name,
    },
    [
      {
        ticket: "1",
        empfaenger: { id: "L", wert: "BF" },
        produktVersion: input.produktVersion,
        nutzdaten: [
          `<zm xmlns="http://www.elster.de/elsterxml/schema/v11" version="000005">`,
          `<unternehmer>`,
          element("knri", input.ustId),
          // Teilnehmernummer: bei Übermittlung mit ERiC Paginierbuchstabe N und die Zeichenfolge 1111111 (Schema, zulassNr)
          `<zulassNr>${element("zulnr1", "N")}${element("zulnr2", "1111111")}</zulassNr>`,
          `<anschrift>`,
          element("name", a.name.trim().slice(0, 100)),
          element("strasse", adresse.strasse.slice(0, 30)),
          ...(adresse.hausnummer ? [element("hausnr", adresse.hausnummer.slice(0, 10))] : []),
          ...(adresse.zusatz ? [element("hausnrzusatz", adresse.zusatz.slice(0, 10))] : []),
          element("plz", a.plz),
          element("ort", a.ort.trim().slice(0, 30)),
          element("staat", "DE"),
          `</anschrift>`,
          `<zm-zeilen meldeart="${input.berichtigt ? 11 : 10}" waehrung="1">`,
          // Anzeige und Widerruf der monatlichen Abgabe (§ 18a Abs. 1 Satz 4, Abs. 3 Satz 2 UStG) stellt Haben nicht
          element("anzeige", "false"),
          element("widerruf", "false"),
          `<mzr>${element("quart", String(zmZeitraumSchluessel(input.period)))}${element("jahr", String(input.period.year))}</mzr>`,
          ...input.zeilen.map((z) => `<zeile umsatzart="${z.art}">${element("knre", z.ustId)}${element("betrag", String(zmEuro(z.betrag)))}</zeile>`),
          `</zm-zeilen>`,
          `</unternehmer>`,
          `</zm>`,
        ],
      },
    ],
  );
}
