/*
 * Typen für die Erkennung der eigenen Ausgangsrechnung unter den Belegen (Roadmap S4, #104). Wer eine eigene Rechnung
 * als Beleg hochlädt, soll keinen Ausgaben-Vorschlag bekommen. Jede Regel liefert Signale mit einer Konfidenz; die
 * Erkennung fasst sie zu einer Stufe zusammen. Eine neue Regel ist eine Funktion mit der Signatur `OwnInvoiceRule`.
 */

/** Was Haben über die eigene Firma weiß; leere Angaben tragen zu keiner Regel bei */
export interface OwnCompany {
  name: string;
  ustId: string;
  /** Steuernummer in jeder bekannten Schreibweise (wie eingetragen, ELSTER-Format); verglichen werden nur die Ziffern */
  steuernummern: string[];
  iban: string;
  plz: string;
}

/** Eine Zeile aus der Textebene eines PDFs, Lage relativ zur Seite */
export interface TextLine {
  /** Seite, ab 1 */
  page: number;
  text: string;
  /** Oberkante als Anteil der Seitenhöhe, 0 = oben, 1 = unten */
  top: number;
  /** Linke Kante als Anteil der Seitenbreite */
  left: number;
}

/** Eine Partei, wie sie das XML oder die KI angibt */
export interface StatedParty {
  name?: string | null;
  ustId?: string | null;
  steuernummer?: string | null;
  iban?: string | null;
}

/** Rechnungssteller und -empfänger aus einer E-Rechnung (BT-27 ff., BT-44 ff.) oder aus der KI-Auslesung */
export interface StatedParties {
  source: "xml" | "ki";
  seller: StatedParty;
  buyer?: StatedParty;
}

export interface OwnInvoiceInput {
  parties?: StatedParties;
  /** Textebene des PDFs; fehlt bei Fotos und gescannten PDFs ohne Text */
  lines?: TextLine[];
  /**
   * Nummer einer Ausgangsrechnung in Haben mit derselben Rechnungsnummer und demselben Bruttobetrag wie der Beleg; die
   * Nummer allein reicht nicht, „1001“ kann auch ein Lieferant vergeben.
   */
  knownInvoiceNumber?: string | null;
}

/** Wofür ein Signal spricht: eigene Ausgangsrechnung oder Rechnung eines anderen an uns */
export type SignalDirection = "own" | "foreign";

export interface OwnInvoiceSignal {
  /** Kurzer, fester Name der Regel, z. B. „ust-id-im-text“ */
  rule: string;
  direction: SignalDirection;
  /** 0 bis 1: wie sicher die Regel für sich allein ist */
  confidence: number;
  /** Begründung für den Nutzer, auf Deutsch */
  reason: string;
}

export type OwnInvoiceRule = (input: OwnInvoiceInput, company: OwnCompany) => OwnInvoiceSignal[];

export type OwnInvoiceLevel = "sicher" | "vermutlich" | "keine";

export interface OwnInvoiceVerdict {
  level: OwnInvoiceLevel;
  /** Zusammengefasste Konfidenz für „eigene Rechnung“, 0 bis 1 */
  confidence: number;
  signals: OwnInvoiceSignal[];
}
