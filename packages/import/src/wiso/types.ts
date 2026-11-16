import type { BasisPoints, Cents } from "@haben/core";
import type { LegacyVoucher } from "../lexoffice/map.ts";

export class WisoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WisoParseError";
  }
}

export interface WisoCsvRow {
  rowNumber: number;
  buchungsnummer: string;
  teilbuchung: string;
  zahlungsdatum: string;
  wertstellungsdatum: string;
  buchungstext: string;
  konto: string;
  kontobezeichnung: string;
  gegenkonto: string;
  gegenkontobezeichnung: string;
  soll: Cents;
  haben: Cents;
  steuerschluessel: string;
  steuersatz: BasisPoints;
  steuerschluesselbezeichnung: string;
  belegnummer: string;
  buchungsdatum: string | null;
  ustId: string;
  umsatzart: string;
}

export interface WisoVoucher {
  voucher: LegacyVoucher;
  bookingKey: string;
  year: number;
  raw: Record<string, unknown>;
  neutral: boolean;
  /** Tatsächlicher Zu- oder Abfluss; bei § 13b UStG und EU-Erwerb das Netto */
  paid: Cents;
}

export interface WisoPreview {
  years: number[];
  dateFrom: string;
  dateTo: string;
  bookings: number;
  rows: number;
  vouchers: WisoVoucher[];
  warnings: string[];
}
