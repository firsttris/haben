import { dueDate } from "@haben/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { dauerfristFor } from "./dauerfrist.ts";

function parsePeriodQuery(raw: string): { year: number; month?: number } | null {
  const q = raw.trim();
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(q);
  if (slash) {
    const month = Number(slash[1]);
    const year = Number(slash[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const iso = /^(\d{4})-(\d{2})$/.exec(q);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const quarter = /^Q([1-4])\s*\/?\s*(\d{4})$/i.exec(q);
  if (quarter) return { year: Number(quarter[2]), month: 40 + Number(quarter[1]) };
  const yearOnly = /^(\d{4})$/.exec(q);
  if (yearOnly) return { year: Number(yearOnly[1]) };
  return null;
}

export interface VatReturnHit {
  id: string;
  year: number;
  month: number;
  status: (typeof schema.vatReturns.$inferSelect)["status"];
  sentAt: Date | null;
  berichtigt: boolean;
  /** Abgabe außerhalb von Haben vermerkt (vermerk.ts) */
  filedOn: string | null;
  /** Frist wie auf der Seite der Voranmeldung, mit Dauerfristverlängerung */
  dueDate: string;
}

type Period = { year: number; month?: number };

/**
 * Umsatzsteuer-Voranmeldungen für die Befehlspalette (#617): Zeitraum („03/2026“, „Q1 2026“, „2026“), je Zeitraum einmal
 * mit dem Stand, den die Seite zeigt: der Entwurf (Berichtigung in Arbeit), sonst die letzte.
 */
function vatReturnsPart(period: Period, limit: number) {
  const vr = schema.vatReturns;
  return searchPart(
    { id: vr.id, year: vr.year, month: vr.month, status: vr.status, sentAt: vr.sentAt, berichtigt: vr.berichtigt },
    (fields) =>
      db
        .selectDistinctOn([vr.year, vr.month], fields)
        .from(vr)
        .where(period.month ? and(eq(vr.year, period.year), eq(vr.month, period.month)) : eq(vr.year, period.year))
        .orderBy(desc(vr.year), desc(vr.month), sql`${vr.status} = 'draft' desc`, desc(vr.createdAt))
        .limit(limit + 1),
    async (rows): Promise<{ hits: VatReturnHit[]; more: boolean }> => {
      const hits = rows.slice(0, limit);
      if (hits.length === 0) return { hits: [], more: false };
      const f = schema.vatReturnFilings;
      const [company, filings] = await Promise.all([
        loadCompany(),
        db
          .select({ vatReturnId: f.vatReturnId, filedOn: f.filedOn })
          .from(f)
          .where(
            inArray(
              f.vatReturnId,
              hits.map((h) => h.id),
            ),
          ),
      ]);
      const dauerfrist = new Map(await Promise.all([...new Set(hits.map((h) => h.year))].map(async (year) => [year, await dauerfristFor(year)] as const)));
      return {
        hits: hits.map((h) => ({
          ...h,
          filedOn: filings.find((x) => x.vatReturnId === h.id)?.filedOn ?? null,
          dueDate: dueDate({ year: h.year, month: h.month }, company.bundesland, dauerfrist.get(h.year) ?? false),
        })),
        more: rows.length > limit,
      };
    },
  );
}

export interface ZmSubmissionHit {
  id: string;
  year: number;
  month: number;
  kind: (typeof schema.zmSubmissions.$inferSelect)["kind"];
  ok: boolean;
  code: number;
  createdAt: Date;
}

/**
 * Zusammenfassende Meldungen für die Befehlspalette (#617): Zeitraum, je Zeitraum einmal (Entscheidung zu #1038) mit dem
 * maßgeblichen Stand: die letzte erfolgreiche Übermittlung, sonst der letzte Versuch.
 */
function zmSubmissionsPart(period: Period, limit: number) {
  const zm = schema.zmSubmissions;
  return searchPart(
    { id: zm.id, year: zm.year, month: zm.month, kind: zm.kind, ok: zm.ok, code: zm.code, createdAt: zm.createdAt },
    (fields) =>
      db
        .selectDistinctOn([zm.year, zm.month], fields)
        .from(zm)
        .where(period.month ? and(eq(zm.year, period.year), eq(zm.month, period.month)) : eq(zm.year, period.year))
        .orderBy(desc(zm.year), desc(zm.month), sql`(${zm.kind} = 'send' and ${zm.ok}) desc`, desc(zm.createdAt))
        .limit(limit + 1),
    (rows): { hits: ZmSubmissionHit[]; more: boolean } => firstHits(rows, limit),
  );
}

/** Voranmeldungen und ZM für die Befehlspalette in einer Abfrage; nur wenn die Eingabe ein Zeitraum ist */
export async function searchUmsatzsteuer(query: string, groups: readonly string[], limit = 5) {
  const period = parsePeriodQuery(query);
  if (!period) return {};
  return runSearchParts(
    partsFor(groups, {
      vatReturns: () => vatReturnsPart(period, limit),
      zmSubmissions: () => zmSubmissionsPart(period, limit),
    }),
  );
}
