import type { InvoiceTotals } from "./invoice.ts";
import { toCsv, type BasisPoints, type Cents, type Prozent } from "./money.ts";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type TaxShare } from "./posting.ts";
import type { DocumentEuerEffect } from "./euer-beleg.ts";
export { documentEuerEffects, type DocumentEuerEffect, type DocumentEuerEvent } from "./euer-beleg.ts";
export { computeEuer } from "./euer-zahlungen.ts";
import type { AllocatedSplitLine } from "./document-split.ts";
import { PAUSCHALE_LABEL, type PauschaleArt } from "./pauschalen.ts";
import type { Steuerart, SteuerPosten } from "./steuerzahlung.ts";
import type { DarlehenTeil, DarlehenZweck } from "./darlehen.ts";
import type { TaxTreatment } from "./treatment.ts";
import type { DirektKategorie } from "./direkt-kategorie.ts";

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
      /** Gespeicherter Abzugsanteil in Basispunkten; null fällt bei Altbelegen auf vorsteuerAbzug zurück */
      vorsteuerAnteil?: BasisPoints | null;
      /** Bisheriger Zahlbetrag: neue Teilabzüge runden kumuliert, auch bei Zahlungen über den Jahreswechsel */
      paidBefore?: Cents;
      /** Aus vorhandenen Zahlungen berechnete Wirkung; Rücknahmen behalten den gerundeten Anteil ihres Ursprungs */
      effect?: DocumentEuerEffect;
      /** Privatanteil in Prozent: nur der betriebliche Teil ist Ausgabe bzw. Vorsteuer */
      privateShare?: Prozent;
      /** Aufgeteilter Beleg (#271): Netto und Vorsteuer je Kontierungszeile; category gilt dann nicht */
      splits?: AllocatedSplitLine[];
      /** § 13b und Erwerb: selbst geschuldete Steuer des ganzen Belegs je Steuersatz (totals tragen dann keine Steuer) */
      selbstGeschuldet?: readonly Cents[];
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
      /** Richtung der ursprünglichen USt-Zuordnung, auch wenn nur ihre Gegenzeile in dieses Jahr fällt; sonst nach Vorzeichen */
      ustAbfluss?: boolean;
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
      /** Nur Gegenzeilen: Richtung der ursprünglichen Zuordnung; der Betrag behält sein tatsächliches Vorzeichen. */
      steuerErstattung?: boolean;
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
    }
  | {
      /**
       * Direkt auf eine Kategorie gebuchter Teil eines Bankumsatzes (direkt-kategorie.ts), Vorzeichen wie auf dem Konto:
       * Einnahme netto und Umsatzsteuer, Ausgabe brutto ohne Vorsteuer
       */
      kind: "kategorie";
      date: string;
      amount: Cents;
      kategorie: DirektKategorie;
      steuersatz: BasisPoints;
      group?: string;
    };

export type EuerLineKey =
  | "einnahmenKleinunternehmer"
  | "einnahmenSteuerpflichtig"
  | "einnahmenSteuerfrei"
  | "privateKfz"
  | "sachentnahmen"
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
  sachentnahmen: "Sonstige Sach-, Nutzungs- und Leistungsentnahmen",
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

/**
 * Die EÜR aus den Summen je Zeile: Zeilen mit Bezeichnung in der Reihenfolge der Anlage EÜR, Summen und Gewinn. Gemeinsam
 * für computeEuer (Nebenbücher) und die EÜR aus dem Journal ab dem Stichjahr (#542). AfA und Privatnutzung kommen dazu, wenn
 * sie übergeben sind (aus dem Anlagenverzeichnis).
 */
export function euerErgebnis(
  year: number,
  summen: ReadonlyMap<EuerLineKey, Cents>,
  monthly: { einnahmen: Cents[]; ausgaben: Cents[] },
  bewirtungNichtAbziehbar: Cents,
  gewerbesteuerNichtAbziehbar: Cents,
  depreciation?: EuerDepreciation,
  withdrawals?: EuerWithdrawals,
): EuerResult {
  const sums = new Map(summen);
  const add = (key: EuerLineKey, amount: Cents) => sums.set(key, (sums.get(key) ?? 0) + amount);
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
    key:
      | "privateKfz"
      | "sachentnahmen"
      | "ustEntnahmen"
      | "kursgewinne"
      | "kursverluste"
      | "personal"
      | "steuerNebenleistungen"
      | "schuldzinsenAnlage"
      | "schuldzinsen",
  ) => ((sums.get(key) ?? 0) !== 0 ? [line(key, EUER_LABELS[key])] : []);
  const einnahmen = [
    ...(sums.has("einnahmenKleinunternehmer") ? [line("einnahmenKleinunternehmer", EUER_LABELS.einnahmenKleinunternehmer)] : []),
    line("einnahmenSteuerpflichtig", EUER_LABELS.einnahmenSteuerpflichtig),
    line("einnahmenSteuerfrei", EUER_LABELS.einnahmenSteuerfrei),
    ...optional("privateKfz"),
    ...optional("sachentnahmen"),
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
    monthly,
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
