import type { AnlagenspiegelZeile, Cents, EbilanzZuordnung } from "@haben/core";
import { splitStrasse } from "../nachricht.ts";
import { elsterXml, escapeXml } from "../xml.ts";
import { type EbilanzKontensaldo, kontennachweis, kontennachweisXml } from "./kontennachweis.ts";
import { EbilanzError, type EbilanzTaxonomie, ebilanzPositionen, ebilanzSaldoSeite, ebilanzSummen, ebilanzTaxonomieDatum } from "./taxonomie.ts";

/*
 * E-Bilanz (§ 5b EStG) einer Kapitalgesellschaft als XBRL-Instanz in der HGB-Taxonomie 6.9 oder 6.10 (taxonomie.ts), im
 * ELSTER-Umschlag der Datenart „Bilanz“ (ERiC-Dokumentation, Schnittstellenbeschreibungen/Sonstige/Bilanz,
 * ebilanz_000002.xsd; Beispiele Taxonomie_6_9 und Taxonomie_6_10). Übermittelt wird eine Steuerbilanz (accountingStandard
 * AO) mit Bilanz und GuV nach dem Gesamtkostenverfahren als Einzelabschluss, mit dem Kontennachweis (kontennachweis.ts).
 *
 * Die Werte kommen je Taxonomie-Position (Blatt) herein; Summen rechnet der Baustein nach den Rechenregeln der Taxonomie
 * (summation-item mit Gewicht) selbst. Mussfelder und Summenmussfelder ohne Wert stehen leer (xsi:nil), wie die
 * Finanzverwaltung es für nicht belegte Mussfelder vorsieht.
 */

