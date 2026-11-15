import type { BasisPoints, Cents } from "@haben/core";
import { AUTOMATIC, BU_RATES, isPersonenkonto, shortAccount, type Kontenrahmen } from "../../datev.ts";
import type { SevExport, SevExportLine, SevExportVoucher } from "./types.ts";

/*
 * Ein Beleg aus dem Export als Archivbeleg (lexoffice_vouchers, Quelle `sevdesk-export`). Maßgeblich ist die Buchung, nicht
 * der Ordner in sevDesk:
 *
 * - Erlöskonto: Einnahme, Aufwandskonto: Ausgabe, mit dem Vorzeichen des Lesers (positiv: Erlös im Haben, Aufwand im Soll).
 *   Eine Gutschrift auf dem Erlöskonto wird so eine negative Einnahme, eine Gutschrift im Gutschriftverfahren (Honorar,
 *   Provision) eine Ausgabe wie in der API (#535).
 * - Weder Erlös- noch Aufwandskonto (Darlehen, Privat, Zinsen, Steuern, Anlagen): Die Richtung folgt dem Geldfluss am
 *   Sachkonto. Steht es im Haben, kommt Geld herein (Einnahme), im Soll geht es hinaus (Ausgabe); der Betrag ist positiv.
 *   So führt auch die API solche Belege (`creditDebit` D für ein erhaltenes Darlehen). Ob sie in Einnahmen und Ausgaben
 *   zählen, entscheidet nicht dieser Beleg: Die Summen der Exportjahre kommen aus dem Buchungsstapel (Abgleich).
 */

export type SevArchiveType = "salesinvoice" | "salescreditnote" | "purchaseinvoice" | "purchasecreditnote";

export interface SevArchiveVoucher {
  /** `sevdesk-export/<GUID>`, ohne Beleglink `sevdesk-export/<Belegnummer>|<Datum>|<Personenkonto>|<Kontoart>` */
  externalId: string;
  type: SevArchiveType;
  direction: "einnahme" | "ausgabe";
  /** Art des Sachkontos; `sonstige`: weder Erlös noch Aufwand */
  accountKind: "erloese" | "aufwand" | "sonstige";
  /** Sachkonto der ersten Zeile, nach dem sich die Richtung richtet */
  account: string;
  number: string;
  date: string;
  contactName: string;
  net: Cents;
  tax: Cents;
  gross: Cents;
  rate: BasisPoints;
}

export const SEV_EXPORT_PREFIX = "sevdesk-export/";

const normalizeBu = (bu: string) => bu.trim().replace(/^0+/, "");

/** Sachkonto einer Zeile (das, was kein Personenkonto ist) und ob es im Soll steht */
function sachkonto(line: SevExportLine, accountLength: number): { account: string; debited: boolean } {
  const { account, contraAccount, side } = line.booking;
  if (isPersonenkonto(account, accountLength) && !isPersonenkonto(contraAccount, accountLength)) return { account: contraAccount, debited: side === "H" };
  return { account, debited: side === "S" };
}

/** Steuersatz einer Zeile aus BU-Schlüssel oder Automatikkonto, in Prozent; BU 40 hebt die Automatik auf */
function lineRate(line: SevExportLine, kontenrahmen: Kontenrahmen, account: string): number {
  const bu = normalizeBu(line.booking.buKey);
  if (bu === "40") return 0;
  return BU_RATES[bu] ?? AUTOMATIC[kontenrahmen][shortAccount(account)] ?? 0;
}

export function archiveVoucherOf(exp: SevExport, voucher: SevExportVoucher): SevArchiveVoucher {
  const stackOf = (name: string) => exp.stacks.find((s) => s.name === name);
  const accountLength = (line: SevExportLine) => stackOf(line.stack)?.stack.header.accountLength || 4;
  const kontenrahmen = (line: SevExportLine) => stackOf(line.stack)?.kontenrahmen ?? "SKR03";
  const first = voucher.lines[0]!;
  const firstSach = sachkonto(first, accountLength(first));

  let gross: Cents;
  let direction: SevArchiveVoucher["direction"];
  // Vorzeichen je Zeile im Verhältnis zum Beleg: Eine Minderung (Rabatt, verrechnete Anzahlung) mindert auch die Steuer
  let lineSigns: number[];
  if (voucher.accountKind) {
    gross = voucher.amount;
    direction = voucher.accountKind === "erloese" ? "einnahme" : "ausgabe";
    lineSigns = voucher.lines.map((line) => Math.sign(line.amount));
  } else {
    // Positiv: Geld geht hinaus (Sachkonto im Soll)
    const outflowSigns = voucher.lines.map((line) => (sachkonto(line, accountLength(line)).debited ? 1 : -1));
    const outflow = voucher.lines.reduce((sum, line, i) => sum + outflowSigns[i]! * Math.abs(line.amount), 0);
    gross = Math.abs(outflow);
    direction = outflow >= 0 ? "ausgabe" : "einnahme";
    lineSigns = outflowSigns.map((s) => (outflow >= 0 ? s : -s));
  }

  // Steuer aus Beleginfo (in Euro, auch bei Fremdwährung), sonst aus BU-Schlüssel oder Automatikkonto je Zeile
  const rates = voucher.lines.map((line) => lineRate(line, kontenrahmen(line), sachkonto(line, accountLength(line)).account));
  const fromInfo = voucher.lines.some((line) => line.info.tax !== null);
  const tax = voucher.lines.reduce((sum, line, i) => {
    const rate = rates[i]!;
    const lineTax = fromInfo ? Math.abs(line.info.tax ?? 0) : rate ? Math.round((Math.abs(line.amount) * rate) / (100 + rate)) : 0;
    return sum + lineSigns[i]! * lineTax;
  }, 0);
  const rate = voucher.rate ?? (rates.every((r) => r === rates[0]) ? rates[0]! * 100 : 0);

  const type: SevArchiveType =
    direction === "einnahme" ? (gross < 0 ? "salescreditnote" : "salesinvoice") : voucher.selfBilled || gross < 0 ? "purchasecreditnote" : "purchaseinvoice";
  return {
    externalId: `${SEV_EXPORT_PREFIX}${voucher.guid ?? voucher.key}`,
    type,
    direction,
    accountKind: voucher.accountKind ?? "sonstige",
    account: firstSach.account,
    number: voucher.number,
    date: voucher.date,
    contactName: voucher.lines.map((l) => l.info.entries.Name ?? "").find((name) => name !== "") ?? "",
    net: gross - tax,
    tax,
    gross,
    rate: tax === 0 ? 0 : rate,
  };
}
