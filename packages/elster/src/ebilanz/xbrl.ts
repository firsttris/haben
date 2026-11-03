import type { Cents } from "@haben/core";
import { elsterXml, escapeXml } from "../xml.ts";
import taxonomie from "./taxonomie-6-9.json" with { type: "json" };

/*
 * E-Bilanz (§ 5b EStG) einer Kapitalgesellschaft als XBRL-Instanz in der HGB-Taxonomie 6.9, im ELSTER-Umschlag der
 * Datenart „Bilanz“ (ERiC-Dokumentation, Schnittstellenbeschreibungen/Sonstige/Bilanz, ebilanz_000002.xsd; Beispiele
 * Taxonomie_6_9). Übermittelt wird eine Steuerbilanz (accountingStandard AO) mit Bilanz und GuV nach dem
 * Gesamtkostenverfahren als Einzelabschluss.
 *
 * Die Werte kommen je Taxonomie-Position (Blatt) herein; Summen rechnet der Baustein nach den Rechenregeln der Taxonomie
 * (summation-item mit Gewicht) selbst. Mussfelder und Summenmussfelder ohne Wert stehen leer (xsi:nil), wie die
 * Finanzverwaltung es für nicht belegte Mussfelder vorsieht.
 */

export const EBILANZ_TAXONOMIE = "6.9";
const GCD = "http://www.xbrl.de/taxonomies/de-gcd-2025-04-01";
const GAAP = "http://www.xbrl.de/taxonomies/de-gaap-ci-2025-04-01";

/** [Pflichtgrad, Summe, Gewicht, Soll/Haben, Periodentyp] je Position; Pflichtgrad M Muss, S Summenmuss, R rechnerisch notwendig */
type Position = [req: string, parent: string | null, weight: number, balance: string, period: string];
const POSITIONEN = taxonomie.positionen as unknown as Record<string, Position>;

export class EbilanzError extends Error {}

export interface EbilanzInput {
  /** Wirtschaftsjahr = Kalenderjahr */
  year: number;
  steuernummer13: string;
  firma: { name: string; strasse: string; plz: string; ort: string };
  /** Werte je Blattposition der Taxonomie (ohne Präfix), im Vorzeichen der Position: Soll-Position Soll positiv */
  werte: Readonly<Record<string, Cents>>;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
  /** Erstellungsdatum der Instanz, JJJJ-MM-TT */
  erstellt: string;
}

/** Summen nach den Rechenregeln: jede Position mit Wert gibt ihn, mit Gewicht, an ihre Summe weiter */
export function ebilanzSummen(werte: Readonly<Record<string, Cents>>): Map<string, Cents> {
  const result = new Map<string, Cents>();
  for (const [name, value] of Object.entries(werte)) {
    if (!POSITIONEN[name]) throw new EbilanzError(`Position ${name} gibt es in der Taxonomie ${EBILANZ_TAXONOMIE} nicht`);
    if (value === 0) continue;
    let current: string | null = name;
    let factor = 1;
    while (current) {
      result.set(current, (result.get(current) ?? 0) + factor * value);
      const [, parent, weight]: Position = POSITIONEN[current]!;
      factor *= weight;
      current = parent;
    }
  }
  return result;
}

