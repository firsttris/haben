import { ASSET_ACCOUNTS, type ScheduleAsset, type ScheduleYear } from "./afa.ts";
import { postenForSaldo, type Posten } from "./hgb.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";

/*
 * Zuordnung der Konten zu den Positionen der E-Bilanz (§ 5b EStG, HGB-Taxonomie 6.9, Kerntaxonomie de-gaap-ci). Die
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
const KATEGORIEN: Record<Exclude<ExpenseCategory, "hardware" | "anlage">, string> = {
  // DATEV „Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen)“; der Empfänger kann im Ausland sitzen
  software: `${OC}.concessLicenses.nonallocable`,
  // DATEV 4806/6495 „Wartungskosten für Hard- und Software“
  edv: `${OC}.fixing`,
  telefon: `${OC}.communication`,
  internet: `${OC}.communication`,
  porto: `${OC}.communication`,
  buero: `${OC}.administration`,
  literatur: `${OC}.administration`,
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
  fremdleistung: `${MAT}.services.unknownVAT`,
  geldverkehr: `${OC}.miscellaneous`,
  kfzBetrieb: `${OC}.vehicles`,
  kfzVersicherung: `${OC}.vehicles`,
  kfzReparatur: `${OC}.vehicles`,
  kfzLeasing: `${OC}.vehicles`,
  kfzSteuer: "is.netIncome.otherTaxes.other",
  versicherung: `${OC}.insurance`,
  beitraege: `${OC}.insurance`,
  sonstiges: `${OC}.miscellaneous`,
};

/** Steuern vom Einkommen und Ertrag (DATEV-Kontenrahmen 2026): Körperschaftsteuer, Solidaritätszuschlag, Gewerbesteuer */
const ERTRAGSTEUERN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: { "2200": "is.netIncome.tax.kst", "2208": "is.netIncome.tax.soli.other", "4320": "is.netIncome.tax.gewst" },
  SKR04: { "7600": "is.netIncome.tax.kst", "7608": "is.netIncome.tax.soli.other", "7610": "is.netIncome.tax.gewst" },
};

/** Weitere Konten der Kapitalgesellschaft (DATEV-Kontenrahmen 2026, SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175) */
const KAPITAL: Record<Kontenrahmen, Record<string, EbilanzZiel>> = {
  SKR03: {
    // Mit Restlaufzeit: im DATEV-Kontenrahmen nur unter den Verbindlichkeiten
    "0731": [GESELLSCHAFTER[1]!],
    "0740": [GESELLSCHAFTER[1]!],
    "0750": [GESELLSCHAFTER[1]!],
    "0800": ["bs.eqLiab.equity.subscribed.corp"],
    "0860": ["bs.eqLiab.equity.retainedEarnings"],
    "0868": ["bs.eqLiab.equity.retainedEarnings"],
  },
  SKR04: {
    "3511": GESELLSCHAFTER,
    "3514": [GESELLSCHAFTER[1]!],
    "2900": ["bs.eqLiab.equity.subscribed.corp"],
    "2970": ["bs.eqLiab.equity.retainedEarnings"],
    "2978": ["bs.eqLiab.equity.retainedEarnings"],
  },
};

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
    ...[...Object.values(a.vorsteuer), a.vorsteuerRc, ...Object.values(a.ust), a.ustRc, a.ustVorauszahlung].map((k): [string, EbilanzZiel] => [
      k,
      UMSATZSTEUER,
    ]),
    // Umsatzsteuer nicht fällig (Ist-Versteuerung): im DATEV-Kontenrahmen unter den Rückstellungen
    ...Object.values(a.ustNichtFaellig).map((k): [string, EbilanzZiel] => [k, [VAT_RECEIVABLE, "bs.eqLiab.accruals.tax.other"]]),
    [a.gesellschafter, GESELLSCHAFTER],
    [a.erloese[1900], [`${GS}.generalRateVAT`]],
    [a.erloese[700], [`${GS}.reducedRateVAT`]],
    [a.erloese[0], [`${GS}.unknownVAT`]],
    // Leistungsort im Ausland: in Deutschland nicht steuerbar
    [a.erloeseSonder.reverse_charge, [`${GS}.untaxable`]],
    [a.erloeseSonder.drittland, [`${GS}.untaxable`]],
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
    [anlagen.gwg, [`${EQUIPM}.gwg`]],
    [anlagen.sammelposten, [`${EQUIPM}.gwgsammelposten`]],
    [anlagen.afa, [`${DEPR}.other`]],
    [anlagen.afaKfz, [`${DEPR}.other`]],
    [anlagen.afaGwg, [`${DEPR}.lowValueAs`]],
    [anlagen.afaSammelposten, [`${DEPR}.lowValueAsCollItem`]],
    [anlagen.restbuchwert, [`${OC}.disposFixAss.bookValue.tan.other`]],
    ...Object.entries(ERTRAGSTEUERN[kontenrahmen]).map(([k, position]): [string, EbilanzZiel] => [k, [position]]),
    ...Object.entries(KAPITAL[kontenrahmen]),
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
