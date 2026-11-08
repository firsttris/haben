import { ASSET_ACCOUNTS, type ScheduleAsset, type ScheduleYear } from "./afa.ts";
import { postenForSaldo, type Posten } from "./hgb.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";
import { STEUER_KONTEN } from "./steuerzahlung.ts";
import { DARLEHEN_KONTEN } from "./darlehen.ts";

/*
 * Zuordnung der Konten zu den Positionen der E-Bilanz (§ 5b EStG, HGB-Taxonomien 6.9 und 6.10, Kerntaxonomie de-gaap-ci). Die
 * Taxonomie verlangt mehr Gliederung als der Kleinst-Abschluss (hgb.ts): Umsatzerlöse nach Umsatzsteuertatbestand,
 * sonstige Aufwendungen nach Art, Anlagen nach Bilanzposition für den Anlagenspiegel.
 *
 * Die Konten, die Haben selbst bucht, haben eine feste Position (KONTEN). Für alle anderen gilt die Auffangposition des
 * Kleinst-Postens, den der DATEV-Kontenrahmen dem Konto gibt („nicht zuordenbar“ bzw. „übrige“, AUFFANG); für Anlagen,
 * Eigenkapital und Steuern gibt es keine, dort muss das Konto zugeordnet sein. Die Positionen sind Blätter der
 * Rechenregeln der Taxonomie; das prüft packages/elster/src/ebilanz/zuordnung.test.ts gegen den Taxonomie-Auszug.
 */

const IS = "is.netIncome.regular.operatingTC";
const SALES = `${IS}.grossTradingProfit.totalOutput.netSales`;
const GS = `${SALES}.grossSales`;
const MAT = `${IS}.grossTradingProfit.materialServices`;
const OC = `${IS}.otherCost`;
const DEPR = `${IS}.deprAmort.fixAss.tan`;
const EQUIPM = "bs.ass.fixAss.tan.otherEquipm";

/** Position bei Soll-Saldo, Position bei Haben-Saldo; fehlt die zweite, gilt die erste mit negativem Wert */
export type EbilanzZiel = readonly [soll: string, haben?: string];

const VAT_RECEIVABLE = "bs.ass.currAss.receiv.other.vat";
const TAX_LIABILITY = "bs.eqLiab.liab.other.theroffTax.vat";
const UMSATZSTEUER: EbilanzZiel = [VAT_RECEIVABLE, TAX_LIABILITY];
const GESELLSCHAFTER: EbilanzZiel = ["bs.ass.currAss.receiv.other.shareholders", "bs.eqLiab.liab.shareholders.gmbh"];

/** Aufwand der Ausgabenkategorien; Anlagen (hardware, anlage) stehen bei den Anlagekonten */
const KATEGORIEN: Record<Exclude<ExpenseCategory, "hardware" | "anlage" | "einfuhrumsatzsteuer">, string> = {
  // DATEV „Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen)“; der Empfänger kann im Ausland sitzen
  software: `${OC}.concessLicenses.nonallocable`,
  // DATEV 4806/6495 „Wartungskosten für Hard- und Software“
  edv: `${OC}.fixing`,
  // Erhaltungsaufwand für andere Anlagen und Betriebs- und Geschäftsausstattung (DATEV 4805/6470)
  reparatur: `${OC}.fixing`,
  // Miete für unbewegliche Wirtschaftsgüter an Dritte (DATEV 4210/6310); an Gesellschafter wäre leaseFix.shareholders
  miete: `${OC}.leaseFix.other`,
  telefon: `${OC}.communication`,
  internet: `${OC}.communication`,
  porto: `${OC}.communication`,
  buero: `${OC}.administration`,
  literatur: `${OC}.administration`,
  betriebsbedarf: `${OC}.miscellaneous`,
  fortbildung: `${OC}.training`,
  // Reisekosten Unternehmer: die Taxonomie kennt nur Reisekosten Arbeitnehmer
  fahrtkosten: `${OC}.miscellaneous`,
  uebernachtung: `${OC}.miscellaneous`,
  werbung: `${OC}.marketing`,
  // Gebucht wird der volle Betrag; den nicht abziehbaren Teil (§ 4 Abs. 5 Nr. 2 EStG) rechnet die Steuerberatung heraus
  bewirtung: `${OC}.limitedDeductible.entertainment.other`,
  // Bis 50 € je Empfänger und Jahr abziehbar (§ 4 Abs. 5 Nr. 1 EStG), so die Kategorie
  geschenke: `${OC}.limitedDeductible.gifts.deductible`,
  beratung: `${OC}.legalConsulting`,
  buchfuehrung: `${OC}.legalConsulting`,
  // Mit oder ohne Vorsteuer, je nach Beleg
  wareneinkauf: `${MAT}.material.purchased.unknownVAT`,
  fremdleistung: `${MAT}.services.unknownVAT`,
  geldverkehr: `${OC}.miscellaneous`,
  kfzBetrieb: `${OC}.vehicles`,
  kfzVersicherung: `${OC}.vehicles`,
  kfzReparatur: `${OC}.vehicles`,
  kfzLeasing: `${OC}.vehicles`,
  kfzSonstige: `${OC}.vehicles`,
  kfzSteuer: "is.netIncome.otherTaxes.other",
  versicherung: `${OC}.insurance`,
  beitraege: `${OC}.insurance`,
  // Soziale Abgaben bzw. Altersversorgung der Arbeitnehmer (§ 275 Abs. 2 Nr. 6b HGB)
  berufsgenossenschaft: "is.netIncome.regular.operatingTC.staff.social.socExp.other",
  versorgungskassen: "is.netIncome.regular.operatingTC.staff.social.pensions.other",
  sonstiges: `${OC}.miscellaneous`,
};

