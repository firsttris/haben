import type { InvoiceTotals } from "./invoice.ts";
import { roundHalfAwayFromZero, splitPrivateShare, toCsv, type Cents } from "./money.ts";
import { EXPENSE_CATEGORIES, paidTaxShares, type ExpenseCategory } from "./posting.ts";
import { PAUSCHALE_LABEL, type PauschaleArt } from "./pauschalen.ts";
import type { TaxTreatment } from "./treatment.ts";

/**
 * Einnahmen-Überschuss-Rechnung (§ 4 Abs. 3 EStG) nach Zufluss und Abfluss, Bruttomethode
 * wie in der Anlage EÜR: vereinnahmte Umsatzsteuer ist Einnahme, gezahlte Vorsteuer Ausgabe.
 *
 * Die Eingaben sind normalisierte Zahlungen. Zahlungen mit demselben `group` (z. B. Zuordnung
 * und ihre Gegenzeile auf demselben Bankumsatz) werden vor dem Aufteilen addiert, damit sich
 * aufgehobene Zuordnungen exakt aufheben.
 */
export type EuerPayment =
  | {
      kind: "invoice";
      /** ISO-Datum des Zuflusses */
      date: string;
      /** Gezahlter Teil der Rechnung, Vorzeichen wie die Rechnung (Eingang positiv) */
      paid: Cents;
      totals: InvoiceTotals;
      treatment?: TaxTreatment;
      group?: string;
    }
  | {
      kind: "document";
      /** ISO-Datum des Abflusses (Bankumsatz bzw. Belegdatum bei privat bezahlten Belegen) */
      date: string;
      /** Bezahlter Teil des Belegs, Vorzeichen wie der Beleg (Ausgabe positiv, Gutschrift negativ) */
      paid: Cents;
      totals: InvoiceTotals;
      category: ExpenseCategory;
      /** false bei Kleinunternehmern: die Steuer auf dem Beleg ist Teil der Ausgabe */
      vorsteuerAbzug?: boolean;
      /** Privatanteil in Prozent: nur der betriebliche Teil ist Ausgabe bzw. Vorsteuer */
      privateShare?: number;
      group?: string;
    }
  | {
      /** Pauschale ohne Beleg (Homeoffice, Fahrten, Verpflegung), privat bezahlt; Storno negativ */
      kind: "pauschale";
      date: string;
      amount: Cents;
      art: PauschaleArt;
      group?: string;
    }
  | {
      /** Umsatzsteuer an das Finanzamt bzw. Erstattung; Vorzeichen wie auf dem Konto */
      kind: "ustVorauszahlung" | "gebuehren" | "mahnerloes";
      date: string;
      amount: Cents;
      group?: string;
    };

export type EuerLineKey =
  | "einnahmenKleinunternehmer"
  | "einnahmenSteuerpflichtig"
  | "einnahmenSteuerfrei"
  | "privateKfz"
  | "ustEntnahmen"
  | "vereinnahmteUst"
  | "erstatteteUst"
  | `ausgabe:${ExpenseCategory}`
  | `pauschale:${PauschaleArt}`
  | "afa"
  | "gwg"
  | "sammelposten"
  | "restbuchwert"
  | "vorsteuer"
  | "gezahlteUst";

export interface EuerLine {
  key: EuerLineKey;
  label: string;
  amount: Cents;
  note?: string;
}

export interface EuerResult {
  year: number;
  einnahmen: EuerLine[];
  ausgaben: EuerLine[];
  totalEinnahmen: Cents;
  totalAusgaben: Cents;
  gewinn: Cents;
  /** Nicht abziehbarer Teil der Bewirtung (30 %): mindert den Gewinn nicht, steht aber in der Anlage EÜR */
  bewirtungNichtAbziehbar: Cents;
  /** Netto je Monat (ohne Umsatzsteuer, Vorsteuer und Zahlungen an/vom Finanzamt), Index 0 = Januar */
  monthly: { einnahmen: Cents[]; ausgaben: Cents[] };
}

export const EUER_LABELS = {
  einnahmenKleinunternehmer: "Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer",
  einnahmenSteuerpflichtig: "Umsatzsteuerpflichtige Betriebseinnahmen (netto)",
  einnahmenSteuerfrei: "Umsatzsteuerfreie und nicht steuerbare Betriebseinnahmen",
  privateKfz: "Private Kfz-Nutzung",
  vereinnahmteUst: "Vereinnahmte Umsatzsteuer",
  ustEntnahmen: "Umsatzsteuer auf unentgeltliche Wertabgaben",
  erstatteteUst: "Vom Finanzamt erstattete Umsatzsteuer",
  afa: "AfA auf bewegliche Wirtschaftsgüter",
  gwg: "Sofortabschreibung geringwertiger Wirtschaftsgüter",
  sammelposten: "Auflösung Sammelposten",
  restbuchwert: "Restbuchwert ausgeschiedener Anlagegüter",
  vorsteuer: "Gezahlte Vorsteuerbeträge",
  gezahlteUst: "An das Finanzamt gezahlte Umsatzsteuer",
} as const;

