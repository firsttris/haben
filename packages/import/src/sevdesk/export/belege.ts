import { formatDecimal } from "@haben/core";
import { datevAccountKind, isPersonenkonto, type DatevBooking, type Kontenrahmen } from "../../datev.ts";
import { parseGermanAmount } from "../../text.ts";
import type { SevBelegInfo, SevExportDirection, SevExportDocument, SevExportLine, SevExportStack, SevExportVoucher } from "./types.ts";

/*
 * Belege aus den Zeilen der Buchungsstapel. Ein Beleg ist eine GUID aus dem Beleglink (`BEDI "<guid>"`): Am
 * Jahresexport aus 1.0 gehört jede GUID zu genau einer Datei (docs/sevdesk.md). Zeilen ohne Beleglink werden nur
 * dann ein Beleg, wenn sie Netto, Steuer oder Satz in Beleginfo tragen und auf einem Erlös- oder Aufwandskonto
 * stehen; Zahlungen, Privat- und Umbuchungen tragen das nicht. Ihr Schlüssel ist Belegnummer plus Belegdatum,
 * denn wiederkehrende Belege teilen die Nummer, dazu Personenkonto und Kontoart, denn zwei Lieferanten können
 * dieselbe Rechnungsnummer am selben Tag vergeben.
 */

type AccountKind = "erloese" | "aufwand";

/** Das Konto der Zeile, nach dem sich Richtung und Vorzeichen richten */
interface Sachkonto {
  kind: AccountKind | null;
  account: string;
  debited: boolean;
}

interface Group {
  guid: string | null;
  lines: { stack: string; booking: DatevBooking; info: SevBelegInfo; sach: Sachkonto }[];
}

const BEDI = /^BEDI\s+"([^"]+)"\s*$/i;
const KIND_DIRECTION: Record<AccountKind, SevExportDirection> = { erloese: "ausgang", aufwand: "eingang" };
const FOLDER: Record<SevExportDirection, string> = { eingang: "Rechnungseingang", ausgang: "Rechnungsausgang" };
const KIND_NAME: Record<AccountKind, string> = { erloese: "Erlöskonto", aufwand: "Aufwandskonto" };

/** `Beleginfo-Art n` und `Beleginfo-Inhalt n` aus den Spalten der Zeile; Satz in Prozent wird Basispunkte */
export function belegInfo(raw: Record<string, string>): SevBelegInfo {
  const entries: Record<string, string> = {};
  for (let n = 1; n <= 20; n++) {
    const art = raw[`Beleginfo-Art ${n}`]?.trim();
    if (art) entries[art] = (raw[`Beleginfo-Inhalt ${n}`] ?? "").trim();
  }
  // parseGermanAmount rechnet „19“ in 1900 (Cent), das sind zugleich die Basispunkte von 19 %
  const value = (art: string) => (entries[art] ? parseGermanAmount(entries[art]) : null);
  return { net: value("Nettobetrag"), tax: value("Steuerbetrag"), rate: value("Umsatzsteuerprozent"), entries };
}

function sachkontoOf(booking: DatevBooking, kontenrahmen: Kontenrahmen, accountLength: number): Sachkonto {
  const sides: [string, boolean][] = [
    [booking.account, booking.side === "S"],
    [booking.contraAccount, booking.side === "H"],
  ];
  for (const [account, debited] of sides) {
    const kind = datevAccountKind(kontenrahmen, account, accountLength);
    if (kind === "erloese" || kind === "aufwand") return { kind, account, debited };
  }
  const [account, debited] = sides.find(([a]) => !isPersonenkonto(a, accountLength)) ?? sides[0]!;
  return { kind: null, account, debited };
}

/** Positiv: Erlös im Haben, Aufwand im Soll; ohne solches Konto nach der Richtung des Belegs */
function signOf(sach: Sachkonto, direction: SevExportDirection | null): 1 | -1 {
  const kind = sach.kind ?? (direction === "ausgang" ? "erloese" : direction === "eingang" ? "aufwand" : null);
  if (kind === null) return 1;
  return (kind === "aufwand") === sach.debited ? 1 : -1;
}