/**
 * Steuern vom Einkommen und Ertrag, ihre Rückstellungen und die nicht abziehbaren Betriebsausgaben (DATEV-Kontenrahmen
 * 2026), wie sie die Steuerberechnung (koerperschaft.ts) liest
 */
const T = "is.netIncome.tax";
const LIMITED = `${OC}.limitedDeductible`;
const ERTRAGSTEUERN: Record<Kontenrahmen, Record<string, EbilanzZiel>> = {
  SKR03: {
    "2200": [`${T}.kst`],
    "2203": [`${T}.prevPeriodPaid.kst`],
    "2204": [`${T}.prevPeriodReceived.kst`],
    "2208": [`${T}.soli.other`],
    "2209": [`${T}.prevPeriodPaid.soli`],
    "2210": [`${T}.prevPeriodReceived.soli`],
    "2213": [`${T}.kest.creditable`],
    "2216": [`${T}.soli.kestcreditable`],
    // Nachzahlung im Soll, Erstattung im Haben
    "2281": [`${T}.prevPeriodPaid.gewst`, `${T}.prevPeriodReceived.gewst`],
    "2283": [`${T}.releaseTaxProv.Gew`],
    "4320": [`${T}.gewst`],
    "0955": ["bs.eqLiab.accruals.tax.misc"],
    "0956": ["bs.eqLiab.accruals.tax.gewst"],
    "0963": ["bs.eqLiab.accruals.tax.kst"],
    // Nicht abziehbare Betriebsausgaben (§ 4 Abs. 5 EStG)
    "4635": [`${LIMITED}.gifts.nondeductible`],
    "4636": [`${LIMITED}.gifts.nondeductible`],
    "4637": [`${LIMITED}.gifts.nondeductible`],
    "4652": [`${LIMITED}.other.miscellaneous.nonDeductible`],
    "4654": [`${LIMITED}.entertainment.nonDeductible`],
    "4655": [`${LIMITED}.other.miscellaneous.nonDeductible`],
  },
  SKR04: {
    "7600": [`${T}.kst`],
    "7603": [`${T}.prevPeriodPaid.kst`],
    "7604": [`${T}.prevPeriodReceived.kst`],
    "7607": [`${T}.prevPeriodReceived.soli`],
    "7608": [`${T}.soli.other`],
    "7609": [`${T}.prevPeriodPaid.soli`],
    "7610": [`${T}.gewst`],
    "7630": [`${T}.kest.creditable`],
    "7633": [`${T}.soli.kestcreditable`],
    "7641": [`${T}.prevPeriodPaid.gewst`, `${T}.prevPeriodReceived.gewst`],
    "7643": [`${T}.releaseTaxProv.Gew`],
    "3020": ["bs.eqLiab.accruals.tax.misc"],
    "3035": ["bs.eqLiab.accruals.tax.gewst"],
    "3040": ["bs.eqLiab.accruals.tax.kst"],
    "6620": [`${LIMITED}.gifts.nondeductible`],
    "6621": [`${LIMITED}.gifts.nondeductible`],
    "6622": [`${LIMITED}.gifts.nondeductible`],
    "6642": [`${LIMITED}.other.miscellaneous.nonDeductible`],
    "6644": [`${LIMITED}.entertainment.nonDeductible`],
    "6645": [`${LIMITED}.other.miscellaneous.nonDeductible`],
  },
};

