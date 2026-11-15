import { ACCOUNTS, type Kontenrahmen, PAUSCHALE_LABEL, type PauschaleArt, parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { type SQL, and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
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

/** Konten der selbst geschuldeten Umsatzsteuer und der Vorsteuer daraus (§ 13b UStG, § 1a UStG) */
function selfAssessedTaxAccounts(frame: Kontenrahmen): SQL {
  const a = ACCOUNTS[frame];
  const accounts = [a.ustRc, a.vorsteuerRc, ...Object.values(a.ustIge), ...Object.values(a.vorsteuerIge)];
  return sql`array[${sql.join(
    accounts.map((account) => sql`${account}`),
    sql`, `,
  )}]::text[]`;
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

const je = schema.journalEntries;
const bookingFields = { id: je.id, date: je.date, description: je.description, sourceType: je.sourceType, sourceId: je.sourceId };

/** Konten aus dem Kontenrahmen samt eigenen Konten, deren Nummer oder Name die Eingabe enthält */
function accountsMatching(query: string, frame: Kontenrahmen) {
  const needle = normalizeForMatch(query.trim());
  return {
    needle,
    matches: Object.entries(knownAccounts(frame)).filter(([nr, name]) => nr.toLowerCase().includes(needle) || normalizeForMatch(name).includes(needle)),
  };
}

/** Abfrage der Buchungen zur Schnellsuche; `refreshOwnAccountNames` muss vorher gelaufen sein */
function bookingEntriesSelect(query: string, limit: number, frame: Kontenrahmen, fields = bookingFields) {
  const matchingAccounts = accountsMatching(query, frame)
    .matches.map(([nr]) => nr)
    .slice(0, 50);

  const jl = schema.journalLines;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  // Soll und Haben stehen ohne Vorzeichen; 0 steht in jeder Zeile auf der leeren Seite und fände jede Buchung
  const lineRange =
    range === null ? null : { min: Math.max(1, Math.min(Math.abs(range.min), Math.abs(range.max))), max: Math.max(Math.abs(range.min), Math.abs(range.max)) };
  const queryDate = parseDateSearch(query);

  // Selbst geschuldete Steuer (§ 13b, innergemeinschaftlicher Erwerb) steht auf beiden Seiten neben dem Zahlbetrag und zählt nicht mit
  const sideTotal = (side: SQL) =>
    sql`(select sum(${side}) from journal_lines x where x.entry_id = ${jl}.entry_id and x.account <> all(case
      (select e.kontenrahmen from journal_entries e where e.id = ${jl}.entry_id) when 'SKR04' then ${selfAssessedTaxAccounts("SKR04")}
      else ${selfAssessedTaxAccounts("SKR03")} end))`;

  // Konten aus dem Kontenrahmen nach Nummer oder Name, eine unbekannte Nummer (etwa ein Personenkonto) genau
  const accounts = /^\d{4,9}$/.test(query.trim()) ? [...new Set([...matchingAccounts, query.trim()])] : matchingAccounts;
  // Je Bedingung ein eigener Teil der `union`: In einem `or` schätzte Postgres die Seitensumme für jede Zeile des Kontos
  // mit, käme über die Grenze für JIT (jit_above_cost) und bräuchte zum Übersetzen länger als für die Abfrage.
  const lineMatches = [
    ...(accounts.length > 0 ? [inArray(jl.account, accounts)] : []),
    // Nur die Bruttozeile (#1038): ihr Betrag ist die Summe ihrer Seite, Netto- und Steuerzeilen sind kleiner
    ...(lineRange !== null && lineRange.max > 0
      ? [
          and(amountIn(jl.debit, lineRange), sql`${jl.debit} = ${sideTotal(sql`x.debit`)}`),
          and(amountIn(jl.credit, lineRange), sql`${jl.credit} = ${sideTotal(sql`x.credit`)}`),
        ]
      : []),
  ].map((condition) => db.select({ id: jl.entryId }).from(jl).where(condition));
  // Ein `id in (Unterabfrage)` im `or` ließe Postgres alle Buchungen lesen; als `union` nutzt jeder Teil seinen Index.
  const textMatches = db
    .select({ id: je.id })
    .from(je)
    .where(or(unaccentIlike(je.description, pattern), ...(queryDate !== null ? [eq(je.date, queryDate)] : [])));
  const matches = sql.join([textMatches, ...lineMatches], sql` union `);

  return db
    .select(fields)
    .from(je)
    .where(sql`${je.id} in (${matches})`)
    .orderBy(desc(je.date), desc(je.createdAt))
    .limit(limit + 1);
}

/**
 * Abfrage der Buchungen zur Schnellsuche, noch nicht ausgeführt; eigene Funktion, damit ein Test ihren Plan prüft.
 * In ein Objekt verpackt, weil ein `await` die Abfrage sonst gleich ausführen würde.
 */
export async function bookingEntriesQuery(query: string, limit: number) {
  await refreshOwnAccountNames();
  return { select: bookingEntriesSelect(query, limit, await companyKontenrahmen()) };
}

/** Buchungen für die Befehlspalette (#617): Buchungstext, Konto, Betrag und Datum; auch für Steuerberatung */
function bookingsPart(query: string, limit: number, frame: Kontenrahmen) {
  const jl = schema.journalLines;
  return searchPart(
    bookingFields,
    (fields) => bookingEntriesSelect(query, limit, frame, fields),
    async (entries): Promise<{ hits: BookingHit[]; more: boolean }> => {
      const top = entries.slice(0, limit);
      const ids = top.map((e) => e.id);
      const [lines, reversals] = top.length
        ? await Promise.all([
            db.select().from(jl).where(inArray(jl.entryId, ids)),
            db.select({ id: je.reversesId }).from(je).where(inArray(je.reversesId, ids)),
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
    },
  );
}

export interface AccountHit {
  account: string;
  name: string;
  kontenrahmen: "SKR03" | "SKR04";
}

/** Sachkonten (SKR03/04 und eigene Konten) für die Befehlspalette (#617); auch für Steuerberatung, ohne eigene Abfrage */
function accountsFor(query: string, frame: Kontenrahmen, limit: number): { hits: AccountHit[]; more: boolean } {
  const { needle, matches } = accountsMatching(query, frame);
  const rank = (nr: string) => (nr.toLowerCase() === needle ? 0 : nr.toLowerCase().startsWith(needle) ? 1 : 2);
  const sorted = matches.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  return {
    hits: sorted.slice(0, limit).map(([account, name]) => ({ account, name, kontenrahmen: frame })),
    more: sorted.length > limit,
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
function assetsPart(query: string, limit: number) {
  const a = schema.assets;
  const pattern = likePattern(query);
  return searchPart(
    { id: a.id, name: a.name, account: a.account, acquisitionDate: a.acquisitionDate, cost: a.cost },
    (fields) =>
      db
        .select(fields)
        .from(a)
        .where(or(unaccentIlike(a.name, pattern), unaccentIlike(a.account, pattern), unaccentIlike(a.note, pattern)))
        .orderBy(asc(a.name))
        .limit(limit + 1),
    (rows): { hits: AssetHit[]; more: boolean } => firstHits(rows, limit),
  );
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
function pauschalenPart(query: string, limit: number) {
  const p = schema.pauschalen;
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);
  // Die Art über ihre Bezeichnung, die der Treffer zeigt, nicht über den gespeicherten Schlüssel
  const needle = normalizeForMatch(query.trim());
  const arten = (Object.entries(PAUSCHALE_LABEL) as [PauschaleArt, string][])
    .filter(([, label]) => normalizeForMatch(label).includes(needle))
    .map(([art]) => art);
  return searchPart(
    {
      id: p.id,
      art: p.art,
      date: p.date,
      description: p.description,
      amount: p.amount,
      storniert: sql<boolean>`exists(select 1 from pauschalen r where r.reverses_id = ${p}.id)`,
    },
    (fields) =>
      db
        .select(fields)
        .from(p)
        .where(
          and(
            isNull(p.reversesId),
            or(
              unaccentIlike(p.description, pattern),
              ...(arten.length > 0 ? [inArray(p.art, arten)] : []),
              ...(range !== null ? [amountIn(p.amount, range)] : []),
              ...(queryDate !== null ? [eq(p.date, queryDate)] : []),
            ),
          ),
        )
        .orderBy(numberRank(p.description, query), desc(p.date))
        .limit(limit + 1),
    (rows): { hits: PauschaleHit[]; more: boolean } => firstHits(rows, limit),
  );
}

/**
 * Buchungen, Sachkonten, Anlagen und Pauschalen für die Befehlspalette in einer Abfrage, nur die gefragten Gruppen.
 * Die Sachkonten kommen aus dem Kontenrahmen und den eigenen Konten, die vorher einmal gelesen werden.
 */
export async function searchBuchhaltung(query: string, groups: readonly string[], limit = 5) {
  const frame =
    groups.includes("bookings") || groups.includes("accounts") ? (await Promise.all([refreshOwnAccountNames(), companyKontenrahmen()]))[1] : ("SKR03" as const);
  const found = await runSearchParts(
    partsFor(groups, {
      bookings: () => bookingsPart(query, limit, frame),
      assets: () => assetsPart(query, limit),
      pauschalen: () => pauschalenPart(query, limit),
    }),
  );
  return { ...found, ...(groups.includes("accounts") ? { accounts: accountsFor(query, frame, limit) } : {}) };
}
