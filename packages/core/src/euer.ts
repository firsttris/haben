import type { InvoiceTotals } from "./invoice.ts";
import { roundHalfAwayFromZero, splitPrivateShare, toCsv, type Cents } from "./money.ts";
import { EXPENSE_CATEGORIES, paidTaxShares, type ExpenseCategory, type TaxShare } from "./posting.ts";
import type { AllocatedSplitLine } from "./document-split.ts";
import { PAUSCHALE_LABEL, type PauschaleArt } from "./pauschalen.ts";
import { steuerEuerWirkung, type Steuerart, type SteuerPosten } from "./steuerzahlung.ts";
import { darlehenEuerZeile, type DarlehenTeil, type DarlehenZweck } from "./darlehen.ts";
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
      /** Gespeicherter Steueranteil der Zahlung (wie gebucht); ohne wird er aus `paid` gerechnet */
      shares?: TaxShare[];
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
      /** Aufgeteilter Beleg (#271): Netto und Vorsteuer je Kontierungszeile; category gilt dann nicht */
      splits?: AllocatedSplitLine[];
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
      /**
       * Umsatzsteuer an das Finanzamt bzw. Erstattung, Gebühren, Mahnerlöse, betriebliche Zinserträge, Kursdifferenz bei
       * Fremdwährung (Gewinn positiv); Vorzeichen wie auf dem Konto
       */
      kind: "ustVorauszahlung" | "sondervorauszahlung" | "gebuehren" | "mahnerloes" | "zinsertrag" | "kursdifferenz";
      date: string;
      amount: Cents;
      group?: string;
    }
  | {
      /**
       * Zahlung aus der Lohnabrechnung (Auszahlung an Beschäftigte, Lohnsteuer an das Finanzamt, Beiträge an die
       * Einzugsstelle): Ausgabe für Personal, wenn sie abfließt. Vorzeichen wie auf dem Konto, Ausgang negativ
       */
      kind: "lohn";
      date: string;
      amount: Cents;
      group?: string;
    }
  | {
      /** Steuerzahlung bzw. Erstattung mit Steuerart und Teil (steuerzahlung.ts); Vorzeichen wie auf dem Konto */
      kind: "steuer";
      date: string;
      amount: Cents;
      art: Steuerart;
      posten: SteuerPosten;
      group?: string;
    }
  | {
      /** Teil eines Bankumsatzes zu einem Darlehen (darlehen.ts); Vorzeichen wie auf dem Konto */
      kind: "darlehen";
      date: string;
      amount: Cents;
      zweck: DarlehenZweck;
      teil: DarlehenTeil;
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
  | "kursgewinne"
  | "kursverluste"
  | `ausgabe:${ExpenseCategory}`
  | `pauschale:${PauschaleArt}`
  | "personal"
  | "steuerNebenleistungen"
  | "schuldzinsenAnlage"
  | "schuldzinsen"
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
  /**
   * Gezahlte Gewerbesteuer und Nebenleistungen darauf abzüglich Erstattungen: keine Betriebsausgabe (§ 4 Abs. 5b EStG), dazu
   * Hinterziehungszinsen (§ 4 Abs. 5 Satz 1 Nr. 8a EStG);
   * in der Anlage EÜR nachrichtlich unter den sonstigen beschränkt abziehbaren Betriebsausgaben, Spalte „nicht abziehbar“
   */
  gewerbesteuerNichtAbziehbar: Cents;
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
  kursgewinne: "Erträge aus Kursdifferenzen",
  kursverluste: "Aufwendungen aus Kursdifferenzen",
  afa: "AfA auf bewegliche Wirtschaftsgüter",
  gwg: "Sofortabschreibung geringwertiger Wirtschaftsgüter",
  sammelposten: "Auflösung Sammelposten",
  restbuchwert: "Restbuchwert ausgeschiedener Anlagegüter",
  personal: "Löhne und Gehälter einschließlich Lohnsteuer und Sozialversicherung",
  steuerNebenleistungen: "Zinsen und Zuschläge zu betrieblichen Steuern (abziehbare Nebenleistungen)",
  schuldzinsenAnlage: "Schuldzinsen zur Finanzierung von Anlagevermögen",
  schuldzinsen: "Übrige Schuldzinsen",
  vorsteuer: "Gezahlte Vorsteuerbeträge",
  gezahlteUst: "An das Finanzamt gezahlte Umsatzsteuer",
} as const;

const yearOf = (date: string) => Number(date.slice(0, 4));
const monthIndex = (date: string) => Number(date.slice(5, 7)) - 1;

type Netted = EuerPayment & { sum: Cents };

/** Gruppe zum Verrechnen: Zahlung und Gegenzeile derselben Art, bei Steuerzahlungen auch derselben Steuerart und desselben Teils */
const groupKey = (p: EuerPayment) => (p.kind === "steuer" ? `steuer|${p.art}|${p.posten}` : p.kind === "darlehen" ? `darlehen|${p.zweck}|${p.teil}` : p.kind);

