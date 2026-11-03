import type { AnlagenspiegelZeile, Cents, EbilanzZuordnung } from "@haben/core";
import { splitStrasse } from "../nachricht.ts";
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
  firma: { name: string; strasse: string; plz: string; ort: string; telefon?: string; email?: string };
  /** Werte je Blattposition der Taxonomie (ohne Präfix), im Vorzeichen der Position: Soll-Position Soll positiv */
  werte: Readonly<Record<string, Cents>>;
  /** Betriebsvermögensvergleich: Eigenkapital am Ende des Vorjahres, Ausschüttungen und Einlagen im Jahr */
  bvv: { eigenkapitalVorjahr: Cents; ausschuettungen: Cents; einlagen: Cents };
  /** Anlagenspiegel je Bilanzposition des Anlagevermögens (Blatt), Beträge positiv */
  anlagen: readonly AnlagenspiegelZeile[];
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

/**
 * Werte je Position aus den zugeordneten Salden (Soll − Haben): Soll-Positionen mit dem Saldo, Haben-Positionen mit
 * seinem Gegenwert. Das Jahresergebnis der GuV steht als Jahresüberschuss/-fehlbetrag im Eigenkapital, weil Haben es
 * nicht auf ein Konto abschließt.
 */
export function ebilanzWerte(zuordnung: readonly EbilanzZuordnung[]): Record<string, Cents> {
  const werte: Record<string, Cents> = {};
  for (const { position, saldo } of zuordnung) {
    const p = POSITIONEN[position];
    if (!p) throw new EbilanzError(`Position ${position} gibt es in der Taxonomie ${EBILANZ_TAXONOMIE} nicht`);
    werte[position] = (werte[position] ?? 0) + (p[3] === "credit" ? -saldo : saldo);
  }
  const guv = Object.fromEntries(Object.entries(werte).filter(([name]) => name.startsWith("is.")));
  const ergebnis = ebilanzSummen(guv).get("is.netIncome") ?? 0;
  if (ergebnis !== 0) werte["bs.eqLiab.equity.netIncome"] = (werte["bs.eqLiab.equity.netIncome"] ?? 0) + ergebnis;
  return werte;
}

/**
 * Positionen, die einen Wert tragen dürfen: ohne Unterpositionen mit Pflichtgrad (Muss, Summenmuss, rechnerisch
 * notwendig). Freiwillige Unterpositionen, etwa die Entwicklung des gezeichneten Kapitals, dürfen leer bleiben.
 */
export function istEbilanzBlatt(position: string): boolean {
  return Boolean(POSITIONEN[position]) && !SUMMENPOSITIONEN.has(position);
}
const SUMMENPOSITIONEN = new Set(
  Object.values(POSITIONEN)
    .filter(([req, parent]) => req !== "" && parent !== null)
    .map(([, parent]) => parent!),
);

