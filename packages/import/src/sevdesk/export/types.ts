import type { BasisPoints, Cents } from "@haben/core";
import type { DatevBooking, DatevStack, Kontenrahmen } from "../../datev.ts";

/** Ordner in sevDesk: Rechnungseingang (`type` 1, Ausgaben) oder Rechnungsausgang (`type` 2, Einnahmen) */
export type SevExportDirection = "eingang" | "ausgang";

export interface SevExportLimits {
  /** Einträge in der ZIP und allen inneren ZIPs zusammen */
  maxEntries: number;
  /** Entpackte Bytes aller gelesenen Einträge zusammen, innere ZIPs eingeschlossen */
  maxUnpackedBytes: number;
}

export interface SevExportOptions {
  /** Kontenrahmen der Firma; sevDesk lässt das Feld im Kopf des Stapels leer, sonst gilt der Kopf */
  kontenrahmen: Kontenrahmen;
  limits?: Partial<SevExportLimits>;
}

export interface SevExportStack {
  /** Pfad in der ZIP */
  name: string;
  bytes: Uint8Array;
  stack: DatevStack;
  kontenrahmen: Kontenrahmen;
}

/** Ein `<document>` aus `document.xml` einer inneren ZIP */
export interface SevExportDocument {
  guid: string;
  /** Aus `type`, sonst aus dem Namen der inneren ZIP; null, wenn beides fehlt */
  direction: SevExportDirection | null;
  /** `<extension name="…">` */
  fileName: string;
  /** Pfad der inneren ZIP in der Export-ZIP */
  archive: string;
  /** Das Element, wie es der XML-Parser liefert (Attribute ohne Präfix) */
  element: Record<string, unknown>;
}

export interface SevExportFile {
  fileName: string;
  bytes: Uint8Array;
}

/** `Beleginfo-Art n` → `Beleginfo-Inhalt n` einer Zeile, Beträge so, wie sie in der Datei stehen */
export interface SevBelegInfo {
  net: Cents | null;
  tax: Cents | null;
  rate: BasisPoints | null;
  entries: Record<string, string>;
}

export interface SevExportLine {
  /** Pfad des Stapels in der ZIP */
  stack: string;
  booking: DatevBooking;
  info: SevBelegInfo;
  /** Umsatz in Euro mit dem Vorzeichen des Belegs (siehe `SevExportVoucher.amount`); bei Fremdwährung aus Beleginfo */
  amount: Cents;
  /** Umsatz in Fremdwährung mit demselben Vorzeichen; null bei Euro */
  foreignAmount: Cents | null;
}

export interface SevExportVoucher {
  /** GUID aus dem Beleglink, ohne ihn `<Belegfeld 1>|<Belegdatum>|<Personenkonto>|<erloese oder aufwand>` */
  key: string;
  guid: string | null;
  /** Belegfeld 1 der ersten Zeile; von sevDesk gekürzt auf die letzten 36 Zeichen */
  number: string;
  /** Belegdatum der ersten Zeile, ISO */
  date: string;
  direction: SevExportDirection | null;
  /** Woher die Richtung kommt: Ordner in document.xml oder Kontenbereich des Sachkontos */
  directionFrom: "document" | "konten" | null;
  /** Erlös- oder Aufwandskonto der ersten Zeile, die eines trägt */
  accountKind: "erloese" | "aufwand" | null;
  /** Währung aller Zeilen; null, wenn sie sich unterscheiden */
  currency: string | null;
  /**
   * Summe der Zeilen in Euro (bei Fremdwährung aus Beleginfo, ohne sie in der Fremdwährung). Positiv ist ein Erlös im Haben bzw. ein Aufwand im Soll; eine Gutschrift auf
   * dem Erlöskonto wird so negativ. Ohne Erlös- oder Aufwandskonto entscheidet die Richtung.
   */
  amount: Cents;
  /** Summe der Zeilen in der Fremdwährung `currency`; null bei Euro oder verschiedenen Währungen */
  foreignAmount: Cents | null;
  /** Summe aus Beleginfo je Zeile; null, wenn keine Zeile den Wert trägt */
  net: Cents | null;
  tax: Cents | null;
  /** Satz aller Zeilen; null, wenn keiner da ist oder sie sich unterscheiden */
  rate: BasisPoints | null;
  lines: SevExportLine[];
  document: SevExportDocument | null;
}

export interface SevExport {
  stacks: SevExportStack[];
  /** `EXTF_GP_Stamm_….csv`, ungelesen */
  partnerFiles: { name: string; bytes: Uint8Array }[];
  vouchers: SevExportVoucher[];
  documents: SevExportDocument[];
  /** Belegdatei je GUID; eine Datei darf unter mehreren GUIDs stehen */
  files: Map<string, SevExportFile>;
  hints: string[];
}

export type SevExportResult = { ok: true; export: SevExport } | { ok: false; reason: string };