const EB_KAPEST_SCHULD = "bs.eqLiab.liab.other.theroffTax.otherTaxes";
const EB_KAPEST_FORDERUNG = "bs.ass.currAss.receiv.other.otherTaxRec";

/*
 * Weitere Konten gegenüber Gesellschaftern (§ 42 Abs. 3 GmbHG: gesondert auszuweisen) auf den Positionen der Taxonomie
 * für Gesellschafter statt auf den Auffangpositionen; Soll-Saldo als Forderung, Haben-Saldo als Verbindlichkeit, wo der
 * DATEV-Kontenrahmen beide Seiten kennt. Ausleihungen an Gesellschafter fehlen: Finanzanlagen bucht Haben nicht.
 */
const LUL_GES: EbilanzZiel = ["bs.ass.currAss.receiv.trade.shareholders", "bs.eqLiab.liab.trade.shareholders"];
const GMBH_GES: EbilanzZiel = ["bs.ass.currAss.receiv.shareholders.gmbh", "bs.eqLiab.liab.shareholders.gmbh"];
const SONSTIGE_GES: EbilanzZiel = ["bs.ass.currAss.receiv.shareholders.misc", "bs.eqLiab.liab.shareholders.misc"];
const VERB_GES: EbilanzZiel = ["bs.eqLiab.liab.shareholders.gmbh"];
const alle = (konten: string, ziel: EbilanzZiel): [string, EbilanzZiel][] => konten.split(" ").map((k) => [k, ziel]);

/** Weitere Konten der Kapitalgesellschaft (DATEV-Kontenrahmen 2026, SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175) */
const KAPITAL: Record<Kontenrahmen, Record<string, EbilanzZiel>> = {
  SKR03: {
    ...Object.fromEntries([
      ...alle("1490 1491 1495", LUL_GES),
      ...alle("1650 1651 1655 1658", LUL_GES),
      ...alle("1381 1382 1383 1665 1666", GMBH_GES),
      ...alle("1507 1508", SONSTIGE_GES),
      ...alle("0755 1667 1668", VERB_GES),
    ]),
    // Mit Restlaufzeit: im DATEV-Kontenrahmen nur unter den Verbindlichkeiten
    "0731": [GESELLSCHAFTER[1]!],
    "0740": [GESELLSCHAFTER[1]!],
    "0750": [GESELLSCHAFTER[1]!],
    "0800": ["bs.eqLiab.equity.subscribed.corp"],
    // Einbehaltene Kapitalertragsteuer, Soli und Kirchensteuer auf offene Ausschüttungen (ausschuettung.ts)
    "1746": [EB_KAPEST_FORDERUNG, EB_KAPEST_SCHULD],
    "0860": ["bs.eqLiab.equity.retainedEarnings"],
    "0868": ["bs.eqLiab.equity.retainedEarnings"],
  },
  SKR04: {
    ...Object.fromEntries([
      ...alle("1250 1251 1255 3340 3341 3345 3348", LUL_GES),
      ...alle("1307 1308 1309 3640 3641", GMBH_GES),
      ...alle("1330 1331 1335", SONSTIGE_GES),
      ...alle("3517 3519 3642 3643", VERB_GES),
    ]),
    "3511": GESELLSCHAFTER,
    "3514": [GESELLSCHAFTER[1]!],
    "2900": ["bs.eqLiab.equity.subscribed.corp"],
    "3760": [EB_KAPEST_FORDERUNG, EB_KAPEST_SCHULD],
    "2970": ["bs.eqLiab.equity.retainedEarnings"],
    "2978": ["bs.eqLiab.equity.retainedEarnings"],
  },
};