const decimal = (cents: Cents) => `${cents < 0 ? "-" : ""}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** Fakten von Bilanz und GuV: alle Positionen mit Wert, dazu Muss- und Summenmussfelder leer */
function gaapFacts(summen: Map<string, Cents>): string[] {
  return Object.entries(POSITIONEN)
    .filter(([name, [req]]) => summen.has(name) || req === "M" || req === "S")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, [, , , , period]]) => {
      const context = period === "instant" ? "I-AKTJAHR" : "D-AKTJAHR";
      const value = summen.get(name);
      return value === undefined
        ? `<de-gaap-ci:${name} contextRef="${context}" unitRef="EUR" xsi:nil="true"/>`
        : `<de-gaap-ci:${name} contextRef="${context}" unitRef="EUR" decimals="2">${decimal(value)}</de-gaap-ci:${name}>`;
    });
}

/** Straße und Hausnummer getrennt, wie die Stammdaten sie verlangen: „Musterstraße 12a“ → Musterstraße, 12a */
export function splitStrasse(strasse: string): { street: string; houseNo: string } {
  const m = /^(.*?)\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(strasse.trim());
  return m ? { street: m[1]!, houseNo: m[2]!.replace(/\s+/g, "") } : { street: strasse.trim(), houseNo: "" };
}

/** Stammdaten (GCD-Modul): Bericht, Zeitraum, Unternehmen; Aufbau wie in den Beispielen der ERiC-Dokumentation */
function gcdFacts(input: EbilanzInput): string[] {
  const d = 'contextRef="D-AKTJAHR"';
  const fact = (name: string, value?: string | null) =>
    value === undefined
      ? `<de-gcd:genInfo.${name} ${d}/>`
      : value === null
        ? `<de-gcd:genInfo.${name} ${d} xsi:nil="true"/>`
        : `<de-gcd:genInfo.${name} ${d}>${escapeXml(value)}</de-gcd:genInfo.${name}>`;
  const group = (name: string, inner: string[]) => [`<de-gcd:genInfo.${name}>`, ...inner, `</de-gcd:genInfo.${name}>`];
  const y = input.year;
  const { street, houseNo } = splitStrasse(input.firma.strasse);
  const elements = ["B", "BAL", "BVV", "EB", "EV", "GuV", "KKE", "KS", "SGE", "SGEP", "STU"] as const;
  // Bilanz, Anlagenspiegel, GuV mit Betriebsvermögensvergleich
  const BERICHTSTEILE = new Set<string>(["B", "BAL", "BVV", "GuV"]);
  return [
    fact("doc.id.generationDate", input.erstellt),
    ...group("report.id.reportStatus", [fact("report.id.reportStatus.reportStatus.E")]),
    ...group("report.id.revisionStatus", [fact("report.id.revisionStatus.revisionStatus.E")]),
    ...group(
      "report.id.reportElement",
      elements.map((e) => fact(`report.id.reportElement.reportElements.${e}`, BERICHTSTEILE.has(e) ? undefined : null)),
    ),
    // Kontensalden je Position übermittelt Haben noch nicht; die Taxonomie erlaubt dafür diese Angabe
    fact("report.id.reportElement.reportElements.transmissionNotYetPossible", "NoKS"),
    ...group("report.id.statementType", [fact("report.id.statementType.statementType.E")]),
    ...group("report.id.statementType.tax", [fact("report.id.statementType.tax.statementTypeTax.GHB", null)]),
    fact("report.id.incomeStatementendswithBalProfit", "false"),
    ...group("report.id.accountingStandard", [fact("report.id.accountingStandard.accountingStandard.AO")]),
    // K: keine Sonderrechnungslegung (Kreditinstitute, Versicherungen, Krankenhäuser …)
    ...group("report.id.specialAccountingStandard", [fact("report.id.specialAccountingStandard.K")]),
    ...group("report.id.incomeStatementFormat", [fact("report.id.incomeStatementFormat.incomeStatementFormat.GKV")]),
    ...group("report.id.consolidationRange", [fact("report.id.consolidationRange.consolidationRange.EA")]),
    fact("report.period.fiscalYearBegin", `${y}-01-01`),
    fact("report.period.fiscalYearEnd", `${y}-12-31`),
    fact("report.period.balSheetClosingDate", `${y}-12-31`),
    fact("report.period.fiscalPreviousYearBegin", `${y - 1}-01-01`),
    fact("report.period.fiscalPreviousYearEnd", `${y - 1}-12-31`),
    fact("report.period.balSheetClosingDatePreviousYear", `${y - 1}-12-31`),
    fact("company.id.business", null),
    ...group("company.id.domesticBranchOfForeignCompany", [fact("company.id.domesticBranchOfForeignCompany.other", null)]),
    ...group("company.id.entityWithTaxablePurposeBusiness", [fact("company.id.entityWithTaxablePurposeBusiness.normal", null)]),
    ...group("company.id.incomeClassification", [fact("company.id.incomeClassification.trade")]),
    // Die UG (haftungsbeschränkt) ist eine GmbH (§ 5a GmbHG); die Taxonomie kennt keinen eigenen Schlüssel
    ...group("company.id.legalStatus", [fact("company.id.legalStatus.legalStatus.GMBH")]),
    fact("company.id.name", input.firma.name),
    fact("company.id.location", "Firmensitz"),
    fact("company.id.location.street", street),
    ...(houseNo ? [fact("company.id.location.houseNo", houseNo)] : []),
    fact("company.id.location.zipCode", input.firma.plz),
    fact("company.id.location.city", input.firma.ort),
    fact("company.id.location.country", "Deutschland"),
    ...group("company.id.idNo", [
      fact("company.id.idNo.type.companyId.ST13", input.steuernummer13),
      fact("company.id.idNo.type.companyId.STID", null),
      fact("company.id.idNo.type.companyId.STWID", null),
      fact("company.id.idNo.type.companyId.BF4", input.steuernummer13.slice(0, 4)),
    ]),
    fact("company.id.optionKStGs1a", null),
    // Gesellschafter: Mussfeld der Stammdaten, bei Kapitalgesellschaften ohne Angaben (sie gelten Personengesellschaften)
    ...group("company.id.shareholder", [
      fact("company.id.shareholder.name", null),
      fact("company.id.shareholder.id", null),
      ...group("company.id.shareholder.group", [fact("company.id.shareholder.group.genPartnerFullyLiable", null)]),
      `<de-gcd:genInfo.company.id.shareholder.currentnumber ${d} unitRef="PURE" xsi:nil="true"/>`,
      fact("company.id.shareholder.taxnumber", null),
      fact("company.id.shareholder.taxid", null),
      fact("company.id.shareholder.WID", null),
      ...group("company.id.shareholder.legalStatus", [fact("company.id.shareholder.legalStatus.legalStatus.NPP", null)]),
      ...group("company.id.shareholder.ShareDivideKey", [
        fact("company.id.shareholder.ShareDivideKey.numerator", null),
        fact("company.id.shareholder.ShareDivideKey.denominator", null),
      ]),
      fact("company.id.shareholder.SpecialBalanceRequired", null),
      fact("company.id.shareholder.extensionRequired", null),
    ]),
    ...group("report.id.accordingTo", [
      fact("report.id.accordingTo.name", null),
      ...group("report.id.accordingTo.idNo", [fact("company.id.idNo.type.companyId.ST13", null), fact("company.id.idNo.type.companyId.BF4", null)]),
      fact("report.id.accordingTo.yearEnd", null),
    ]),
  ];
}

/** E-Bilanz im ELSTER-Umschlag, Datenart Bilanz; Empfänger ist das Finanzamt nach der Bundesfinanzamtsnummer */
export function buildEbilanzXml(input: EbilanzInput): string {
  if (!/^\d{13}$/.test(input.steuernummer13)) throw new EbilanzError("Steuernummer im ELSTER-Format (13 Ziffern) fehlt");
  const summen = ebilanzSummen(input.werte);
  const aktiva = summen.get("bs.ass") ?? 0;
  const passiva = summen.get("bs.eqLiab") ?? 0;
  if (aktiva !== passiva) throw new EbilanzError(`Aktiva (${decimal(aktiva)}) und Passiva (${decimal(passiva)}) sind nicht gleich`);
  const entity = `<xbrli:entity><xbrli:identifier scheme="http://www.rzf-nrw.de/Steuernummer">${input.steuernummer13}</xbrli:identifier></xbrli:entity>`;
  const y = input.year;
  const instanz = [
    `<ebilanz:EBilanz version="000002" xmlns:ebilanz="http://rzf.fin-nrw.de/RMS/EBilanz/2016/XMLSchema">`,
    `<ebilanz:stichtag>${y}1231</ebilanz:stichtag>`,
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:de-gcd="${GCD}" xmlns:de-gaap-ci="${GAAP}">`,
    `<link:schemaRef xlink:type="simple" xlink:href="${GCD}/de-gcd-2025-04-01-shell.xsd"/>`,
    `<link:schemaRef xlink:type="simple" xlink:href="${GAAP}/de-gaap-ci-2025-04-01-shell-fiscal.xsd"/>`,
    `<xbrli:context id="I-AKTJAHR">${entity}<xbrli:period><xbrli:instant>${y}-12-31</xbrli:instant></xbrli:period></xbrli:context>`,
    `<xbrli:context id="D-AKTJAHR">${entity}<xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period></xbrli:context>`,
    `<xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`,
    `<xbrli:unit id="PURE"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`,
    ...gcdFacts(input),
    ...gaapFacts(summen),
    `</xbrli:xbrl>`,
    `</ebilanz:EBilanz>`,
  ];
  return elsterXml(
    {
      verfahren: "ElsterBilanz",
      datenArt: "Bilanz",
      testmerker: input.test ? "700000004" : undefined,
      herstellerId: input.herstellerId,
      datenlieferant: input.firma.name,
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: input.steuernummer13.slice(0, 4) }, produktVersion: input.produktVersion, nutzdaten: instanz }],
  );
}
