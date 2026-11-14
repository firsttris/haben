import { parseDateSearch, parseEuroSearchCents } from "@haben/core";
import { asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
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
}

/** Buchungen für die Befehlspalette (#617): Buchungstext, Konto, Betrag und Datum; auch für Steuerberatung */
export async function searchBookings(query: string, limit = 5): Promise<{ hits: BookingHit[]; more: boolean }> {
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
  const cents = parseEuroSearchCents(query);
  const queryDate = parseDateSearch(query);

  const lineMatches = db
    .select({ entryId: jl.entryId })
    .from(jl)
    .where(
      or(
        unaccentIlike(jl.account, pattern),
        ...(matchingAccounts.length > 0 ? [inArray(jl.account, matchingAccounts)] : []),
        ...(cents !== null ? [eq(jl.debit, Math.abs(cents)), eq(jl.credit, Math.abs(cents))] : []),
      ),
    );

  const entries = await db
    .select({ id: je.id, date: je.date, description: je.description, sourceType: je.sourceType, sourceId: je.sourceId })
    .from(je)
    .where(or(unaccentIlike(je.description, pattern), inArray(je.id, lineMatches), ...(queryDate !== null ? [eq(je.date, queryDate)] : [])))
    .orderBy(desc(je.date), desc(je.createdAt))
    .limit(limit + 1);

  const top = entries.slice(0, limit);
  const lines = top.length
    ? await db
        .select()
        .from(jl)
        .where(
          inArray(
            jl.entryId,
            top.map((e) => e.id),
          ),
        )
    : [];

  return {
    hits: top.map((e) => {
      const entryLines = lines.filter((l) => l.entryId === e.id);
      const debitTotal = entryLines.reduce((sum, l) => sum + l.debit, 0);
      const acctList = [...new Set(entryLines.map((l) => l.account))].slice(0, 3).join(" / ");
      return { ...e, amount: debitTotal, accounts: acctList };
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
  art: string;
  date: string;
  description: string;
  amount: number;
}

/** Pauschalen für die Befehlspalette (#617): Anlass/Text, Art, Datum, Betrag */
export async function searchPauschalen(query: string, limit = 5): Promise<{ hits: PauschaleHit[]; more: boolean }> {
  const p = schema.pauschalen;
  const pattern = likePattern(query);
  const cents = parseEuroSearchCents(query);
  const queryDate = parseDateSearch(query);
  const rows = await db
    .select({ id: p.id, art: p.art, date: p.date, description: p.description, amount: p.amount })
    .from(p)
    .where(
      or(
        unaccentIlike(p.description, pattern),
        unaccentIlike(sql`${p.art}::text`, pattern),
        ...(cents !== null ? [eq(p.amount, cents), eq(p.amount, -cents)] : []),
        ...(queryDate !== null ? [eq(p.date, queryDate)] : []),
      ),
    )
    .orderBy(numberRank(p.description, query), desc(p.date))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
