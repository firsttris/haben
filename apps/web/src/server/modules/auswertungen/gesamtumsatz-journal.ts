import { ACCOUNTS, settlementTaxShares, type InvoiceTotals, type Kontenrahmen, type TaxShare } from "@haben/core";
import { and, asc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { externalSettlementLinks } from "../datenimport/index.ts";
import { turnoverRange, unknownTurnover, type GesamtumsatzItem } from "./gesamtumsatz-quellen.ts";

type JournalLine = typeof schema.journalLines.$inferSelect;
type Journal = typeof schema.journalEntries.$inferSelect & { lines: JournalLine[] };
const outgoingCodes = new Set(["USt19", "USt7", "frei", "KU", "Steuerfrei", "RC", "Drittland", "NichtSteuerbar", "IGL", "Ausfuhr"]);
const incomingCodes = new Set(["VSt19", "VSt7", "keineVSt", "RC13bEU", "RC13bDrittland", "VSt13b", "IGE19", "IGE7", "VStIGE", "EUSt"]);

async function journalRows(q: Db | Tx, where: SQL) {
  const e = schema.journalEntries;
  const rows = await q
    .select({ entry: e, line: schema.journalLines })
    .from(e)
    .innerJoin(schema.journalLines, eq(e.id, schema.journalLines.entryId))
    .where(where)
    .orderBy(asc(e.date), asc(e.createdAt), asc(e.id));
  const result = new Map<string, Journal>();
  for (const row of rows) {
    let entry = result.get(row.entry.id);
    if (!entry) {
      entry = { ...row.entry, lines: [] };
      result.set(entry.id, entry);
    }
    entry.lines.push(row.line);
  }
  return [...result.values()];
}

const receivable = (entry: Journal) =>
  entry.lines.filter((l) => l.account === ACCOUNTS[entry.kontenrahmen].forderungen).reduce((sum, l) => sum + l.debit - l.credit, 0);

/** Nur Beträge aus dem ausdrücklich verknüpften Ausgangsposten; keine EÜR-Zeile oder Gewinnsumme. */
function originalTotals(entry: Journal): InvoiceTotals | null {
  const accounts = ACCOUNTS[entry.kontenrahmen];
  const taxes = new Map<number, { rate: number; base: number; tax: number }>();
  for (const line of entry.lines) {
    if (!line.taxCode || !outgoingCodes.has(line.taxCode) || line.account === accounts.forderungen) continue;
    const rate = line.taxCode === "USt19" ? 1900 : line.taxCode === "USt7" ? 700 : 0;
    const row = taxes.get(rate) ?? { rate, base: 0, tax: 0 };
    const taxAccounts = [...Object.values(accounts.ust), ...Object.values(accounts.ustNichtFaellig)];
    if (taxAccounts.some((account) => account === line.account)) row.tax += line.credit - line.debit;
    else row.base += line.credit - line.debit;
    taxes.set(rate, row);
  }
  const rows = [...taxes.values()];
  const net = rows.reduce((sum, row) => sum + row.base, 0);
  const tax = rows.reduce((sum, row) => sum + row.tax, 0);
  const gross = receivable(entry);
  return rows.length && gross !== 0 && net + tax === gross ? { net, tax, gross, taxes: rows } : null;
}

async function settlementItems(year: number, q: Db | Tx, entries: Journal[]) {
  const imports = new Map<string, string>();
  const ids = entries.filter((e) => e.sourceType === "import").map((e) => e.id);
  for (let i = 0; i < ids.length; i += 5000)
    for (const row of await q
      .select({ id: schema.externalImports.id, entry: schema.externalImports.entryId })
      .from(schema.externalImports)
      .where(inArray(schema.externalImports.entryId, ids.slice(i, i + 5000))))
      if (row.entry) imports.set(row.entry, row.id);
  const links = await externalSettlementLinks(q, [...imports.values()]);
  const needed = [...new Set(links.flatMap((row) => [row.originalId, row.paymentId]))];
  const all = new Map<string, Journal>();
  for (let i = 0; i < needed.length; i += 5000)
    for (const entry of await journalRows(q, inArray(schema.journalEntries.id, needed.slice(i, i + 5000)))) all.set(entry.id, entry);
  const { start, end } = turnoverRange(year);
  const result = new Map<string, GesamtumsatzItem>();
  for (const originalId of new Set(links.map((row) => row.originalId))) {
    const original = all.get(originalId)!;
    const totals = originalTotals(original);
    let settled = 0;
    const recorded: TaxShare[] = [];
    const previous = new Map<string, TaxShare[]>();
    const payments = links
      .filter((row) => row.originalId === originalId)
      .sort((a, b) => all.get(a.paymentId)!.date.localeCompare(all.get(b.paymentId)!.date) || a.externalId.localeCompare(b.externalId));
    for (const link of payments) {
      const payment = all.get(link.paymentId)!;
      const amount = -receivable(payment);
      const reverse = payment.reversesId ? previous.get(payment.reversesId) : undefined;
      const shares = reverse
        ? reverse.map((row) => ({ rate: row.rate, base: -row.base, tax: -row.tax }))
        : totals
          ? settlementTaxShares(totals, settled, recorded, amount)
          : null;
      if (shares) {
        previous.set(payment.id, shares);
        recorded.push(...shares);
      }
      settled += amount;
      if (payment.date < start || payment.date >= end) continue;
      const item = unknownTurnover(
        "journal",
        payment.id,
        payment.description,
        payment.date,
        amount,
        "Der Zahlungsbezug ist bestätigt; strukturierte Vorschrift, Leistungsort und Anlagevermögenszuordnung fehlen im Journal.",
      );
      if (shares) {
        item.net = shares.reduce((sum, row) => sum + row.base, 0);
        item.basisSource = "derived";
      }
      result.set(payment.id, item);
    }
  }
  return { items: result, originalIds: new Set(links.map((row) => row.originalId)) };
}

function monetaryAccount(account: string, kr: Kontenrahmen) {
  const own = ACCOUNTS[kr];
  return [own.bank, own.kasse, own.geldtransit].some((value) => value === account);
}

function journalItem(entry: Journal): GesamtumsatzItem | null {
  const accounts = ACCOUNTS[entry.kontenrahmen];
  if (entry.lines.some((line) => line.account === accounts.saldenvortrag)) return null;
  const outgoing = entry.lines.some((line) => line.taxCode && outgoingCodes.has(line.taxCode));
  const incoming = entry.lines.some((line) => line.taxCode && incomingCodes.has(line.taxCode));
  const money = entry.lines.filter((line) => monetaryAccount(line.account, entry.kontenrahmen));
  if (!outgoing && incoming) return null;
  if (entry.lines.every((line) => monetaryAccount(line.account, entry.kontenrahmen))) return null;
  if (receivable(entry) > 0 && !money.length) return null; // Die dokumentierte Forderungsentstehung ist noch kein Entgelt.
  const gross = money.length ? money.reduce((sum, line) => sum + line.debit - line.credit, 0) : null;
  return unknownTurnover(
    "journal",
    entry.id,
    entry.description,
    entry.date,
    gross,
    "Freie oder importierte Buchung: tatsächliches Entgelt und strukturierte Ausgangszuordnung sind nicht vollständig nachgewiesen.",
  );
}

/** Nur Quellen ohne bereits gezähltes Nebenbuch; Eröffnung, Rechnung, Ausbuchung und jährliche Anlagenbuchung fehlen bewusst. */
export async function journalTurnoverItems(year: number, q: Db | Tx): Promise<GesamtumsatzItem[]> {
  const { start, end } = turnoverRange(year);
  const e = schema.journalEntries;
  const entries = await journalRows(q, and(gte(e.date, start), lt(e.date, end), inArray(e.sourceType, ["manuell", "import"]))!);
  const settlements = await settlementItems(year, q, entries);
  const items = [...settlements.items.values()];
  for (const entry of entries) {
    if (settlements.items.has(entry.id) || settlements.originalIds.has(entry.id)) continue;
    const item = journalItem(entry);
    if (item) items.push(item);
  }
  // Archivierte DATEV-Stapel sind kein Zahlungsnebenbuch. Ohne eindeutige Herkunft kann daraus weder ein Zufluss noch
  // eine zweite Zahlung neben dem zugehörigen BuchhaltungsButler-Beleg bewiesen werden.
  const files = await q
    .select({ id: schema.datevBookings.fileId, label: schema.archiveFiles.filename })
    .from(schema.datevBookings)
    .innerJoin(schema.archiveFiles, eq(schema.datevBookings.fileId, schema.archiveFiles.id))
    .where(and(gte(schema.datevBookings.date, start), lt(schema.datevBookings.date, end)))
    .groupBy(schema.datevBookings.fileId, schema.archiveFiles.filename);
  for (const file of files)
    items.push(
      unknownTurnover(
        "journal",
        `datev:${file.id}`,
        file.label,
        null,
        null,
        "Der archivierte DATEV-Stapel hat keine eindeutige Zahlungs-/Leistungszuordnung; Belege und Stapel werden nicht als zwei Zuflüsse gezählt.",
      ),
    );
  return items;
}