const yearOf = (date: string) => Number(date.slice(0, 4));
const monthIndex = (date: string) => Number(date.slice(5, 7)) - 1;

type Netted = EuerPayment & { sum: Cents };

/** Addiert Zahlungen derselben Gruppe; ohne Gruppe bleibt jede Zahlung für sich. */
function netGroups(payments: EuerPayment[]): Netted[] {
  const groups = new Map<string, Netted>();
  const result: Netted[] = [];
  payments.forEach((p, i) => {
    const amount = p.kind === "invoice" || p.kind === "document" ? p.paid : p.amount;
    const key = p.group === undefined ? `#${i}` : `${p.kind}|${p.group}|${p.date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sum += amount;
    } else {
      const entry = { ...p, sum: amount };
      groups.set(key, entry);
      result.push(entry);
    }
  });
  return result.filter((p) => p.sum !== 0);
}

/** Abschreibungen eines Jahres aus dem Anlagenverzeichnis */
export interface EuerDepreciation {
  afa: Cents;
  gwg: Cents;
  sammelposten: Cents;
  restbuchwert: Cents;
}

/** Private Nutzung von Firmenwagen im Jahr: Entnahme und Umsatzsteuer darauf */
export interface EuerWithdrawals {
  privateKfz: Cents;
  ustEntnahmen: Cents;
}

export function computeEuer(
  year: number,
  payments: EuerPayment[],
  depreciation?: EuerDepreciation,
  withdrawals?: EuerWithdrawals,
): EuerResult {
  const sums = new Map<EuerLineKey, Cents>();
  const add = (key: EuerLineKey, amount: Cents) => sums.set(key, (sums.get(key) ?? 0) + amount);
  const monthlyIn: Cents[] = Array.from({ length: 12 }, () => 0);
  const monthlyOut: Cents[] = Array.from({ length: 12 }, () => 0);
  let bewirtungNichtAbziehbar = 0;

  for (const p of netGroups(payments.filter((p) => yearOf(p.date) === year))) {
    const month = monthIndex(p.date);
    switch (p.kind) {
      case "invoice":
        for (const { rate, base, tax } of paidTaxShares(p.totals, p.sum)) {
          add(
            p.treatment === "kleinunternehmer" ? "einnahmenKleinunternehmer" : rate === 0 ? "einnahmenSteuerfrei" : "einnahmenSteuerpflichtig",
            base,
          );
          add("vereinnahmteUst", tax);
          monthlyIn[month]! += base;
        }
        break;
      case "document":
        for (const share of paidTaxShares(p.totals, p.sum)) {
          const base = splitPrivateShare(share.base, p.privateShare ?? 0).business;
          const tax = splitPrivateShare(share.tax, p.privateShare ?? 0).business;
          // Anschaffung einer Anlage ist keine Ausgabe; sie wirkt über die AfA. Die Vorsteuer schon.
          if (p.category === "anlage") {
            if (p.vorsteuerAbzug !== false) add("vorsteuer", tax);
            continue;
          }
          // Ohne Vorsteuerabzug (Kleinunternehmer) ist die Steuer Teil der Ausgabe
          const ausgabe = p.vorsteuerAbzug === false ? base + tax : base;
          if (p.vorsteuerAbzug !== false) add("vorsteuer", tax);
          // Bewirtung: 30 % sind nicht abziehbar (§ 4 Abs. 5 Nr. 2 EStG), die Vorsteuer bleibt voll abziehbar
          const nichtAbziehbar = p.category === "bewirtung" ? ausgabe - roundHalfAwayFromZero(ausgabe * 0.7) : 0;
          bewirtungNichtAbziehbar += nichtAbziehbar;
          add(`ausgabe:${p.category}`, ausgabe - nichtAbziehbar);
          monthlyOut[month]! += ausgabe - nichtAbziehbar;
        }
        break;
      case "ustVorauszahlung":
        // Ausgang: Zahlung an das Finanzamt; Eingang: Erstattung
        if (p.sum < 0) add("gezahlteUst", -p.sum);
        else add("erstatteteUst", p.sum);
        break;
      case "mahnerloes":
        // Verzugszinsen und Mahngebühren: Betriebseinnahme ohne Umsatzsteuer
        add("einnahmenSteuerfrei", p.sum);
        monthlyIn[month]! += p.sum;
        break;
      case "gebuehren":
        add("ausgabe:geldverkehr", -p.sum);
        monthlyOut[month]! -= p.sum;
        break;
      case "pauschale":
        add(`pauschale:${p.art}`, p.sum);
        monthlyOut[month]! += p.sum;
        break;
    }
  }

  const line = (key: EuerLineKey, label: string, note?: string): EuerLine => ({
    key,
    label,
    amount: sums.get(key) ?? 0,
    ...(note ? { note } : {}),
  });
  if (withdrawals) {
    add("privateKfz", withdrawals.privateKfz);
    add("ustEntnahmen", withdrawals.ustEntnahmen);
  }
  const optional = (key: "privateKfz" | "ustEntnahmen") => ((sums.get(key) ?? 0) !== 0 ? [line(key, EUER_LABELS[key])] : []);
  const einnahmen = [
    ...(sums.has("einnahmenKleinunternehmer") ? [line("einnahmenKleinunternehmer", EUER_LABELS.einnahmenKleinunternehmer)] : []),
    line("einnahmenSteuerpflichtig", EUER_LABELS.einnahmenSteuerpflichtig),
    line("einnahmenSteuerfrei", EUER_LABELS.einnahmenSteuerfrei),
    ...optional("privateKfz"),
    line("vereinnahmteUst", EUER_LABELS.vereinnahmteUst),
    ...optional("ustEntnahmen"),
    line("erstatteteUst", EUER_LABELS.erstatteteUst),
  ];
  const categories = (Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[])
    .filter((c) => (sums.get(`ausgabe:${c}`) ?? 0) !== 0)
    .map((c) =>
      line(
        `ausgabe:${c}`,
        EXPENSE_CATEGORIES[c].label,
        c === "hardware"
          ? "Als geringwertige Wirtschaftsgüter sofort abgezogen"
          : c === "bewirtung"
            ? "Abziehbarer Teil (70 %)"
            : undefined,
      ),
    );
  if (depreciation) for (const key of ["afa", "gwg", "sammelposten", "restbuchwert"] as const) add(key, depreciation[key]);
  const depreciationLines = (["afa", "gwg", "sammelposten", "restbuchwert"] as const)
    .filter((key) => (sums.get(key) ?? 0) !== 0)
    .map((key) => line(key, EUER_LABELS[key]));
  const pauschalen = (Object.keys(PAUSCHALE_LABEL) as PauschaleArt[])
    .filter((art) => (sums.get(`pauschale:${art}`) ?? 0) !== 0)
    .map((art) => line(`pauschale:${art}`, PAUSCHALE_LABEL[art], "Pauschale ohne Beleg, privat bezahlt"));
  const ausgaben = [
    ...categories,
    ...pauschalen,
    ...depreciationLines,
    line("vorsteuer", EUER_LABELS.vorsteuer),
    line("gezahlteUst", EUER_LABELS.gezahlteUst),
  ];
  const totalEinnahmen = einnahmen.reduce((s, l) => s + l.amount, 0);
  const totalAusgaben = ausgaben.reduce((s, l) => s + l.amount, 0);
  return {
    year,
    einnahmen,
    ausgaben,
    totalEinnahmen,
    totalAusgaben,
    gewinn: totalEinnahmen - totalAusgaben,
    bewirtungNichtAbziehbar,
    monthly: { einnahmen: monthlyIn, ausgaben: monthlyOut },
  };
}

/** EÜR als CSV für Excel/LibreOffice: Semikolon, Dezimalkomma ohne Tausenderpunkt (wie die Exporte), UTF-8 mit BOM */
export function euerToCsv(euer: EuerResult): string {
  const rows: (string | Cents)[][] = [["Bereich", "Position", "Betrag (EUR)"]];
  for (const l of euer.einnahmen) rows.push(["Betriebseinnahmen", l.label, l.amount]);
  rows.push(["Betriebseinnahmen", "Summe Betriebseinnahmen", euer.totalEinnahmen]);
  for (const l of euer.ausgaben) rows.push(["Betriebsausgaben", l.label, l.amount]);
  rows.push(["Betriebsausgaben", "Summe Betriebsausgaben", euer.totalAusgaben]);
  rows.push(["Ergebnis", euer.gewinn >= 0 ? "Gewinn" : "Verlust", euer.gewinn]);
  if (euer.bewirtungNichtAbziehbar !== 0) rows.push(["Nachrichtlich", "Nicht abziehbare Bewirtungsaufwendungen (30 %)", euer.bewirtungNichtAbziehbar]);
  return toCsv(rows);
}
