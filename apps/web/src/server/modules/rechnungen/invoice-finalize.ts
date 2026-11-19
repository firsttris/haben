import { formatRateMonth, invoicePosting, legacyCorrectionPosting, leistungsdatum, lineAmount, outgoingTaxIssues, rateMonth } from "@haben/core";
import { buildEInvoice, validateForFormat } from "@haben/einvoice";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { UmsatzgrenzeBestaetigung } from "../../../lib/kleinunternehmer.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { today } from "../../today.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { ansprechpartnerSnapshot, loadCompany, loadLetterhead, loadUnitCodes, sellerIssues, withCustomLayout } from "../stammdaten/index.ts";
import { deductedRefs, deductionIds, deductionProblems, openAbschlaege } from "./advance-deductions.ts";
import { advanceInvoicePosting } from "./advance-invoice.ts";
import { advanceProcedure } from "./advance-procedure.ts";
import { withAdvanceVatChange } from "./advance-vat.ts";
import { cancelledIds } from "./cancelled-invoices.ts";
import { originalProblem, reductionProblem } from "./correction-checks.ts";
import { applyRateToDraft, serviceDate } from "./draft-rate.ts";
import { buyerFrom, buyerIssues, documentFor, invoiceTitle, numberedBuyer, sellerFrom } from "./invoice-document.ts";
import { lockDraft } from "./invoice-drafts.ts";
import { InvoiceError } from "./invoice-error.ts";
import { invoicePostingMode, invoiceVatDate } from "./invoice-tax.ts";
import { invoiceDocumentTotals, invoiceTotalsById } from "./invoice-taxes.ts";
import { getInvoice, type Invoice } from "./invoices.ts";
import { directDebitFor, directDebitIssues } from "./lastschrift.ts";
import { serviceEntryCustomerIssues } from "./leistungen-kunde.ts";
import { circleFor, documentNumber, peekNumber, takeNumber } from "./number-counter.ts";
import { assertQuotesLocked, billsWholeQuote, lockQuotes, quotesTouching, syncQuoteBilling } from "./quote-billing.ts";
import { pruefeUmsatzgrenze, type UmsatzStand } from "./umsatzgrenze.ts";
import { versteuerungIssues } from "./versteuerung-pruefung.ts";

