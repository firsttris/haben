import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { refreshOwnAccountNames } from "../eigene-konten/index.ts";
import { knownAccounts } from "./journal.ts";

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

async function companyKontenrahmen(): Promise<"SKR03" | "SKR04"> {
  const [row] = await db.select({ kontenrahmen: schema.company.kontenrahmen }).from(schema.company).limit(1);
  return row?.kontenrahmen ?? "SKR03";
}

export interface BookingHit {
  id: string;
  date: string;
  description: string;
  sourceType: typeof schema.journalEntries.$inferSelect.sourceType;
  sourceId: string;
  amount: number;
  accounts: string;
  /** Durch eine Gegenbuchung storniert, wie „storniert“ im Journal */
  reversed: boolean;
}

/**
 * Abfrage der Buchungen zur Schnellsuche, noch nicht ausgeführt; eigene Funktion, damit ein Test ihren Plan prüft.
 * In ein Objekt verpackt, weil ein `await` die Abfrage sonst gleich ausführen würde.
 */
export async function bookingEntriesQuery(query: string, limit: number) {
  await refreshOwnAccountNames();
  const frame = await companyKontenrahmen();
  const needle = normalizeForMatch(query.trim());
  const matchingAccounts = Object.entries(knownAccounts(frame))
    .filter(([nr, name]) => nr.toLowerCase().includes(needle) || normalizeForMatch(name).includes(needle))
    .map(([nr]) => nr)
    .slice(0, 50);

  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  // Soll und Haben stehen ohne Vorzeichen; 0 steht in jeder Zeile auf der leeren Seite und fände jede Buchung
  const lineRange =
    range === null ? null : { min: Math.max(1, Math.min(Math.abs(range.min), Math.abs(range.max))), max: Math.max(Math.abs(range.min), Math.abs(range.max)) };
  const queryDate = parseDateSearch(query);

  // Konten aus dem Kontenrahmen nach Nummer oder Name, eine unbekannte Nummer (etwa ein Personenkonto) genau
  const accounts = /^\d{4,9}$/.test(query.trim()) ? [...new Set([...matchingAccounts, query.trim()])] : matchingAccounts;
  const lineConditions = [
    ...(accounts.length > 0 ? [inArray(jl.account, accounts)] : []),
    // Nur die Bruttozeile (#1038): ihr Betrag ist die Summe ihrer Seite, Netto- und Steuerzeilen sind kleiner
    ...(lineRange !== null && lineRange.max > 0
      ? [
          and(amountIn(jl.debit, lineRange), sql`${jl.debit} = (select sum(x.debit) from journal_lines x where x.entry_id = ${jl}.entry_id)`),
          and(amountIn(jl.credit, lineRange), sql`${jl.credit} = (select sum(x.credit) from journal_lines x where x.entry_id = ${jl}.entry_id)`),
        ]
      : []),
  ];
  // Ein `id in (Unterabfrage)` im `or` ließe Postgres alle Buchungen lesen; als `union` nutzt jeder Teil seinen Index.
  const textMatches = db
    .select({ id: je.id })
    .from(je)
    .where(or(unaccentIlike(je.description, pattern), ...(queryDate !== null ? [eq(je.date, queryDate)] : [])));
  const lineMatches = db
    .select({ id: jl.entryId })
    .from(jl)
    .where(or(...lineConditions));
  const matches = lineConditions.length > 0 ? sql`${textMatches} union ${lineMatches}` : sql`${textMatches}`;

  const select = db
    .select({
      id: je.id,
      date: je.date,
      description: je.description,
      sourceType: je.sourceType,
      sourceId: je.sourceId,
    })
    .from(je)
    .where(sql`${je.id} in (${matches})`)
    .orderBy(desc(je.date), desc(je.createdAt))
    .limit(limit + 1);
  return { select };
}