const STAFF = `${IS}.staff`;

/**
 * Konten der Lohnbuchung (lohn-buchung.ts). Gehälter auf „übrige“ Löhne und Gehälter; Geschäftsführer und Minijobs fragt
 * die Taxonomie als Mussfeld getrennt ab, die Pauschsteuer im Minijob gehört zu dessen Lohn (DATEV 4194 / 6036 unter
 * „Löhne und Gehälter“). Arbeitgeberanteile und Umlagen sind soziale Abgaben; ihr Mussfeld „other“ steht neben dem für
 * angestellte Mitunternehmer (§ 15 EStG), die Haben nicht abrechnet. Die Verbindlichkeiten haben eigene Davon-Positionen;
 * mit Soll-Saldo (überzahlt) sind sie Forderungen gegen Beschäftigte, Finanzamt bzw. Sozialversicherung.
 */
function lohnKonten(kontenrahmen: Kontenrahmen): [string, EbilanzZiel][] {
  const k = LOHN_KONTEN[kontenrahmen];
  const sozial = `${STAFF}.social.socExp.other`;
  return [
    [k.gehaelter, [`${STAFF}.salaries.misc`]],
    [k.ggf, [`${STAFF}.salaries.managerPartner`]],
    [k.minijob, [`${STAFF}.salaries.minijobs`]],
    [k.minijobPauschsteuer, [`${STAFF}.salaries.minijobs`]],
    [k.sozial, [sozial]],
    [k.minijobSozial, [sozial]],
    [k.verbLohn, ["bs.ass.currAss.receiv.other.employees", "bs.eqLiab.liab.other.employees"]],
    [k.verbLohnsteuer, [EB_KAPEST_FORDERUNG, EB_KAPEST_SCHULD]],
    [k.verbSv, ["bs.ass.currAss.receiv.other.socInsur", "bs.eqLiab.liab.other.thereoffSocSec"]],
  ];
}

const INTEREST = "is.netIncome.regular.fin.netInterest";

/**
 * Konten der Steuerzahlungen im Bankabgleich (steuerzahlung.ts): Umsatzsteuer früherer Jahre bei der Umsatzsteuer, Zinsen
 * und Zuschläge nach ihrer Abziehbarkeit auf den Positionen der Taxonomie für steuerliche Nebenleistungen, Verspätungszuschläge
 * und Zwangsgelder bei den sonstigen beschränkt abziehbaren Aufwendungen, Erstattungszinsen § 233a AO bei den Zinserträgen
 */
function steuerzahlungKonten(kontenrahmen: Kontenrahmen): [string, EbilanzZiel][] {
  const k = STEUER_KONTEN[kontenrahmen];
  const zinsen = `${INTEREST}.expenses.regularInterest`;
  return [
    [k.ustVorjahr, UMSATZSTEUER],
    [k.ustFruehereJahre, UMSATZSTEUER],
    [k.zinsen233aAbziehbar, [`${zinsen}.AO233a.deductible`]],
    [k.zinsen233aNichtAbziehbar, [`${zinsen}.AO233a.nondeductible`]],
    [k.zinsenAbziehbar, [`${zinsen}.AO234to237.deductible`]],
    [k.zinsenNichtAbziehbar, [`${zinsen}.AO234to237.nonDeductible`]],
    [k.nebenleistungenAbziehbar, [`${zinsen}.relatedPayments.deduct`]],
    [k.nebenleistungenNichtAbziehbar, [`${zinsen}.relatedPayments.nondeduct`]],
    [k.nebenleistungenGewst, [`${zinsen}.relatedPayments.nondeduct`]],
    [k.verspaetungAbziehbar, [`${LIMITED}.other.miscellaneous.deductible`]],
    [k.verspaetungNichtAbziehbar, [`${LIMITED}.other.miscellaneous.nonDeductible`]],
    [k.erstattungszinsen, [`${INTEREST}.income.deposits.AO233a`]],
  ];
}

