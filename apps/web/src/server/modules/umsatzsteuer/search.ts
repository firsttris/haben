import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

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

export function formatPeriodLabel(year: number, month: number): string {
  if (month >= 41 && month <= 44) return `Q${month - 40} ${year}`;
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function formatPeriodParam(year: number, month: number): string {
  if (month >= 41 && month <= 44) return `${year}-Q${month - 40}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export interface VatReturnHit {
  id: string;
  year: number;
  month: number;
  status: string;
  sentAt: Date | null;
}

/** Umsatzsteuer-Voranmeldungen für die Befehlspalette (#617): Zeitraum („03/2026“, „Q1 2026“, „2026“) */
export async function searchVatReturns(query: string, limit = 5): Promise<{ hits: VatReturnHit[]; more: boolean }> {
  const period = parsePeriodQuery(query);
  if (!period) return { hits: [], more: false };
  const vr = schema.vatReturns;
  const rows = await db
    .select({ id: vr.id, year: vr.year, month: vr.month, status: vr.status, sentAt: vr.sentAt })
    .from(vr)
    .where(period.month ? and(eq(vr.year, period.year), eq(vr.month, period.month)) : eq(vr.year, period.year))
    .orderBy(desc(vr.year), desc(vr.month), desc(vr.createdAt))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

export interface ZmSubmissionHit {
  id: string;
  year: number;
  month: number;
  kind: string;
  ok: boolean;
  createdAt: Date;
}

/** Zusammenfassende Meldungen für die Befehlspalette (#617): Zeitraum */
export async function searchZmSubmissions(query: string, limit = 5): Promise<{ hits: ZmSubmissionHit[]; more: boolean }> {
  const period = parsePeriodQuery(query);
  if (!period) return { hits: [], more: false };
  const zm = schema.zmSubmissions;
  const rows = await db
    .select({ id: zm.id, year: zm.year, month: zm.month, kind: zm.kind, ok: zm.ok, createdAt: zm.createdAt })
    .from(zm)
    .where(period.month ? and(eq(zm.year, period.year), eq(zm.month, period.month)) : eq(zm.year, period.year))
    .orderBy(desc(zm.year), desc(zm.month), desc(zm.createdAt))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}