/** Buchungen für die Befehlspalette (#617): Buchungstext, Konto, Betrag und Datum; auch für Steuerberatung */
export async function searchBookings(query: string, limit = 5): Promise<{ hits: BookingHit[]; more: boolean }> {
  const jl = schema.journalLines;
  const entries = await (await bookingEntriesQuery(query, limit)).select;

  const top = entries.slice(0, limit);
  const ids = top.map((e) => e.id);
  const [lines, reversals] = top.length
    ? await Promise.all([
        db.select().from(jl).where(inArray(jl.entryId, ids)),
        db.select({ id: schema.journalEntries.reversesId }).from(schema.journalEntries).where(inArray(schema.journalEntries.reversesId, ids)),
      ])
    : [[], []];
  const reversed = new Set(reversals.map((r) => r.id));

  return {
    hits: top.map((e) => {
      const entryLines = lines.filter((l) => l.entryId === e.id);
      const debitTotal = entryLines.reduce((sum, l) => sum + l.debit, 0);
      const acctList = [...new Set(entryLines.map((l) => l.account))].slice(0, 3).join(" / ");
      return { ...e, amount: debitTotal, accounts: acctList, reversed: reversed.has(e.id) };
    }),
    more: entries.length > limit,
  };
}

export interface AccountHit {
  account: string;
  name: string;
  kontenrahmen: "SKR03" | "SKR04";
}

/** Sachkonten (SKR03/04 und eigene Konten) für die Befehlspalette (#617); auch für Steuerberatung */
export async function searchAccounts(query: string, limit = 5): Promise<{ hits: AccountHit[]; more: boolean }> {
  await refreshOwnAccountNames();
  const frame = await companyKontenrahmen();
  const needle = normalizeForMatch(query.trim());
  const matches = Object.entries(knownAccounts(frame))
    .filter(([nr, name]) => nr.toLowerCase().includes(needle) || normalizeForMatch(name).includes(needle))
    .sort(([a], [b]) => {
      const aExact = a.toLowerCase() === needle ? 0 : a.toLowerCase().startsWith(needle) ? 1 : 2;
      const bExact = b.toLowerCase() === needle ? 0 : b.toLowerCase().startsWith(needle) ? 1 : 2;
      return aExact - bExact || a.localeCompare(b);
    });
  return {
    hits: matches.slice(0, limit).map(([account, name]) => ({ account, name, kontenrahmen: frame })),
    more: matches.length > limit,
  };
}

export interface AssetHit {
  id: string;
  name: string;
  account: string;
  acquisitionDate: string;
  cost: number;
}

/** Anlagen für die Befehlspalette (#617): Name, Anlagekonto, Notiz */
export async function searchAssets(query: string, limit = 5): Promise<{ hits: AssetHit[]; more: boolean }> {
  const a = schema.assets;
  const pattern = likePattern(query);
  const rows = await db
    .select({ id: a.id, name: a.name, account: a.account, acquisitionDate: a.acquisitionDate, cost: a.cost })
    .from(a)
    .where(or(unaccentIlike(a.name, pattern), unaccentIlike(a.account, pattern), unaccentIlike(a.note, pattern)))
    .orderBy(asc(a.name))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

export interface PauschaleHit {
  id: string;
  art: (typeof schema.pauschalen.$inferSelect)["art"];
  date: string;
  description: string;
  amount: number;
  /** Storniert wie auf der Seite Pauschalen; die Gegenzeilen selbst erscheinen dort und hier nicht */
  storniert: boolean;
}

/** Pauschalen für die Befehlspalette (#617): Anlass/Text, Art, Datum, Betrag */
export async function searchPauschalen(query: string, limit = 5): Promise<{ hits: PauschaleHit[]; more: boolean }> {
  const p = schema.pauschalen;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  const rows = await db
    .select({
      id: p.id,
      art: p.art,
      date: p.date,
      description: p.description,
      amount: p.amount,
      storniert: sql<boolean>`exists(select 1 from pauschalen r where r.reverses_id = ${p}.id)`,
    })
    .from(p)
    .where(
      and(
        isNull(p.reversesId),
        or(
          unaccentIlike(p.description, pattern),
          unaccentIlike(sql`${p.art}::text`, pattern),
          ...(range !== null ? [amountIn(p.amount, range)] : []),
          ...(queryDate !== null ? [eq(p.date, queryDate)] : []),
        ),
      ),
    )
    .orderBy(numberRank(p.description, query), desc(p.date))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
