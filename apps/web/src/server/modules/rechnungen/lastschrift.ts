import type { PaymentMethod } from "@haben/core";
import type { DirectDebit } from "@haben/einvoice";
import type { Db, Tx } from "../../db/index.ts";
import { type Company, findMandate, type Mandate } from "../stammdaten/index.ts";

/**
 * Zahlungsart „Lastschrift“ an der Rechnung (#445): Prüfung des Mandats und die Angaben für PDF und E-Rechnung.
 * Eingezogen wird am Fälligkeitstag der Rechnung; die Rechnung selbst ist die Vorabankündigung mit Betrag und Tag
 * (SDD Core Rulebook v1.2, PT-04.02; Clarification Paper EPC132-17 v5.1, Kap. 2.6).
 */

type InvoicePayment = {
  kind: string;
  contactId: string | null;
  currency: string;
  dueDate: string;
  skonto: unknown[];
  paymentMethod: PaymentMethod;
  sepaMandateId: string | null;
};

/** 2026-11-16 → 16.11.2026 */
const germanDate = (day: string) => day.split("-").reverse().join(".");

const STATUS_TEXT = { abgelaufen: "abgelaufen", widerrufen: "widerrufen", "noch-nicht": "noch nicht unterschrieben" } as const;

/** Spalten für Zahlungsart und Mandat eines Entwurfs; Storno und Korrektur werden nie eingezogen */
export function paymentColumns(input: { paymentMethod?: PaymentMethod | undefined; sepaMandateId?: string | null | undefined }, kind = "rechnung") {
  const lastschrift = kind === "rechnung" && input.paymentMethod === "lastschrift";
  return {
    paymentMethod: lastschrift ? ("lastschrift" as const) : ("ueberweisung" as const),
    sepaMandateId: lastschrift ? (input.sepaMandateId ?? null) : null,
  };
}

/** Was gegen Zahlungsart und Mandat eines Entwurfs spricht, oder null: Lastschrift braucht ein Mandat des Kunden */
export async function draftMandateProblem(tx: Tx, columns: ReturnType<typeof paymentColumns>, contactId: string | null, day: string): Promise<string | null> {
  if (columns.paymentMethod !== "lastschrift") return null;
  if (!columns.sepaMandateId) return "Für die Lastschrift fehlt das Mandat.";
  const mandate = await findMandate(columns.sepaMandateId, day, tx);
  if (!mandate) return "Mandat nicht gefunden.";
  return mandate.contactId === contactId ? null : "Das Mandat gehört zu einem anderen Kunden.";
}

/** Was gegen den Einzug spricht; leer bei Überweisung */
export async function directDebitIssues(invoice: InvoicePayment, company: Pick<Company, "glaeubigerId">, q: Db | Tx): Promise<string[]> {
  if (invoice.paymentMethod !== "lastschrift" || !invoice.sepaMandateId) return [];
  const issues: string[] = [];
  if (!company.glaeubigerId) issues.push("Firmendaten: Gläubiger-ID fehlt; sie gehört auf jede Rechnung mit Lastschrift");
  if (invoice.currency !== "EUR") issues.push("Lastschrift gibt es nur in Euro");
  if (invoice.skonto.length > 0) issues.push("Skonto und Lastschrift gehen nicht zusammen: eingezogen wird der volle Betrag");
  const mandate = await findMandate(invoice.sepaMandateId, invoice.dueDate, q);
  if (!mandate) return [...issues, "Das Mandat der Lastschrift fehlt"];
  if (mandate.contactId !== invoice.contactId) issues.push(`Mandat ${mandate.reference} gehört zu einem anderen Kunden`);
  if (mandate.status.art !== "gueltig") {
    issues.push(`Mandat ${mandate.reference} ist am Einzugstag ${germanDate(invoice.dueDate)} ${STATUS_TEXT[mandate.status.art]}`);
  }
  return issues;
}

/** Angaben zum Einzug für PDF und XML; undefined bei Überweisung oder ohne Mandat */
export async function directDebitFor(invoice: InvoicePayment, company: Pick<Company, "glaeubigerId">, q: Db | Tx): Promise<DirectDebit | undefined> {
  if (invoice.paymentMethod !== "lastschrift" || !invoice.sepaMandateId) return undefined;
  const mandate = await findMandate(invoice.sepaMandateId, invoice.dueDate, q);
  return mandate ? directDebitOf(mandate, company.glaeubigerId, invoice.dueDate) : undefined;
}

function directDebitOf(mandate: Mandate, creditorId: string, collectionDate: string): DirectDebit {
  return { mandateReference: mandate.reference, creditorId, debtorIban: mandate.debtorIban, collectionDate };
}
