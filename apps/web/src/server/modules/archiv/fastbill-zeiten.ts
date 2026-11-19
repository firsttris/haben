import { billableAmount } from "@haben/core";
import { type FbMappedTime, type FbProject, isFbTimeBilled, mapFbTime } from "@haben/import";
import { inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { billedExternalIds, upsertExternalServiceEntry } from "../leistungen/index.ts";
import { progressMessage } from "./lexoffice.ts";
import { withFastbillRequest } from "./fastbill-anfrage.ts";

/*
 * Offene Zeiten aus FastBill als Zeiteinträge (#1522, docs/fastbill.md#offene-zeiten): Die Vorschau holt Zeiten und
 * Projekte und zeigt je Kunde Anzahl, Dauer und Summe, dazu was nicht geht. Übernehmen holt sie noch einmal und legt die
 * Einträge über upsertExternalServiceEntry an (Quelle fastbill, Kennung TIME_ID): Ein zweiter Lauf aktualisiert offene
 * Einträge statt sie zu verdoppeln, abgerechnete in Haben bleiben, wie sie sind. Abgerechnete Zeiten aus FastBill
 * (mit INVOICE_ID) bleiben draußen, sie stecken in den archivierten Rechnungen.
 */

const SOURCE = "fastbill";

interface Customer {
  id: string;
  name: string;
  rate: number | null;
  usable: string | null;
}

export interface FastbillTimesPlan {
  /** Abgerechnete Zeiten in FastBill, nicht übernommen */
  billed: number;
  /** Schon übernommen und in Haben abgerechnet; ein erneuter Abruf ändert sie nicht */
  billedInHaben: number;
  customers: { name: string; entries: number; minutes: number; amountCents: number }[];
  problems: { timeId: string; customer: string; reason: string }[];
  ready: number;
}

/** Kontakte mit FastBill-Kennung; usable nennt, warum keine Zeiten an ihn gehen */
async function customersByFastbillId(ids: string[]): Promise<Map<string, Customer>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.contacts.id,
      fastbillId: schema.contacts.fastbillId,
      name: schema.contacts.name,
      rate: schema.contacts.hourlyRateCents,
      isCustomer: schema.contacts.isCustomer,
      archivedAt: schema.contacts.archivedAt,
    })
    .from(schema.contacts)
    .where(inArray(schema.contacts.fastbillId, ids));
  return new Map(
    rows.map((r) => [
      r.fastbillId!,
      { id: r.id, name: r.name, rate: r.rate, usable: r.archivedAt ? "Der Kunde ist archiviert." : r.isCustomer ? null : "Der Kontakt ist kein Kunde." },
    ]),
  );
}

async function load(): Promise<{
  billed: number;
  billedInHaben: number;
  ok: FbMappedTime[];
  problems: FastbillTimesPlan["problems"];
  customers: Map<string, Customer>;
}> {
  const { times, projects } = await withFastbillRequest("Zeiten", async (client) => {
    const projectList = new Map<string, FbProject>();
    for await (const p of client.projects()) projectList.set(String(p.PROJECT_ID), p);
    const timeList = [];
    for await (const t of client.times()) timeList.push(t);
    return { times: timeList, projects: projectList };
  });
  const open = times.filter((t) => !isFbTimeBilled(t));
  const mapped = open.map((t) => mapFbTime(t, projects));
  const customers = await customersByFastbillId([...new Set(mapped.flatMap((m) => (m.ok ? m.time.customerId : m.customerId) ?? []))]);
  const inHaben = await billedExternalIds(
    SOURCE,
    mapped.flatMap((m) => (m.ok ? [m.time.timeId] : [])),
  );
  const ok: FbMappedTime[] = [];
  const problems: FastbillTimesPlan["problems"] = [];
  for (const m of mapped.filter((x) => !(x.ok && inHaben.has(x.time.timeId)))) {
    const id = m.ok ? m.time.customerId : m.customerId;
    const customer = id ? customers.get(id) : undefined;
    const label = customer?.name ?? (id ? `Kunde ${id}` : "ohne Kunde");
    if (!m.ok) problems.push({ timeId: m.timeId, customer: label, reason: m.reason });
    else if (!id) problems.push({ timeId: m.time.timeId, customer: label, reason: "Die Zeit nennt keinen Kunden, auch nicht über ihr Projekt." });
    else if (!customer) problems.push({ timeId: m.time.timeId, customer: label, reason: "Der Kunde ist in Haben nicht da. Zuerst „Alles abrufen“." });
    else if (customer.usable) problems.push({ timeId: m.time.timeId, customer: label, reason: customer.usable });
    else ok.push(m.time);
  }
  return { billed: times.length - open.length, billedInHaben: inHaben.size, ok, problems, customers };
}

export async function previewFastbillTimes(): Promise<FastbillTimesPlan> {
  const { billed, billedInHaben, ok, problems, customers } = await load();
  const sums = new Map<string, FastbillTimesPlan["customers"][number]>();
  for (const t of ok) {
    const customer = customers.get(t.customerId!)!;
    const row = sums.get(customer.id) ?? { name: customer.name, entries: 0, minutes: 0, amountCents: 0 };
    row.entries += 1;
    row.minutes += t.minutes;
    row.amountCents += billableAmount({ ...t, hourlyRateCents: t.hourlyRateCents ?? customer.rate });
    sums.set(customer.id, row);
  }
  return { billed, billedInHaben, customers: [...sums.values()].sort((a, b) => a.name.localeCompare(b.name, "de")), problems, ready: ok.length };
}

export async function importFastbillTimes(actor: string): Promise<{ created: number; updated: number; failed: FastbillTimesPlan["problems"] }> {
  const { ok, problems, customers } = await load();
  const result = { created: 0, updated: 0, failed: [...problems] };
  for (const t of ok) {
    const customer = customers.get(t.customerId!)!;
    try {
      const { created } = await upsertExternalServiceEntry(actor, {
        source: SOURCE,
        externalId: t.timeId,
        contactId: customer.id,
        workedOn: t.workedOn,
        minutes: t.minutes,
        description: t.description,
        hourlyRateCents: t.hourlyRateCents,
        nonBillable: t.nonBillable,
        billableMinutes: t.billableMinutes,
        project: t.project,
      });
      if (created) result.created += 1;
      else result.updated += 1;
    } catch (error) {
      result.failed.push({ timeId: t.timeId, customer: customer.name, reason: progressMessage(error) });
    }
  }
  return result;
}
