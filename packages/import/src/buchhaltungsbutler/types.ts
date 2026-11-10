import type { DatevBooking, DatevStack } from "../datev.ts";
import type { LegacyVoucher } from "../lexoffice/map.ts";

export type BuchhaltungsbutlerRow = Record<string, string>;

export interface BuchhaltungsbutlerInfo {
  bookingId: string;
  url: string;
  contactName: string;
  invoiceNumber: string;
  grossText: string;
  taxRateText: string;
  documentDate: string;
  raw: Record<string, string>;
}

export interface BuchhaltungsbutlerJoinedRow {
  bb: BuchhaltungsbutlerRow;
  datev: DatevBooking;
  info: BuchhaltungsbutlerInfo;
  debitAccount: string;
  creditAccount: string;
}

export interface BuchhaltungsbutlerFile {
  filename: string;
  bytes: Uint8Array;
  role: "pdf" | "xml";
}

export interface BuchhaltungsbutlerVoucher {
  voucher: LegacyVoucher;
  bookingId: string;
  files: BuchhaltungsbutlerFile[];
  raw: Record<string, unknown>;
  /** Weder Einnahme noch Ausgabe (Geldtransit, Privat, Zahlung auf ein Personenkonto) */
  neutral: boolean;
  /** Name der Kategorie für die Einordnung bei GmbH und UG (legacyNeutralKind): „Geldtransit“, Ertragsteuer oder leer */
  categoryName: string;
}

export interface BuchhaltungsbutlerPreview {
  year: number;
  dateFrom: string | null;
  dateTo: string | null;
  bookings: number;
  vouchers: BuchhaltungsbutlerVoucher[];
  files: number;
  withoutReceipt: number;
  multipleFiles: number;
  warnings: string[];
}

export interface BuchhaltungsbutlerExport {
  stack: DatevStack;
  rows: BuchhaltungsbutlerJoinedRow[];
  files: Map<string, BuchhaltungsbutlerFile[]>;
}

export class BuchhaltungsbutlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuchhaltungsbutlerError";
  }
}