/**
 * Darlehen (darlehen.ts): Verbindlichkeiten gegenüber Kreditinstituten bzw. sonstige Verbindlichkeiten, die Restlaufzeit
 * vermerkt die Bilanz (bilanzvermerke.ts); Zinsen als regelmäßige Zinsaufwendungen, Kreditprovisionen als Kreditgebühren
 */
function darlehenKonten(kontenrahmen: Kontenrahmen): [string, EbilanzZiel][] {
  const k = DARLEHEN_KONTEN[kontenrahmen];
  const zinsen = `${INTEREST}.expenses.regularInterest.other`;
  return [
    // Im Soll (überzahlt) eine sonstige Forderung, wie im DATEV-Kontenrahmen („Verbindlichkeiten … oder sonstige Vermögensgegenstände“)
    ...Object.values(k.bank).map((konto): [string, EbilanzZiel] => [konto, ["bs.ass.currAss.receiv.other.misc", "bs.eqLiab.liab.bank.other"]]),
    ...Object.values(k.sonstige).map((konto): [string, EbilanzZiel] => [konto, ["bs.eqLiab.liab.other.other"]]),
    [k.zinsenKurzfristig, [zinsen]],
    [k.zinsenLangfristig, [zinsen]],
    [k.zinsenAnlagevermoegen, [zinsen]],
    [k.gebuehren, [`${INTEREST}.expenses.loanFees`]],
  ];
}

function kontenOf(kontenrahmen: Kontenrahmen): Record<string, EbilanzZiel> {
  const a = ACCOUNTS[kontenrahmen];
  const anlagen = ASSET_ACCOUNTS[kontenrahmen];
  const entries: [string, EbilanzZiel][] = [
    [a.kasse, ["bs.ass.currAss.cashEquiv.cash"]],
    [a.bank, ["bs.ass.currAss.cashEquiv.bank", "bs.eqLiab.liab.bank.other"]],
    // Guthaben bei Zahlungsdienstleistern und Geld unterwegs
    [a.geldtransit, ["bs.ass.currAss.cashEquiv.other", "bs.eqLiab.liab.other.other"]],
    // Im Haben: Überzahlungen von Kunden; Verbindlichkeiten im Soll: Guthaben bei Lieferanten (DATEV „A oder B“)
    [a.forderungen, ["bs.ass.currAss.receiv.trade.other", "bs.eqLiab.liab.other.other"]],
    [a.verbindlichkeiten, ["bs.ass.currAss.receiv.other.other", "bs.eqLiab.liab.trade.genOther"]],
    ...[
      ...Object.values(a.vorsteuer),
      a.vorsteuerRc,
      ...Object.values(a.vorsteuerIge),
      ...Object.values(a.ust),
      a.ustRc,
      ...Object.values(a.ustIge),
      a.ustVorauszahlung,
      a.sondervorauszahlung,
      // Entstandene Einfuhrumsatzsteuer: Vorsteuer wie die übrigen
      EXPENSE_CATEGORIES.einfuhrumsatzsteuer[kontenrahmen],
    ].map((k): [string, EbilanzZiel] => [k, UMSATZSTEUER]),
    // Umsatzsteuer nicht fällig (Ist-Versteuerung): im DATEV-Kontenrahmen unter den Rückstellungen
    ...Object.values(a.ustNichtFaellig).map((k): [string, EbilanzZiel] => [k, [VAT_RECEIVABLE, "bs.eqLiab.accruals.tax.other"]]),
    [a.gesellschafter, GESELLSCHAFTER],
    [a.erloese[1900], [`${GS}.generalRateVAT`]],
    [a.erloese[700], [`${GS}.reducedRateVAT`]],
    [a.erloese[0], [`${GS}.unknownVAT`]],
    // Leistungsort im Ausland: in Deutschland nicht steuerbar
    [a.erloeseSonder.reverse_charge, [`${GS}.untaxable`]],
    [a.erloeseSonder.drittland, [`${GS}.untaxable`]],
    // Steuerfreie Lieferungen mit Vorsteuerabzug: innergemeinschaftlich an Abnehmer mit USt-IdNr. und Ausfuhr
    [a.erloeseSonder.ig_lieferung, [`${GS}.taxExemptUStG4_1b.VIES_ID`]],
    [a.erloeseSonder.ausfuhr, [`${GS}.taxExemptUStG4_1a`]],
    [a.erloeseSonder.steuerfrei, [`${GS}.taxExemptUStG4_8.other`]],
    [a.erloeseSonder.kleinunternehmer, [`${GS}.taxExemptUStG19_1`]],
    [a.skontiGewaehrt, [`${SALES}.reductionsFromGrossSales.unknownVAT`]],
    [a.skontiErhalten, [`${MAT}.misc`]],
    [a.mahnerloes, ["is.netIncome.regular.fin.netInterest.income.other"]],
    [a.forderungsverluste, [`${OC}.regAllowance`]],
    [a.kursAufwand, [`${OC}.currLoss`]],
    [a.kursErtrag, [`${IS}.otherOpRevenue.currGains`]],
    ...(Object.entries(KATEGORIEN) as [keyof typeof KATEGORIEN, string][]).map(([key, position]): [string, EbilanzZiel] => [
      EXPENSE_CATEGORIES[key][kontenrahmen],
      [position],
    ]),
    [anlagen.anlage.kfz, [`${EQUIPM}.passengerCars`]],
    [anlagen.anlage.edv, [`${EQUIPM}.office`]],
    [anlagen.anlage.buero, [`${EQUIPM}.office`]],
    [anlagen.anlage.sonstiges, [`${EQUIPM}.otherbga`]],
    [anlagen.anlage.transport, [`${EQUIPM}.otherTransportMeans`]],
    [anlagen.gwg, [`${EQUIPM}.gwg`]],
    [anlagen.sammelposten, [`${EQUIPM}.gwgsammelposten`]],
    [anlagen.afa, [`${DEPR}.other`]],
    [anlagen.afaKfz, [`${DEPR}.other`]],
    [anlagen.afaGwg, [`${DEPR}.lowValueAs`]],
    [anlagen.afaSammelposten, [`${DEPR}.lowValueAsCollItem`]],
    [anlagen.restbuchwert, [`${OC}.disposFixAss.bookValue.tan.other`]],
    ...Object.entries(ERTRAGSTEUERN[kontenrahmen]),
    ...Object.entries(KAPITAL[kontenrahmen]),
    ...lohnKonten(kontenrahmen),
    ...steuerzahlungKonten(kontenrahmen),
    ...darlehenKonten(kontenrahmen),
  ];
  return Object.fromEntries(entries);
}