/** Kette der Summen bis zur Wurzel (bs.ass, bs.eqLiab, is.netIncome) */
export function ebilanzSummenkette(position: string): string[] {
  const chain: string[] = [];
  for (let p: string | null = position; p; p = POSITIONEN[p]?.[1] ?? null) chain.push(p);
  return chain;
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
  // Straße und Hausnummer getrennt, wie die Stammdaten sie verlangen; ohne Hausnummer bleibt die Angabe weg
  const anschrift = splitStrasse(input.firma.strasse);
  const street = anschrift?.strasse ?? input.firma.strasse.trim();
  const houseNo = anschrift ? `${anschrift.hausnummer}${anschrift.zusatz ?? ""}` : "";
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

/**
 * Anlagenspiegel (brutto) je Position des Anlagevermögens mit Wert, als Dimension dim_changes.nt.ass.gross der Taxonomie
 * (Rechenregel notesTableStmOfChgInFAssGross: Buchwert = Bruttowert − kumulierte AfA). Die Zeilen werden zu allen
 * übergeordneten Positionen bis bs.ass.fixAss summiert; der Buchwert je Position muss dem Bilanzwert gleichen.
 */
function anlagenspiegel(input: EbilanzInput, summen: Map<string, Cents>, entity: string): string[] {
  const groups = new Map<string, AnlagenspiegelZeile>();
  const add = (position: string, z: AnlagenspiegelZeile) => {
    const g = groups.get(position) ?? { position, akAnfang: 0, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 };
    for (const key of ["akAnfang", "zugaenge", "abgaenge", "afaAnfang", "afaJahr", "afaAbgaenge"] as const) g[key] += z[key];
    groups.set(position, g);
  };
  groups.set("bs.ass.fixAss", { position: "bs.ass.fixAss", akAnfang: 0, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 });
  for (const zeile of input.anlagen) {
    if (!zeile.position.startsWith("bs.ass.fixAss.") || !POSITIONEN[zeile.position])
      throw new EbilanzError(`${zeile.position} ist keine Position des Anlagevermögens`);
    for (let p: string | null = zeile.position; p?.startsWith("bs.ass.fixAss"); p = POSITIONEN[p]![1]) add(p, zeile);
  }
  const y = input.year;
  const lines: string[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.position.localeCompare(b.position))) {
    const id = `D-AS-${g.position}`;
    const gross = g.akAnfang + g.zugaenge - g.abgaenge;
    const accDepr = g.afaAnfang + g.afaJahr - g.afaAbgaenge;
    const buchwert = gross - accDepr;
    const bilanzwert = summen.get(g.position) ?? 0;
    if (buchwert !== bilanzwert) {
      throw new EbilanzError(`Anlagenspiegel ${g.position}: Buchwert ${decimal(buchwert)}, in der Bilanz ${decimal(bilanzwert)}`);
    }
    lines.push(
      `<xbrli:context id="${id}">${entity}<xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="de-gaap-ci:dim_changes.nt.ass.gross">de-gaap-ci:${g.position}</xbrldi:explicitMember><xbrldi:explicitMember dimension="de-gaap-ci:dim_taxTrans">de-gaap-ci:dim_taxBal</xbrldi:explicitMember></xbrli:scenario></xbrli:context>`,
    );
    const facts: [string, Cents][] = [
      ["grossCost.beginning", g.akAnfang],
      ["gross.addition", g.zugaenge],
      ["gross.release", g.abgaenge],
      ["gross.diff", 0],
      ["gross.movements", 0],
      ["gross.currChanges", 0],
      ["gross", gross],
      ["accDepr.beginning", g.afaAnfang],
      ["accDepr.DeprPeriod", g.afaJahr],
      // Haben bucht nur planmäßige AfA (linear, GWG, Sammelposten); keine außerplanmäßige, Teilwert- oder Sonder-AfA
      ["accDepr.DeprPeriod.regular", g.afaJahr],
      ["accDepr.DeprPeriod.extraordinary", 0],
      ["accDepr.DeprPeriod.impairment", 0],
      ["accDepr.DeprPeriod.EStG7g_2", 0],
      ["accDepr.DeprPeriod.EStG6b_3", 0],
      ["accDepr.addition", 0],
      ["accDepr.release", g.afaAbgaenge],
      ["accDepr.diff", 0],
      ["accDepr.movements", 0],
      ["accDepr.currChanges", 0],
      ["accDepr", accDepr],
      ["revaluation", 0],
      ["all", buchwert],
      ["all_Prev_period", g.akAnfang - g.afaAnfang],
    ];
    for (const [name, value] of facts) lines.push(`<de-gaap-ci:${name} contextRef="${id}" unitRef="EUR" decimals="2">${decimal(value)}</de-gaap-ci:${name}>`);
  }
  return lines;
}

/**
 * Absender für das Übertragungsprotokoll: bei der Datenart Bilanz „Name; Straße; Hausnummer; Hausnummerzusatz;
 * Adresszusatz; PLZ; Ort; Land; Telefon; E-Mail“, höchstens 256 Zeichen (ERiC-Entwicklerhandbuch 43, Kap. 9.7).
 */
