import { DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, formatDocumentNumber } from "@haben/core";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { InvoiceError } from "./invoice-error.ts";
import { circleFor, countsRunning, lastNumber, setNextNumber as setNextCounter, type NumberKind } from "./number-counter.ts";

/* Nummernkreise von Rechnung und Angebot: nächste Nummer anzeigen und setzen; beim Zähler je Kunde (#1426) je Art ein eigener Kreis pro Kunde */

const NUMBER_FORMAT = { rechnung: "invoiceNumberFormat", angebot: "quoteNumberFormat" } as const;

/** Der Kreis eines Kunden gibt es nur, solange der Zähler der Art je Kunde kreist (#1426) */
function assertContactCircle(company: Pick<Company, "invoiceCounterPerCustomer" | "quoteCounterPerCustomer">, kind: NumberKind, contactId: string | null) {
  if (contactId !== null && !(kind === "rechnung" ? company.invoiceCounterPerCustomer : company.quoteCounterPerCustomer)) {
    throw new InvoiceError(`Der Zähler je Kunde ist für ${kind === "rechnung" ? "Rechnungen" : "Angebote"} nicht eingeschaltet.`);
  }
}

/**
 * Nächste Nummer eines Kreises für ein Datum (heute), z. B. um nach Lexoffice oder sevDesk nahtlos weiterzuzählen.
 * Mit durchlaufendem Zähler ist es der eine Kreis 0, sonst das Jahr (#328); mit `contactId` der Kreis dieses Kunden
 * beim Zähler je Kunde (#1426).
 */
export async function numbering(date: string, kind: NumberKind = "rechnung", contactId: string | null = null) {
  const company = await loadCompany();
  assertContactCircle(company, kind, contactId);
  const { running, circle, last } = await db.transaction(async (tx) => {
    const running = await countsRunning(tx, kind);
    const circle = running ? 0 : Number(date.slice(0, 4));
    return { running, circle, last: await lastNumber(tx, kind, circle, contactId) };
  });
  const [contact] = contactId
    ? await db.select({ kundennummer: schema.contacts.kundennummer }).from(schema.contacts).where(eq(schema.contacts.id, contactId))
    : [];
  return {
    kind,
    date,
    year: Number(date.slice(0, 4)),
    running,
    circle,
    last,
    next: formatDocumentNumber(company[NUMBER_FORMAT[kind]], date, last + 1, contact?.kundennummer ?? undefined),
  };
}

export async function setNextNumber(actor: string, date: string, next: number, kind: NumberKind = "rechnung", contactId: string | null = null) {
  const result = await withActor(actor, async (tx) => {
    // Nur lesen: loadCompany legte die Firmenzeile an, wenn sie fehlt, und das gehört nicht in eine Fehlermeldung
    const [company] = await tx
      .select({
        invoice: schema.company.invoiceNumberFormat,
        quote: schema.company.quoteNumberFormat,
        invoiceCounterPerCustomer: schema.company.invoiceCounterPerCustomer,
        quoteCounterPerCustomer: schema.company.quoteCounterPerCustomer,
      })
      .from(schema.company);
    assertContactCircle(company ?? { invoiceCounterPerCustomer: false, quoteCounterPerCustomer: false }, kind, contactId);
    const [contact] = contactId
      ? await tx.select({ kundennummer: schema.contacts.kundennummer }).from(schema.contacts).where(eq(schema.contacts.id, contactId))
      : [];
    if (contactId !== null && !contact) throw new InvoiceError("Kontakt nicht gefunden.");
    const set = await setNextCounter(tx, kind, await circleFor(tx, kind, date), next, contactId);
    if (set.ok) return set;
    const fallback = kind === "rechnung" ? DEFAULT_INVOICE_NUMBER_FORMAT : DEFAULT_QUOTE_NUMBER_FORMAT;
    return { ...set, format: (kind === "rechnung" ? company?.invoice : company?.quote) ?? fallback, kundennummer: contact?.kundennummer ?? undefined };
  });
  if (!result.ok)
    throw new InvoiceError(`Die nächste Nummer muss größer als ${formatDocumentNumber(result.format, date, result.last, result.kundennummer)} sein.`);
}

/** Die Nummernkreise eines Kunden: je Art nur, wenn deren Zähler je Kunde läuft, sonst null statt Fehler (#1426) */
export async function contactNumbering(date: string, contactId: string) {
  const company = await loadCompany();
  const [invoice, quote] = await Promise.all([
    company.invoiceCounterPerCustomer ? numbering(date, "rechnung", contactId) : null,
    company.quoteCounterPerCustomer ? numbering(date, "angebot", contactId) : null,
  ]);
  return { invoice, quote };
}
