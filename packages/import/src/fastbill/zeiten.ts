import type { Cents } from "@haben/core";
import { fbCents, fbNumber } from "./map.ts";
import type { FbProject, FbTime } from "./types.ts";

/*
 * Offene Zeiten aus FastBill (time.get, project.get) als Zeiteinträge von Haben (#1522). Übernommen werden nur Zeiten
 * ohne Rechnung; abgerechnete stecken schon in den archivierten Rechnungen. Projekte gibt es in Haben nicht, ihr Name
 * kommt als Text an den Eintrag, ihr Stundensatz als Satz des Eintrags.
 */

export interface FbMappedTime {
  /** TIME_ID, Kennung des Eintrags (externalId) */
  timeId: string;
  customerId: string | null;
  workedOn: string;
  minutes: number;
  /** null = wie die erfasste Dauer */
  billableMinutes: number | null;
  nonBillable: boolean;
  description: string;
  project: string;
  /** Satz des Projekts netto in Cent; undefined = der des Kunden in Haben */
  hourlyRateCents: Cents | undefined;
}

export type FbTimeMapped = { ok: true; time: FbMappedTime } | { ok: false; timeId: string; customerId: string | null; reason: string };

const text = (value: unknown) => (value == null ? "" : String(value).trim());
/** Ein Tag, den es gibt (wie isRealDate bei den Zeiteinträgen): sonst lehnte Haben die Zeit erst beim Anlegen ab */
const isRealDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 1900;
};
const idOrNull = (value: unknown) => (text(value) && text(value) !== "0" ? text(value) : null);

/** Abgerechnet, wenn FastBill eine Rechnung nennt; bei offenen Zeiten fehlt INVOICE_ID */
export const isFbTimeBilled = (t: FbTime) => idOrNull(t.INVOICE_ID) !== null;

export function mapFbTime(t: FbTime, projects: ReadonlyMap<string, FbProject>): FbTimeMapped {
  const timeId = text(t.TIME_ID);
  const project = projects.get(text(t.PROJECT_ID));
  const customerId = idOrNull(t.CUSTOMER_ID) ?? idOrNull(project?.CUSTOMER_ID);
  const fail = (reason: string): FbTimeMapped => ({ ok: false, timeId, customerId, reason });
  const workedOn = text(t.DATE).slice(0, 10);
  if (!isRealDate(workedOn)) return fail("Kein Datum.");
  const minutes = Math.round(fbNumber(t.MINUTES));
  if (minutes < 1) return fail("Keine Dauer.");
  if (minutes > 24 * 60) return fail(`Dauer ${minutes} Minuten, Haben nimmt höchstens 24 Stunden je Eintrag.`);
  const billable = t.BILLABLE_MINUTES == null || text(t.BILLABLE_MINUTES) === "" ? minutes : Math.round(fbNumber(t.BILLABLE_MINUTES));
  if (billable > 24 * 60) return fail(`Abrechenbare Dauer ${billable} Minuten, Haben nimmt höchstens 24 Stunden je Eintrag.`);
  if (billable < 0) return fail("Abrechenbare Dauer negativ.");
  const currency = text(project?.CURRENCY_CODE).toUpperCase() || "EUR";
  if (currency !== "EUR") return fail(`Projekt in ${currency}: Haben rechnet Zeiten nur in Euro ab.`);
  const rate = fbNumber(project?.HOUR_PRICE);
  return {
    ok: true,
    time: {
      timeId,
      customerId,
      workedOn,
      minutes,
      // 0 heißt in FastBill nicht abrechenbar; Haben kennt dafür „nicht abrechenbar“ statt einer Dauer 0
      billableMinutes: billable === minutes || billable === 0 ? null : billable,
      nonBillable: billable === 0,
      description: text(t.COMMENT).slice(0, 2000),
      project: text(project?.PROJECT_NAME).slice(0, 200),
      hourlyRateCents: rate > 0 ? fbCents(project?.HOUR_PRICE) : undefined,
    },
  };
}