export function datenlieferant(firma: EbilanzInput["firma"]): string {
  const anschrift = splitStrasse(firma.strasse);
  const teile = [
    firma.name,
    anschrift?.strasse ?? firma.strasse,
    anschrift?.hausnummer ?? "",
    anschrift?.zusatz ?? "",
    "",
    firma.plz,
    firma.ort,
    "Deutschland",
    firma.telefon ?? "",
    firma.email ?? "",
  ];
  return teile
    .map((t) => t.replaceAll(";", ",").trim())
    .join("; ")
    .slice(0, 256);
}

/** E-Bilanz im ELSTER-Umschlag, Datenart Bilanz; Empfänger ist das Finanzamt nach der Bundesfinanzamtsnummer */
export function buildEbilanzXml(input: EbilanzInput): string {
  if (!/^\d{13}$/.test(input.steuernummer13)) throw new EbilanzError("Steuernummer im ELSTER-Format (13 Ziffern) fehlt");
  const bilanz = ebilanzSummen(input.werte);
  // Betriebsvermögensvergleich: Eigenkapital zu Beginn und Ende, Ausschüttungen, Einlagen; er muss das Jahresergebnis ergeben
  const summen = ebilanzSummen({
    ...input.werte,
    "BVV.profitLoss.assetsCurrentYear": (bilanz.get("bs.eqLiab.equity") ?? 0) - (bilanz.get("bs.ass.deficitNotCoveredByCapital") ?? 0),
    "BVV.profitLoss.assetsPreviousYear.assets": input.bvv.eigenkapitalVorjahr,
    "BVV.profitLoss.withdrawalDistrib": input.bvv.ausschuettungen,
    "BVV.profitLoss.contribution": input.bvv.einlagen,
  });
  const bvv = summen.get("BVV.profitLoss") ?? 0;
  const ergebnis = summen.get("is.netIncome") ?? 0;
  if (bvv !== ergebnis) {
    throw new EbilanzError(
      `Der Betriebsvermögensvergleich ergibt ${decimal(bvv)}, die GuV ${decimal(ergebnis)}; Eigenkapital, Ausschüttungen und Einlagen prüfen`,
    );
  }
  const aktiva = summen.get("bs.ass") ?? 0;
  const passiva = summen.get("bs.eqLiab") ?? 0;
  if (aktiva !== passiva) throw new EbilanzError(`Aktiva (${decimal(aktiva)}) und Passiva (${decimal(passiva)}) sind nicht gleich`);
  const entity = `<xbrli:entity><xbrli:identifier scheme="http://www.rzf-nrw.de/Steuernummer">${input.steuernummer13}</xbrli:identifier></xbrli:entity>`;
  const y = input.year;
  const instanz = [
    `<ebilanz:EBilanz version="000002" xmlns:ebilanz="http://rzf.fin-nrw.de/RMS/EBilanz/2016/XMLSchema">`,
    `<ebilanz:stichtag>${y}1231</ebilanz:stichtag>`,
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:de-gcd="${GCD}" xmlns:de-gaap-ci="${GAAP}">`,
    `<link:schemaRef xlink:type="simple" xlink:href="${GCD}/de-gcd-2025-04-01-shell.xsd"/>`,
    `<link:schemaRef xlink:type="simple" xlink:href="${GAAP}/de-gaap-ci-2025-04-01-shell-fiscal.xsd"/>`,
    `<xbrli:context id="I-AKTJAHR">${entity}<xbrli:period><xbrli:instant>${y}-12-31</xbrli:instant></xbrli:period></xbrli:context>`,
    `<xbrli:context id="D-AKTJAHR">${entity}<xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period></xbrli:context>`,
    `<xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`,
    `<xbrli:unit id="PURE"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`,
    ...anlagenspiegel(input, summen, entity),
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
      datenlieferant: datenlieferant(input.firma),
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: input.steuernummer13.slice(0, 4) }, produktVersion: input.produktVersion, nutzdaten: instanz }],
  );
}