export const EBILANZ_KONTEN: Record<Kontenrahmen, Readonly<Record<string, EbilanzZiel>>> = {
  SKR03: kontenOf("SKR03"),
  SKR04: kontenOf("SKR04"),
};

/** Auffangposition je Kleinst-Posten; null: ohne feste Zuordnung nicht übermittelbar */
export const EBILANZ_AUFFANG: Record<Posten, string | null> = {
  // Anlagen brauchen den Anlagenspiegel, Eigenkapital und Steuern die genaue Art
  "aktiva.A": null,
  "aktiva.B": "bs.ass.currAss.receiv.other.misc",
  "aktiva.C": "bs.ass.prepaidExp.other",
  "aktiva.D": null,
  "aktiva.E": null,
  "passiva.A": null,
  "passiva.B": "bs.eqLiab.accruals.other.misc",
  "passiva.C": "bs.eqLiab.liab.other.other",
  "passiva.D": "bs.eqLiab.defIncome",
  "passiva.E": null,
  umsatzerloese: `${GS}.unknownVAT`,
  sonstigeErtraege: `${IS}.otherOpRevenue.nonAllocable`,
  materialaufwand: `${MAT}.misc`,
  personalaufwand: `${IS}.staff.misc`,
  abschreibungen: `${IS}.deprAmort.misc`,
  sonstigeAufwendungen: `${OC}.misc`,
  steuern: null,
};

/** Position der E-Bilanz für ein Konto mit diesem Saldo (Soll − Haben); null: keine */
export function ebilanzPosition(kontenrahmen: Kontenrahmen, account: string, saldo: Cents): string | null {
  const ziel = EBILANZ_KONTEN[kontenrahmen][account];
  if (ziel) return saldo < 0 && ziel[1] ? ziel[1] : ziel[0];
  const posten = postenForSaldo(kontenrahmen, account, saldo);
  return posten ? EBILANZ_AUFFANG[posten] : null;
}