/* Festschreiben einer Rechnung: Prüfungen, Nummer, PDF und XML, Sperre und Buchung (GoBD) */

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Prüft, ob ein Entwurf festgeschrieben werden kann; leere Liste = bereit. */
export async function finalizeIssues(id: string, q: Db | Tx = db): Promise<string[]> {
  const data = await getInvoice(id, q);
  if (!data) return ["Rechnung nicht gefunden"];
  const { invoice, lines, contact } = data;
  const company = await loadCompany(q);
  const issues = sellerIssues(company, invoice.kind === "rechnung" && invoice.paymentMethod !== "bereits_bezahlt").map((issue) => `Firmendaten: ${issue}`);
  // Storno und Korrektur übernehmen die Behandlung des Originals, auch nach einem Wechsel der Einstellung
  if (invoice.kind === "rechnung") issues.push(...outgoingTaxIssues(invoice.taxTreatment, invoice.taxDetails, company.kleinunternehmer));
  issues.push(...(await versteuerungIssues(company, invoice.issueDate, q)));
  issues.push(...buyerIssues(company.invoiceNumberFormat, contact, data.corrects));
  if (invoice.advanceType === "teilleistung") {
    if (!invoice.serviceFrom) issues.push("Leistungsdatum der erbrachten Teilleistung fehlt");
    if ((invoice.serviceTo ?? invoice.serviceFrom ?? "") > invoice.issueDate) issues.push("Die Teilleistung ist am Rechnungsdatum noch nicht erbracht");
  }
  if (invoice.variant === "schluss" && (await invoiceVatDate(invoice, q)) > invoice.issueDate) {
    issues.push("Die Schlussleistung ist am Rechnungsdatum noch nicht erbracht");
  }
  if (lines.length === 0) issues.push("Keine Positionen");
  if (lines.some((line) => lineAmount(line.quantity, line.unitPrice) === 0)) issues.push("Position ohne Betrag");
  if (invoice.correctsId) {
    const [original] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
    const problem = original
      ? ((await originalProblem(original, q, invoice)) ?? (await reductionProblem(invoice, original, q)))
      : "Die korrigierte Rechnung fehlt";
    if (problem) issues.push(problem);
  }
  if (invoice.variant === "schluss") {
    const deducts = deductionIds(lines);
    if (deducts.length === 0) issues.push("Keine Abschlagsrechnung abgezogen");
    issues.push(
      ...(await deductionProblems(id, { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment, taxDetails: invoice.taxDetails }, q))
        .problems,
    );
    if (invoice.gross < 0) issues.push("Die Abschläge übersteigen die Gesamtleistung");
  } else if (invoice.kind === "rechnung" && invoice.gross <= 0) issues.push("Gesamtbetrag muss positiv sein");
  if (invoice.kind === "korrektur" && invoice.gross >= 0) issues.push("Eine Rechnungskorrektur muss den Betrag mindern");
  if (invoice.quoteId) {
    const [quote] = await q
      .select({ number: schema.quotes.number, status: schema.quotes.status, contactId: schema.quotes.contactId, decision: schema.quotes.decision })
      .from(schema.quotes)
      .where(eq(schema.quotes.id, invoice.quoteId));
    if (quote?.status !== "final") issues.push("Das gewählte Angebot ist nicht festgeschrieben");
    else if (quote.contactId !== invoice.contactId) issues.push(`Angebot ${quote.number} gehört zu einem anderen Kunden`);
    else if (quote.decision === "abgelehnt") issues.push(`Angebot ${quote.number} ist als abgelehnt markiert`);
    else {
      // Schon über das Ganze abgerechnet (auch ältere Rechnungen, die nur über quotes.invoice_id verknüpft sind):
      // keine zweite Rechnung, keine weiteren Abschläge
      const [billed] = await q
        .select({ number: schema.invoices.number })
        .from(schema.invoices)
        .where(
          and(
            ne(schema.invoices.id, invoice.id),
            eq(schema.invoices.kind, "rechnung"),
            eq(schema.invoices.status, "final"),
            billsWholeQuote,
            sql`${schema.invoices.id} not in (${cancelledIds})`,
            or(eq(schema.invoices.quoteId, invoice.quoteId), sql`${schema.invoices.id} = (select invoice_id from quotes where id = ${invoice.quoteId})`),
          ),
        )
        .limit(1);
      if (billed) issues.push(`Angebot ${quote.number} ist schon mit Rechnung ${billed.number} abgerechnet`);
      if (invoice.variant === "schluss") {
        // Festgeschriebene Abschläge dieses Angebots, die keine Schlussrechnung abzieht, müssen hier abgezogen werden;
        // sonst wäre der Auftrag doppelt abgerechnet
        const deducted = new Set(deductionIds(lines));
        for (const a of (await openAbschlaege(id, q)).filter((a) => a.quoteId === invoice.quoteId && !deducted.has(a.id))) {
          issues.push(`Abschlagsrechnung ${a.number} zum Angebot ist noch nicht abgezogen`);
        }
      }
    }
  }
  if (invoice.currency !== "EUR") {
    if (invoice.variant) issues.push("Abschlags- und Schlussrechnungen gibt es nur in Euro");
    // Bei Ist-Versteuerung ist das Entgelt mit dem Kurs des Monats umzurechnen, in dem es vereinnahmt wird (Abschn. 16.4
    // UStAE); Haben rechnet mit dem Kurs der Rechnung. Ohne deutsche Umsatzsteuer (Leistung an ein Unternehmen im Ausland,
    // § 13b, steuerfrei) spielt das keine Rolle, mit deutscher Steuer wäre die Voranmeldung um die Kursänderung falsch.
    if (
      invoice.kind === "rechnung" &&
      !company.kleinunternehmer &&
      company.versteuerung === "ist" &&
      invoice.taxTreatment === "regulaer" &&
      lines.some((line) => line.taxRate > 0)
    ) {
      issues.push("Rechnungen in Fremdwährung mit deutscher Umsatzsteuer gehen nur bei Soll-Versteuerung; bei Ist-Versteuerung in Euro abrechnen");
    }
    if (!invoice.exchangeRate) {
      const month = rateMonth(serviceDate(invoice));
      issues.push(
        month >= rateMonth(today())
          ? `Umrechnungskurs für ${formatRateMonth(month)} noch nicht veröffentlicht; trag einen Kurs von Hand ein oder warte bis nach Monatsende`
          : `Umrechnungskurs für ${invoice.currency} ${formatRateMonth(month)} fehlt`,
      );
    }
  }
  issues.push(...(await directDebitIssues(invoice, company, q)), ...(await serviceEntryCustomerIssues(q, id, invoice.contactId)));
  if (contact && issues.length === 0) {
    const preview = documentFor(
      invoice,
      lines,
      await invoiceDocumentTotals(id, q),
      (await invoiceTotalsById([id], q)).get(id)!,
      sellerFrom(company),
      buyerFrom(contact, await ansprechpartnerSnapshot(q, invoice.contactPersonId)),
      "VORSCHAU",
      data.corrects?.number ? { number: data.corrects.number, issueDate: data.corrects.issueDate } : null,
      await deductedRefs(lines, q),
      await directDebitFor(invoice, company, q),
      await loadUnitCodes(q),
    );
    issues.push(...validateForFormat(preview));
  }
  return issues;
}