export interface EbilanzInput {
  /** Wirtschaftsjahr = Kalenderjahr */
  year: number;
  /** Taxonomie nach dem Wirtschaftsjahr, ebilanzTaxonomie() */
  taxonomie: EbilanzTaxonomie;
  steuernummer13: string;
  firma: { name: string; strasse: string; plz: string; ort: string; telefon?: string; email?: string };
  /** Werte je Blattposition der Taxonomie (ohne Präfix), im Vorzeichen der Position: Soll-Position Soll positiv */
  werte: Readonly<Record<string, Cents>>;
  /** Salden der Sachkonten je Position für den Kontennachweis */
  konten: readonly EbilanzKontensaldo[];
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

/**
 * Werte je Position aus den zugeordneten Salden (Soll − Haben): Soll-Positionen mit dem Saldo, Haben-Positionen mit
 * seinem Gegenwert. Das Jahresergebnis der GuV steht als Jahresüberschuss/-fehlbetrag im Eigenkapital, weil Haben es
 * nicht auf ein Konto abschließt.
 */
export function ebilanzWerte(zuordnung: readonly EbilanzZuordnung[], version: EbilanzTaxonomie): Record<string, Cents> {
  const werte: Record<string, Cents> = {};
  for (const { position, betrag } of ebilanzKontensalden(zuordnung, () => "", version)) werte[position] = (werte[position] ?? 0) + betrag;
  const guv = Object.fromEntries(Object.entries(werte).filter(([name]) => name.startsWith("is.")));
  const ergebnis = ebilanzSummen(guv, version).get("is.netIncome") ?? 0;
  if (ergebnis !== 0) werte["bs.eqLiab.equity.netIncome"] = (werte["bs.eqLiab.equity.netIncome"] ?? 0) + ergebnis;
  return werte;
}

/** Salden der Konten im Vorzeichen ihrer Position (Soll − Haben bei Soll-Positionen, Haben − Soll bei Haben-Positionen) */
export function ebilanzKontensalden(
  zuordnung: readonly EbilanzZuordnung[],
  kontoName: (account: string) => string,
  version: EbilanzTaxonomie,
): EbilanzKontensaldo[] {
  return zuordnung.map(({ account, saldo, position }) => ({
    account,
    name: kontoName(account),
    position,
    betrag: ebilanzSaldoSeite(version, position) === "credit" ? -saldo : saldo,
  }));
}

const decimal = (cents: Cents) => `${cents < 0 ? "-" : ""}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** Fakten von Bilanz und GuV: alle Positionen mit Wert, dazu Muss- und Summenmussfelder leer */
function gaapFacts(summen: Map<string, Cents>, version: EbilanzTaxonomie): string[] {
  return Object.entries(ebilanzPositionen(version))
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

/**
 * Stammdaten (GCD-Modul): Bericht, Zeitraum, Unternehmen; Aufbau wie in den Beispielen der ERiC-Dokumentation.
 * mitKontensalden: der Berichtsteil Kontensalden (KS) ist angekündigt und belegt.
 */
function gcdFacts(input: EbilanzInput, mitKontensalden: boolean, mitAnlagenspiegel: boolean): string[] {
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
  // Ohne KKE, SGE und SGEP: für Kapitalgesellschaften rechtsformfremd; Taxonomie 6.9 verbietet sie auch leer, ERiC prüft
  // das ab 43.5 (Fehler 170185126, ERiC-Releasenotes 45.1, Kap. 7.1.16.1)
  const elements = ["B", "BAL", "BVV", "EB", "EV", "GuV", "KS", "STU"] as const;
  // Bilanz, Anlagenspiegel, GuV mit Betriebsvermögensvergleich, Kontennachweis
  const BERICHTSTEILE = new Set<string>(["B", "BVV", "GuV", ...(mitAnlagenspiegel ? ["BAL"] : []), ...(mitKontensalden ? ["KS"] : [])]);
  return [
    fact("doc.id.generationDate", input.erstellt),
    ...group("report.id.reportStatus", [fact("report.id.reportStatus.reportStatus.E")]),
    ...group("report.id.revisionStatus", [fact("report.id.revisionStatus.revisionStatus.E")]),
    ...group(
      "report.id.reportElement",
      elements.map((e) => fact(`report.id.reportElement.reportElements.${e}`, BERICHTSTEILE.has(e) ? undefined : null)),
    ),
    // Nur 6.9 kennt die Begründung, warum der Kontennachweis fehlt (Technischer Leitfaden 6.9, Tz. B.12), als Mussfeld,
    // mit Kontennachweis leer; 6.10 hat sie gestrichen (Änderungsnachweis zur Taxonomie 6.10, Nr. 2)
    ...(input.taxonomie === "6.9" ? [fact("report.id.reportElement.reportElements.transmissionNotYetPossible", mitKontensalden ? null : "NoKS")] : []),
    ...group("report.id.statementType", [fact("report.id.statementType.statementType.E")]),
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
    // Gesellschafter: Mussfeld der Stammdaten, bei Kapitalgesellschaften ohne Angaben (sie gelten Personengesellschaften).
    // Die neuen Prüfregeln der Taxonomie 6.10 zu Steuernummer, IdNr. und W-IdNr. der Gesellschafter und zu „noch nicht
    // vergeben“ [idNotAssigned] gelten nur für Personengesellschaften (Technischer Leitfaden 6.10, Tz. B.14.3.1.19 und
    // B.14.3.1.20; ERiC-Releasenotes 45.1, Kap. 3.1.8.1); idNotAssigned ist kein Mussfeld und bleibt weg.
    // Option nach § 1a KStG, Gesellschaftergruppe, laufende Nummer, Sonder- und Ergänzungsbilanz sowie die steuerliche
    // Bilanzart fehlen: rechtsformfremd für Kapitalgesellschaften, ab ERiC 43.5 auch leer abgelehnt (siehe oben)
    ...group("company.id.shareholder", [
      fact("company.id.shareholder.name", null),
      fact("company.id.shareholder.id", null),
      fact("company.id.shareholder.taxnumber", null),
      fact("company.id.shareholder.taxid", null),
      fact("company.id.shareholder.WID", null),
      ...group("company.id.shareholder.legalStatus", [fact("company.id.shareholder.legalStatus.legalStatus.NPP", null)]),
      ...group("company.id.shareholder.ShareDivideKey", [
        fact("company.id.shareholder.ShareDivideKey.numerator", null),
        fact("company.id.shareholder.ShareDivideKey.denominator", null),
      ]),
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
function anlagenspiegel(input: Pick<EbilanzInput, "year" | "anlagen" | "taxonomie">, summen: Map<string, Cents>, entity: string): string[] {
  const positionen = ebilanzPositionen(input.taxonomie);
  const groups = new Map<string, AnlagenspiegelZeile>();
  const add = (position: string, z: AnlagenspiegelZeile) => {
    const g = groups.get(position) ?? { position, akAnfang: 0, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 };
    for (const key of ["akAnfang", "zugaenge", "abgaenge", "afaAnfang", "afaJahr", "afaAbgaenge"] as const) g[key] += z[key];
    groups.set(position, g);
  };
  groups.set("bs.ass.fixAss", { position: "bs.ass.fixAss", akAnfang: 0, zugaenge: 0, abgaenge: 0, afaAnfang: 0, afaJahr: 0, afaAbgaenge: 0 });
  for (const zeile of input.anlagen) {
    if (!zeile.position.startsWith("bs.ass.fixAss.") || !positionen[zeile.position])
      throw new EbilanzError(`${zeile.position} ist keine Position des Anlagevermögens`);
    for (let p: string | null = zeile.position; p?.startsWith("bs.ass.fixAss"); p = positionen[p]![1]) add(p, zeile);
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

/**
 * Prüft, was ERiC sonst erst beim Senden fände, ohne XML zu bauen: Betriebsvermögensvergleich gegen GuV, Aktiva gegen
 * Passiva, Anlagenspiegel gegen Bilanz. Gibt die Summen samt Betriebsvermögensvergleich zurück.
 */
export function ebilanzPruefen(input: Pick<EbilanzInput, "year" | "taxonomie" | "werte" | "bvv" | "anlagen">): Map<string, Cents> {
  const bilanz = ebilanzSummen(input.werte, input.taxonomie);
  // Betriebsvermögensvergleich: Eigenkapital zu Beginn und Ende, Ausschüttungen, Einlagen; er muss das Jahresergebnis ergeben
  const summen = ebilanzSummen(
    {
      ...input.werte,
      "BVV.profitLoss.assetsCurrentYear": (bilanz.get("bs.eqLiab.equity") ?? 0) - (bilanz.get("bs.ass.deficitNotCoveredByCapital") ?? 0),
      "BVV.profitLoss.assetsPreviousYear.assets": input.bvv.eigenkapitalVorjahr,
      "BVV.profitLoss.withdrawalDistrib": input.bvv.ausschuettungen,
      "BVV.profitLoss.contribution": input.bvv.einlagen,
    },
    input.taxonomie,
  );
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
  anlagenspiegel(input, summen, "");
  return summen;
}

/**
 * Ab 6.10 muss der Buchwert des Anlagevermögens im Anlagenspiegel dem Wert in der Bilanz gleichen, auch wenn dort keiner
 * steht (Technischer Leitfaden 6.10, Tz. B.14.12.1 g; ERiC-Releasenotes 45.1, ERU-24975), und leer lässt ERiC ihn im
 * Anlagenspiegel nicht. Ohne Anlagen im Jahr bleibt der Anlagenspiegel deshalb weg (in 6.9 steht er wie bisher mit 0);
 * sind alle Anlagen abgeschrieben oder abgegangen, stehen ihre Positionen in der Bilanz mit 0, belegt im Kontennachweis
 * mit dem Eintrag ohne Konto, weil kein Konto einen Saldo hat.
 */
function anlagenOhneBuchwert(input: Pick<EbilanzInput, "taxonomie" | "anlagen">, summen: Map<string, Cents>): Map<string, Cents> {
  if (input.taxonomie === "6.9" || summen.has("bs.ass.fixAss")) return summen;
  const result = new Map(summen);
  const positionen = ebilanzPositionen(input.taxonomie);
  for (const { position } of input.anlagen) {
    for (let p: string | null = position; p && !result.has(p); p = positionen[p]?.[1] ?? null) result.set(p, 0);
  }
  return result;
}

/** E-Bilanz im ELSTER-Umschlag, Datenart Bilanz; Empfänger ist das Finanzamt nach der Bundesfinanzamtsnummer */
export function buildEbilanzXml(input: EbilanzInput): string {
  if (!/^\d{13}$/.test(input.steuernummer13)) throw new EbilanzError("Steuernummer im ELSTER-Format (13 Ziffern) fehlt");
  const mitAnlagenspiegel = input.taxonomie === "6.9" || input.anlagen.length > 0;
  const summen = anlagenOhneBuchwert(input, ebilanzPruefen(input));
  const nachweis = kontennachweis(summen, input.konten, input.taxonomie);
  // 6.9 verlangt, wenn KS angekündigt ist, zu Bilanz und GuV je mindestens einen Kontensaldo (Technischer Leitfaden 6.9,
  // Tz. B.12); fehlt einer, bleibt es dort bei der Begründung. 6.10 verlangt den Nachweis je Position (kontennachweis.ts).
  const mitKontensalden = input.taxonomie === "6.9" ? ["bs.", "is."].every((teil) => nachweis.some((e) => e.position.startsWith(teil))) : nachweis.length > 0;
  const datum = ebilanzTaxonomieDatum(input.taxonomie);
  const gcd = `http://www.xbrl.de/taxonomies/de-gcd-${datum}`;
  const gaap = `http://www.xbrl.de/taxonomies/de-gaap-ci-${datum}`;
  const entity = `<xbrli:entity><xbrli:identifier scheme="http://www.rzf-nrw.de/Steuernummer">${input.steuernummer13}</xbrli:identifier></xbrli:entity>`;
  const y = input.year;
  const instanz = [
    `<ebilanz:EBilanz version="000002" xmlns:ebilanz="http://rzf.fin-nrw.de/RMS/EBilanz/2016/XMLSchema">`,
    `<ebilanz:stichtag>${y}1231</ebilanz:stichtag>`,
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:de-gcd="${gcd}" xmlns:de-gaap-ci="${gaap}">`,
    `<link:schemaRef xlink:type="simple" xlink:href="${gcd}/de-gcd-${datum}-shell.xsd"/>`,
    `<link:schemaRef xlink:type="simple" xlink:href="${gaap}/de-gaap-ci-${datum}-shell-fiscal.xsd"/>`,
    `<xbrli:context id="I-AKTJAHR">${entity}<xbrli:period><xbrli:instant>${y}-12-31</xbrli:instant></xbrli:period></xbrli:context>`,
    `<xbrli:context id="D-AKTJAHR">${entity}<xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period></xbrli:context>`,
    `<xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`,
    `<xbrli:unit id="PURE"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>`,
    ...(mitAnlagenspiegel ? anlagenspiegel(input, summen, entity) : []),
    ...gcdFacts(input, mitKontensalden, mitAnlagenspiegel),
    ...gaapFacts(summen, input.taxonomie),
    ...(mitKontensalden ? kontennachweisXml(nachweis, input.taxonomie) : []),
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