export interface EbilanzZuordnung {
  account: string;
  saldo: Cents;
  position: string;
}

/**
 * Salden zu Positionen. Konten ohne Position (und Klasse 9 mit Saldo) kommen in fehlend; dann ist die E-Bilanz nicht
 * übermittelbar, bis sie gebucht oder umgebucht sind.
 */
export function ebilanzZuordnung(
  kontenrahmen: Kontenrahmen,
  salden: readonly { account: string; saldo: Cents }[],
): { zuordnung: EbilanzZuordnung[]; fehlend: { account: string; saldo: Cents }[] } {
  const zuordnung: EbilanzZuordnung[] = [];
  const fehlend: { account: string; saldo: Cents }[] = [];
  for (const { account, saldo } of salden) {
    if (saldo === 0) continue;
    const position = account.startsWith("9") ? null : ebilanzPosition(kontenrahmen, account, saldo);
    if (position) zuordnung.push({ account, saldo, position });
    else fehlend.push({ account, saldo });
  }
  return { zuordnung, fehlend };
}

/** Eine Zeile des Anlagenspiegels: Anschaffungskosten und AfA je Bilanzposition, brutto, Beträge positiv */
export interface AnlagenspiegelZeile {
  /** Bilanzposition unter bs.ass.fixAss, z. B. bs.ass.fixAss.tan.otherEquipm.passengerCars */
  position: string;
  akAnfang: Cents;
  zugaenge: Cents;
  /** Anschaffungskosten der Abgänge */
  abgaenge: Cents;
  afaAnfang: Cents;
  afaJahr: Cents;
  /** Kumulierte AfA der Abgänge */
  afaAbgaenge: Cents;
}

/**
 * Anlagenspiegel einer Anlage im Jahr aus ihrem Abschreibungsplan (afa.ts), brutto mit den Anschaffungskosten. Eine
 * übernommene Anlage bringt ihre Anschaffungskosten mit; die AfA vor der Übernahme ist der Unterschied zum Buchwert.
 * GWG und Sammelposten scheiden aus, sobald sie abgeschrieben sind, im Jahr der letzten AfA (übliche Darstellung, der
 * Buchwert ist dann 0); andere Anlagen bleiben bis zum Abgang. null: im Jahr nicht im Bestand.
 */
export function anlagenspiegelZeile(
  kontenrahmen: Kontenrahmen,
  asset: ScheduleAsset & { account: string },
  schedule: readonly ScheduleYear[],
  year: number,
): AnlagenspiegelZeile | null {
  const position = EBILANZ_KONTEN[kontenrahmen][asset.account]?.[0];
  if (!position) throw new Error(`Anlagekonto ${asset.account} hat keine Position in der E-Bilanz`);
  const start = Number((asset.opening?.date ?? asset.acquisitionDate).slice(0, 4));
  const row = schedule.find((r) => r.year === year);
  const last = schedule.at(-1);
  const written = asset.method === "gwg" || asset.method === "sammelposten";
  // Abgang im Jahr: verkauft oder entnommen, bei GWG und Sammelposten auch das Jahr der letzten AfA
  const leaves = (asset.disposalDate && asset.method !== "sammelposten" ? Number(asset.disposalDate.slice(0, 4)) : null) ?? (written ? last?.year : null);
  if (year < start || (leaves != null && year > leaves)) return null;
  const cost = asset.cost;
  const akAnfang = start < year || asset.opening ? cost : 0;
  const bookValueStart = row ? row.opening : 0;
  const afaJahr = row?.depreciation ?? 0;
  const gone = leaves === year;
  return {
    position,
    akAnfang,
    zugaenge: akAnfang === 0 ? cost : 0,
    abgaenge: gone ? cost : 0,
    afaAnfang: akAnfang - bookValueStart,
    afaJahr,
    // Beim Abgang ist alles bis auf den Restbuchwert abgeschrieben; der Restbuchwert geht als Aufwand ab
    afaAbgaenge: gone ? cost - (row?.disposal ?? 0) : 0,
  };
}