/**
 * Festschreiben: Nummer ziehen, PDF und XML erzeugen, sperren und buchen – alles in einer
 * Transaktion. Schlägt etwas fehl, bleibt der Entwurf ohne Nummer und es entsteht keine Lücke.
 * `umsatzStand` ist der vereinnahmte Umsatz für die Rückfrage zur Kleinunternehmergrenze (`kleinunternehmerStand`).
 */
export async function finalizeInvoice(actor: string, id: string, umsatzStand: UmsatzStand, bestaetigt?: UmsatzgrenzeBestaetigung): Promise<Invoice> {
  return withActor(actor, (tx) => finalizeDraft(tx, id, umsatzStand, bestaetigt));
}

/**
 * Verfahrensspalten beim Festschreiben. Ab #853 mindern Storno und Korrektur bereits Vereinnahmtes erst mit der
 * Rückzahlung; der Trigger invoices_reduction_rule verlangt das Kennzeichen.
 */
function procedureColumns(invoice: Invoice) {
  return {
    advanceType: invoice.advanceType,
    advanceAccounting: invoice.advanceAccounting,
    replacesInvoiceId: invoice.replacesInvoiceId,
    reductionRule: invoice.kind === "rechnung" ? null : ("rueckgewaehr" as const),
  };
}

/** Festschreiben in einer laufenden Transaktion; prüft dort, was finalizeIssues meldet */
export async function finalizeDraft(tx: Tx, id: string, umsatzStand: UmsatzStand, bestaetigt?: UmsatzgrenzeBestaetigung): Promise<Invoice> {
  // Angebote zuerst (lockQuotes): Die Prüfungen gegen andere Rechnungen desselben Angebots laufen erst unter der Sperre
  const [peek] = await tx.select({ correctsId: schema.invoices.correctsId }).from(schema.invoices).where(eq(schema.invoices.id, id));
  const quoteIds = await lockQuotes(tx, await quotesTouching(tx, [id, peek?.correctsId]));
  let invoice = await lockDraft(tx, id);
  await assertQuotesLocked(tx, quoteIds, [id, invoice.correctsId]);
  // Inzwischen veröffentlichten Kurs übernehmen, bevor geprüft wird
  if (await applyRateToDraft(tx, invoice)) invoice = await lockDraft(tx, id);
  // Nur bereits festgeschriebene Altabschläge behalten ihr Verfahren; offene Altentwürfe erhalten die neue Vorgabe.
  // Erst mit der Festschreibung speichern, damit die Audit-Kette nicht vor der Nummernkreissperre gehalten wird.
  if (invoice.variant === "abschlag" && invoice.advanceType === null) invoice = { ...invoice, advanceType: "anzahlung" };
  const issues = await finalizeIssues(id, tx);
  if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);
  const company = await openBooks(tx);
  const lines = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id)).orderBy(asc(schema.invoiceLines.position));
  const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId!));

  // Original und abgezogene Abschläge sperren und erneut prüfen: Ein paralleles Storno, eine Korrektur
  // oder eine andere Schlussrechnung kann seit finalizeIssues festgeschrieben worden sein.
  const deducts = deductionIds(lines);
  const referenced = [...(invoice.correctsId ? [invoice.correctsId] : []), ...deducts];
  if (referenced.length > 0) {
    await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(inArray(schema.invoices.id, referenced))
      .orderBy(asc(schema.invoices.id))
      .for("update");
  }
  let corrects: Invoice | undefined;
  if (invoice.correctsId) {
    [corrects] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
    const problem = corrects
      ? ((await originalProblem(corrects, tx, invoice)) ?? (await reductionProblem(invoice, corrects, tx)))
      : "Die korrigierte Rechnung fehlt";
    if (problem) throw new InvoiceError(`${problem}.`);
  }
  if (invoice.kind === "rechnung" && deducts.length > 0) {
    const { problems } = await deductionProblems(
      id,
      { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment, taxDetails: invoice.taxDetails },
      tx,
    );
    if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
  }
  invoice = { ...invoice, ...(await advanceProcedure(invoice, lines, company, tx)) };
  // „Ausgeführt am“ einfrieren (#694): Der Leistungsmonat entscheidet bei Soll-Versteuerung, wann die Umsatzsteuer
  // gemeldet wird. Ab hier ist er unveränderlich, damit ein späterer Entwurfsstand die gemeldete Zahl nicht verschiebt.
  invoice = { ...invoice, serviceDate: leistungsdatum({ belegdatum: invoice.issueDate, leistungVon: invoice.serviceFrom, leistungBis: invoice.serviceTo }) };
  if (invoice.advanceAccounting === "deferred" && invoice.kind === "rechnung" && invoice.variant === "schluss") {
    const performed = invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate;
    if (performed > invoice.issueDate) throw new InvoiceError("Das Leistungsdatum der Schlussrechnung liegt nach dem Rechnungsdatum.");
  }

  // Storno/Korrektur: Anschrift des Originals, {KUNDENNR} daraus oder vom Kontakt (#1426); nur gelesen, daher vor der Sperre
  const seller = sellerFrom(company);
  const buyer = numberedBuyer(corrects?.buyer ?? null, contact!, await ansprechpartnerSnapshot(tx, invoice.contactPersonId), company.invoiceNumberFormat);

  // Nummer nur lesen (Sperre des Nummernkreises), PDF und XML erzeugen, erst dann schreiben: Bis zum ersten Schreiben
  // mit Audit-Eintrag ist die Hash-Kette frei, andere Schreibvorgänge warten nicht auf das Rendern (number-counter.ts)
  const circle = await circleFor(tx, "rechnung", invoice.issueDate);
  const counter = await peekNumber(tx, "rechnung", circle);
  const number = await documentNumber(tx, "rechnung", company.invoiceNumberFormat, invoice.issueDate, counter, buyer.kundennummer);
  const totals = (await invoiceTotalsById([id], tx)).get(id)!;
  await pruefeUmsatzgrenze(tx, invoice, totals.net, company.foundedOn, umsatzStand, bestaetigt);
  const doc = documentFor(
    invoice,
    lines,
    await invoiceDocumentTotals(id, tx),
    totals,
    seller,
    buyer,
    number,
    corrects ? { number: corrects.number!, issueDate: corrects.issueDate } : null,
    await deductedRefs(lines, tx),
    await directDebitFor(invoice, company, tx),
    await loadUnitCodes(tx),
  );
  const rendered = await withCustomLayout("rechnung", await loadLetterhead(), (letterhead) => buildEInvoice({ ...doc, ...letterhead }));
  const now = new Date();

  await takeNumber(tx, "rechnung", circle, counter);
  const [finalized] = await withAdvanceVatChange(tx, id, () =>
    tx
      .update(schema.invoices)
      .set({
        status: "final",
        ...procedureColumns(invoice),
        number,
        numberYear: circle,
        numberCounter: counter,
        contactVersion: contact!.version,
        seller,
        buyer,
        net: totals.net,
        tax: totals.tax,
        gross: totals.gross,
        // Ab hier fest: der Tag, an dem die Leistung ausgeführt wurde (#694)
        serviceDate: invoice.serviceDate,
        pdf: Buffer.from(rendered.pdf),
        pdfSha256: sha256(rendered.pdf),
        xml: rendered.xml,
        xmlSha256: sha256(rendered.xml),
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, id))
      .returning(),
  );

  const versteuerung = await invoicePostingMode(invoice, tx);
  const bookings =
    invoice.advanceAccounting === "deferred"
      ? await advanceInvoicePosting(invoice, totals, company.kontenrahmen, tx)
      : [
          {
            date: await invoiceVatDate(invoice, tx),
            // Übernommene Erlöse stehen in den alten Büchern; auch spätere Korrektur-Stornos folgen deren Ursprung.
            lines: (await correctsLegacyInvoice(tx, corrects))
              ? legacyCorrectionPosting(totals, company.kontenrahmen, versteuerung)
              : invoicePosting(totals, company.kontenrahmen, versteuerung, invoice.taxTreatment),
          },
        ];
  for (const booking of bookings)
    if (booking.lines.length)
      await post(tx, company, {
        date: booking.date,
        description: `${invoiceTitle(invoice)} ${number} · ${buyer.name}`,
        sourceType: "invoice",
        sourceId: id,
        lines: booking.lines,
      });
  // Festgeschrieben bzw. storniert: welche Rechnung das Angebot abrechnet, kann sich damit ändern
  await syncQuoteBilling(tx, quoteIds);

  return finalized!;
}

/** Korrigiert die Rechnung (über Korrekturen hinweg) eine aus Lexoffice übernommene? Dann gehören ihre Erlöse zu den alten Büchern */
async function correctsLegacyInvoice(q: Db | Tx, corrects: Invoice | undefined): Promise<boolean> {
  let current = corrects;
  for (let depth = 0; current && depth < 20; depth++) {
    if (current.lexofficeVoucherId) return true;
    if (!current.correctsId) return false;
    [current] = await q.select().from(schema.invoices).where(eq(schema.invoices.id, current.correctsId));
  }
  return false;
}