function groupLines(stacks: SevExportStack[], hints: string[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const { name, stack, kontenrahmen } of stacks) {
    const accountLength = stack.header.accountLength || 4;
    for (const booking of stack.bookings) {
      const where = `${name}, Zeile ${booking.row}`;
      if (booking.currency !== "EUR") hints.push(`${where}: Umsatz in ${booking.currency}, nicht in Euro umgerechnet.`);
      const guid = BEDI.exec(booking.documentLink)?.[1] ?? null;
      if (!guid && booking.documentLink !== "") hints.push(`${where}: Beleglink „${booking.documentLink}“ ist kein BEDI-Verweis.`);
      const info = belegInfo(booking.raw);
      const sach = sachkontoOf(booking, kontenrahmen, accountLength);
      const withInfo = info.net !== null || info.tax !== null || info.rate !== null;
      if (!guid && !(withInfo && sach.kind)) continue;
      if (info.net !== null && info.tax !== null && Math.abs(info.net + info.tax) !== booking.amount) {
        hints.push(
          `${where}: Netto ${formatDecimal(info.net)} und Steuer ${formatDecimal(info.tax)} aus Beleginfo ergeben nicht den Umsatz ${formatDecimal(booking.amount)}.`,
        );
      }
      const partner = [booking.account, booking.contraAccount].find((a) => isPersonenkonto(a, accountLength)) ?? "";
      const key = guid ?? (booking.voucherField1 ? `${booking.voucherField1}|${booking.date}|${partner}|${sach.kind}` : `${name}:${booking.row}`);
      const group = groups.get(key) ?? { guid, lines: [] };
      group.lines.push({ stack: name, booking, info, sach });
      groups.set(key, group);
    }
  }
  return groups;
}

/** Summe der Werte, die da sind; null, wenn keiner da ist */
const sumOf = (values: (number | null)[]) => (values.some((v) => v !== null) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null);
/** Der eine Wert aller Einträge, sonst null */
const sameOf = <T>(values: T[]) => (values.length > 0 && values.every((v) => v === values[0]) ? values[0]! : null);

function voucherOf(key: string, group: Group, document: SevExportDocument | null, hints: string[]): SevExportVoucher {
  const first = group.lines[0]!;
  const label = `Beleg ${first.booking.voucherField1 || "ohne Nummer"}${group.guid ? ` (GUID ${group.guid})` : ""}`;
  const sach = group.lines.find((l) => l.sach.kind)?.sach ?? null;
  const accountKind = sach?.kind ?? null;
  const direction = document?.direction ?? (accountKind ? KIND_DIRECTION[accountKind] : null);
  const directionFrom = document?.direction ? "document" : accountKind ? "konten" : null;
  if (group.guid && !document) hints.push(`${label}: keine Datei im Export.`);
  if (document?.direction && sach?.kind && KIND_DIRECTION[sach.kind] !== document.direction) {
    hints.push(`${label}: liegt im ${FOLDER[document.direction]}, gebucht auf ${KIND_NAME[sach.kind]} ${sach.account}; Richtung prüfen.`);
  }
  const lines: SevExportLine[] = group.lines.map(({ stack, booking, info, sach: s }) => ({
    stack,
    booking,
    info,
    amount: signOf(s, direction) * booking.amount,
  }));
  const currency = sameOf(lines.map((l) => l.booking.currency));
  if (currency === null) hints.push(`${label}: Zeilen in verschiedenen Währungen.`);
  const rates = lines.map((l) => l.info.rate).filter((r) => r !== null);
  return {
    key,
    guid: group.guid,
    number: first.booking.voucherField1,
    date: first.booking.date,
    direction,
    directionFrom,
    accountKind,
    currency,
    amount: lines.reduce((sum, l) => sum + l.amount, 0),
    net: sumOf(lines.map((l) => l.info.net)),
    tax: sumOf(lines.map((l) => l.info.tax)),
    rate: sameOf(rates),
    lines,
    document,
  };
}

/** Belege aus allen Stapeln; meldet GUIDs ohne Datei und Dateien ohne Buchung */
export function buildVouchers(stacks: SevExportStack[], documents: SevExportDocument[], hints: string[]): SevExportVoucher[] {
  const byGuid = new Map(documents.map((d) => [d.guid, d]));
  const groups = groupLines(stacks, hints);
  const vouchers = [...groups].map(([key, group]) => voucherOf(key, group, group.guid ? (byGuid.get(group.guid) ?? null) : null, hints));
  for (const d of documents) {
    if (!groups.has(d.guid)) hints.push(`${d.archive}: Datei ${d.fileName} (GUID ${d.guid}) ohne Buchung im Stapel.`);
  }
  return vouchers;
}