/** Addiert Zahlungen derselben Gruppe; ohne Gruppe bleibt jede Zahlung für sich. */
function netGroups(payments: EuerPayment[]): Netted[] {
  const groups = new Map<string, Netted>();
  const result: Netted[] = [];
  payments.forEach((p, i) => {
    const amount = p.kind === "invoice" || p.kind === "document" ? p.paid : p.amount;
    const key = p.group === undefined ? `#${i}` : `${groupKey(p)}|${p.group}|${p.date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sum += amount;
      // Gespeicherte Anteile nur, wenn alle Zahlungen der Gruppe welche haben; sonst aus der Summe gerechnet
      if (existing.kind === "invoice" && p.kind === "invoice") existing.shares = existing.shares && p.shares ? [...existing.shares, ...p.shares] : undefined;
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

type DocumentPayment = Extract<EuerPayment, { kind: "document" }>;

/**
 * Netto und Steuer einer (Teil-)Zahlung auf einen Beleg, je Kategorie. Ohne Aufteilung je Steuersatz wie bisher; mit
 * Aufteilung (#271) je Kontierungszeile, gerechnet wie eine Teilzahlung über Zeilen statt Sätze: Die Steuer der Zahlung
 * ist dieselbe wie ohne Aufteilung, eine vollständige Zahlung ergibt genau die Beträge der Zeilen.
 */
function documentShares(p: DocumentPayment, paid: Cents): { category: ExpenseCategory; share: TaxShare }[] {
  if (!p.splits || p.splits.length === 0) return paidTaxShares(p.totals, paid).map((share) => ({ category: p.category, share }));
  const lines = p.splits;
  const shares = paidTaxShares({ ...p.totals, taxes: lines.map((l) => ({ rate: l.taxRate, base: l.net, tax: l.tax })) }, paid);
  return shares.map((share, i) => ({ category: lines[i]!.category, share }));
}

export function computeEuer(year: number, payments: EuerPayment[], depreciation?: EuerDepreciation, withdrawals?: EuerWithdrawals): EuerResult {
  const sums = new Map<EuerLineKey, Cents>();
  const add = (key: EuerLineKey, amount: Cents) => sums.set(key, (sums.get(key) ?? 0) + amount);
  const monthlyIn: Cents[] = Array.from({ length: 12 }, () => 0);
  const monthlyOut: Cents[] = Array.from({ length: 12 }, () => 0);
  let bewirtungNichtAbziehbar = 0;
  let gewerbesteuerNichtAbziehbar = 0;

  for (const p of netGroups(payments.filter((p) => yearOf(p.date) === year))) {
    const month = monthIndex(p.date);
    switch (p.kind) {
      case "invoice":
        for (const { rate, base, tax } of p.shares ?? paidTaxShares(p.totals, p.sum)) {
          add(p.treatment === "kleinunternehmer" ? "einnahmenKleinunternehmer" : rate === 0 ? "einnahmenSteuerfrei" : "einnahmenSteuerpflichtig", base);
          add("vereinnahmteUst", tax);
          monthlyIn[month]! += base;
        }
        break;
      case "document":
        for (const { category, share } of documentShares(p, p.sum)) {
          const base = splitPrivateShare(share.base, p.privateShare ?? 0).business;
          const tax = splitPrivateShare(share.tax, p.privateShare ?? 0).business;
          // Einfuhrumsatzsteuer: der ganze Betrag ist gezahlte Vorsteuer, wenn er abfließt (Kz 62); ohne Steuer im Betrag
          if (category === "einfuhrumsatzsteuer") {
            add("vorsteuer", share.base + share.tax);
            continue;
          }
          // Anschaffung einer Anlage ist keine Ausgabe; sie wirkt über die AfA. Die Vorsteuer schon.
          if (category === "anlage") {
            if (p.vorsteuerAbzug !== false) add("vorsteuer", tax);
            continue;
          }
          // Ohne Vorsteuerabzug (Kleinunternehmer) ist die Steuer Teil der Ausgabe
          const ausgabe = p.vorsteuerAbzug === false ? base + tax : base;
          if (p.vorsteuerAbzug !== false) add("vorsteuer", tax);
          // Bewirtung: 30 % sind nicht abziehbar (§ 4 Abs. 5 Nr. 2 EStG), die Vorsteuer bleibt voll abziehbar
          const nichtAbziehbar = category === "bewirtung" ? ausgabe - roundHalfAwayFromZero((ausgabe * 7) / 10) : 0;
          bewirtungNichtAbziehbar += nichtAbziehbar;
          add(`ausgabe:${category}`, ausgabe - nichtAbziehbar);
          monthlyOut[month]! += ausgabe - nichtAbziehbar;
        }
        break;
      case "ustVorauszahlung":
      // Die Sondervorauszahlung ist Umsatzsteuer an das Finanzamt wie jede Vorauszahlung, abziehbar, wenn sie gezahlt ist
      case "sondervorauszahlung":
        // Ausgang: Zahlung an das Finanzamt; Eingang: Erstattung
        if (p.sum < 0) add("gezahlteUst", -p.sum);
        else add("erstatteteUst", p.sum);
        break;
      case "mahnerloes":
      // Zinsen sind umsatzsteuerfrei (§ 4 Nr. 8 Buchst. a UStG), Verzugszinsen und Mahngebühren nicht steuerbar
      case "zinsertrag":
        // Verzugszinsen, Mahngebühren und Zinsen auf betriebliche Guthaben: Betriebseinnahme ohne Umsatzsteuer
        add("einnahmenSteuerfrei", p.sum);
        monthlyIn[month]! += p.sum;
        break;
      case "steuer":
        switch (steuerEuerWirkung(p.art, p.posten, p.sum)) {
          case "umsatzsteuer":
            // Umsatzsteuer früherer Jahre: im Jahr der Zahlung gezahlte bzw. erstattete Umsatzsteuer (§ 11 EStG)
            if (p.sum < 0) add("gezahlteUst", -p.sum);
            else add("erstatteteUst", p.sum);
            break;
          case "einnahme":
            add("einnahmenSteuerfrei", p.sum);
            monthlyIn[month]! += p.sum;
            break;
          case "nebenleistung":
            add("steuerNebenleistungen", -p.sum);
            monthlyOut[month]! -= p.sum;
            break;
          case "nichtAbziehbar":
            gewerbesteuerNichtAbziehbar -= p.sum;
            break;
          // Private Steuern sind Entnahmen bzw. Einlagen; die zählt die Anlage EÜR aus den Privatkonten
          case "privat":
            break;
        }
        break;
      case "kursdifferenz":
        // Fremdwährung: Unterschied zwischen umgerechnetem Rechnungsbetrag und Zahlung, ohne Umsatzsteuer
        if (p.sum > 0) {
          add("kursgewinne", p.sum);
          monthlyIn[month]! += p.sum;
        } else {
          add("kursverluste", -p.sum);
          monthlyOut[month]! -= p.sum;
        }
        break;
      case "darlehen": {
        // Auszahlung und Tilgung sind erfolgsneutral; Zinsen und Gebühren Schuldzinsen, wenn sie abfließen (§ 11 Abs. 2 EStG)
        const zeile = darlehenEuerZeile(p.zweck, p.teil);
        if (zeile) {
          add(zeile, -p.sum);
          monthlyOut[month]! -= p.sum;
        }
        break;
      }
      case "lohn":
        // Ausgaben für eigenes Personal (Anlage EÜR, Personal): Lohn, einbehaltene Lohnsteuer und alle Beiträge
        add("personal", -p.sum);
        monthlyOut[month]! -= p.sum;
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
  const optional = (
    key: "privateKfz" | "ustEntnahmen" | "kursgewinne" | "kursverluste" | "personal" | "steuerNebenleistungen" | "schuldzinsenAnlage" | "schuldzinsen",
  ) => ((sums.get(key) ?? 0) !== 0 ? [line(key, EUER_LABELS[key])] : []);
  const einnahmen = [
    ...(sums.has("einnahmenKleinunternehmer") ? [line("einnahmenKleinunternehmer", EUER_LABELS.einnahmenKleinunternehmer)] : []),
    line("einnahmenSteuerpflichtig", EUER_LABELS.einnahmenSteuerpflichtig),
    line("einnahmenSteuerfrei", EUER_LABELS.einnahmenSteuerfrei),
    ...optional("privateKfz"),
    ...optional("kursgewinne"),
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
        c === "hardware" ? "Als geringwertige Wirtschaftsgüter sofort abgezogen" : c === "bewirtung" ? "Abziehbarer Teil (70 %)" : undefined,
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
    ...optional("personal"),
    ...categories,
    ...pauschalen,
    ...depreciationLines,
    ...optional("kursverluste"),
    ...optional("steuerNebenleistungen"),
    ...optional("schuldzinsenAnlage"),
    ...optional("schuldzinsen"),
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
    gewerbesteuerNichtAbziehbar,
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
  if (euer.gewerbesteuerNichtAbziehbar !== 0) {
    rows.push([
      "Nachrichtlich",
      "Gewerbesteuer und Nebenleistungen darauf, Hinterziehungszinsen (nicht abziehbar, § 4 Abs. 5b, Abs. 5 Satz 1 Nr. 8a EStG)",
      euer.gewerbesteuerNichtAbziehbar,
    ]);
  }
  return toCsv(rows);
}
