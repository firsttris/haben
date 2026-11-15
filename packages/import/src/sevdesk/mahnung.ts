import { lexDate, lexToCents } from "../lexoffice/map.ts";
import { sevNumber } from "./map.ts";
import type { SevInvoice } from "./types.ts";

/*
 * Mahnungen aus sevDesk (Invoice mit invoiceType MA). Jede Stufe ist ein eigenes Objekt und verweist mit origin auf die
 * gemahnte Rechnung; die Summen im Kopf sind 0, der gemahnte Betrag steht in reminderTotal, Positionen gibt es keine
 * (Testdaten in test-fixtures/sevdesk, Buchhaltungsversion 1.0 und 2.0). Eine Mahnung ist kein Umsatz: Sie wird nur
 * archiviert und nie zu einem Archivbeleg in lexoffice_vouchers.
 *
 * Die Felder stehen nicht im Schema der Rechnung (types.ts): Eine unerwartete Form darf den Abruf der Rechnungen nicht
 * scheitern lassen. Sie werden hier gelesen; was fehlt oder unlesbar ist, bleibt leer.
 */

export interface SevMappedDunning {
  /** "invoice/<id>": sevDesk zählt Mahnungen wie Rechnungen */
  externalId: string;
  /** "invoice/<id>" der gemahnten Rechnung, wie lexoffice_vouchers.lexoffice_id; null ohne Verweis auf eine Rechnung */
  invoiceExternalId: string | null;
  /** sevDesk-Stufe ab 1 (Zahlungserinnerung); null, wenn sie fehlt oder unlesbar ist */
  level: number | null;
  number: string;
  date: string;
  /** Frist der Mahnung (reminderDeadline) */
  dueDate: string | null;
  sentDate: string | null;
  status: string;
  contactSevdeskId: string | null;
  contactName: string;
  currency: string;
  /** Gemahnter Betrag in Cent (reminderTotal); null, wenn er fehlt */
  total: number | null;
}

type Loose = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function refOf(value: unknown): { id: string; objectName: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text((value as Loose).id);
  if (!id) return null;
  return { id, objectName: text((value as Loose).objectName) };
}

/** Mahnung, die sevDesk gespeichert hat; vor dem Speichern hat sie Status 100 (Entwurf) wie eine Rechnung. */
export function isSevDunning(i: SevInvoice): boolean {
  return (i.invoiceType ?? "").toUpperCase() === "MA" && sevNumber(i.status) > 100;
}

export function mapSevDunning(i: SevInvoice): SevMappedDunning {
  const raw = i as Loose;
  const id = String(i.id);
  const date = lexDate(i.invoiceDate) ?? lexDate(i.create);
  if (!date) throw new Error(`sevDesk-Mahnung ${id} hat kein Datum`);
  const origin = refOf(raw.origin);
  const level = sevNumber(text(raw.dunningLevel));
  const totalText = text(raw.reminderTotal);
  return {
    externalId: `invoice/${id}`,
    // origin einer Mahnung zeigt auf die Rechnung, nicht auf die vorige Stufe; ohne objectName nicht raten
    invoiceExternalId: origin && origin.objectName === "Invoice" ? `invoice/${origin.id}` : null,
    level: Number.isInteger(level) && level >= 1 ? level : null,
    number: i.invoiceNumber?.trim() ?? "",
    date,
    dueDate: lexDate(text(raw.reminderDeadline)),
    sentDate: lexDate(text(raw.sendDate)),
    status: String(i.status ?? ""),
    contactSevdeskId: refOf(i.contact)?.id ?? null,
    contactName: (i.address ?? "").split(/\r?\n/)[0]!.trim(),
    currency: i.currency?.trim() || "EUR",
    total: totalText == null || totalText.trim() === "" ? null : lexToCents(sevNumber(totalText)),
  };
}
