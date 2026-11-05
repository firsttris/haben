import {
  DUNNING_LEVELS,
  formatEuro,
  formatPercent,
  invoiceTemplateKind,
  joinEmails,
  MAX_EMAIL_RECIPIENTS,
  resolveMailTemplate,
  skontoFristen,
  splitEmails,
  legalInfo,
  type DunningLevel,
  type MailTemplateKind,
} from "@haben/core";
import { legalLines, texts, type Language } from "@haben/einvoice";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { db, schema } from "../../db/index.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";
import { attachmentsForMail, listInvoiceAttachments } from "./attachments.ts";
import { invoiceDocumentTotals } from "./invoice-taxes.ts";
import { invoiceTitle } from "./invoices.ts";
import { escapeHtml, loadMailSettings, MailError, send } from "../mail/index.ts";

/**
 * Rechnungen, Angebote und Mahnungen per E-Mail: Empfänger aus der Rechnung bzw. dem Kontakt, Betreff und Text aus
 * der Vorlage der Art in der Sprache des Belegs (resolveMailTemplate in @haben/core), PDF und bei XRechnung das XML im
 * Anhang. Jeder Versand steht im Mail-Protokoll.
 */

/** Ersetzt {name} durch den Wert; unbekannte Platzhalter bleiben stehen */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

const germanDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Text in einfaches HTML: Absätze und Zeilenumbrüche, alles escaped */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * E-Mails mit Rechnung, Angebot oder Mahnung sind Geschäftsbriefe (§ 35a Abs. 1 GmbHG). Bei GmbH und UG hängt Haben
 * die Pflichtangaben beim Senden als Signatur an, damit sie beim Bearbeiten des Textes nicht verloren gehen; leer beim
 * Einzelunternehmen.
 */
export function legalSignature(company: Company, language: Language = "de"): string {
  const lines = legalLines(legalInfo(company), texts(language));
  return lines.length > 0 ? ["-- ", company.name, ...lines].join("\n") : "";
}

/** Text der E-Mail als Klartext und HTML, mit der Signatur darunter */
function mailBody(body: string, signature: string) {
  const text = signature ? `${body}\n\n${signature}` : body;
  return { text, html: textToHtml(text) };
}

const recipientsSchema = z
  .string()
  .trim()
  .min(1, "Empfänger fehlt")
  .max(1000)
  .refine(
    (value) => {
      const list = splitEmails(value);
      return list.length > 0 && list.length <= MAX_EMAIL_RECIPIENTS && list.every((v) => z.email().safeParse(v).success);
    },
    { message: "Bis zu fünf gültige E-Mail-Adressen, durch Komma getrennt" },
  )
  .transform((value) => joinEmails(splitEmails(value)));

export const outgoingMailSchema = z.object({
  to: recipientsSchema,
  // Zeilenumbrüche haben im Betreff nichts zu suchen (Header-Injection), auch nicht aus Vorlagen
  subject: z
    .string()
    .trim()
    .min(1, "Betreff fehlt")
    .max(300)
    .transform((value) => value.replace(/\s*[\r\n]+\s*/g, " ")),
  body: z.string().trim().min(1, "Text fehlt").max(10_000),
  copyToMe: z.boolean().default(false),
});

export type OutgoingMail = z.input<typeof outgoingMailSchema>;

/** Bei der Rechnung zusätzlich: welche Anhänge an der Rechnung (#272) mitgehen */
export const invoiceMailSchema = outgoingMailSchema.extend({
  attachmentIds: z.array(z.uuid()).max(MAX_INVOICE_ATTACHMENTS).default([]),
});

export type InvoiceMail = z.input<typeof invoiceMailSchema>;

async function loadInvoice(id: string) {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice) throw new MailError("Rechnung nicht gefunden.");
  if (invoice.status !== "final" || !invoice.number) throw new MailError("Nur festgeschriebene Rechnungen lassen sich versenden.");
  return invoice;
}

/**
 * Empfänger beim Kunden: alle Adressen aus dem Kontakt (etwa Rechnungseingang und Freigeber), sonst die Adresse
 * auf der Rechnung. Auf der festgeschriebenen Rechnung steht nur die erste, weil die E-Rechnung nur eine kennt.
 */
async function customerEmail(invoice: { buyer: unknown; contactId: string | null }): Promise<string> {
  const fromInvoice = (invoice.buyer as { email?: string } | null)?.email?.trim() ?? "";
  if (!invoice.contactId) return fromInvoice;
  const [contact] = await db.select({ email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId));
  const fromContact = splitEmails(contact?.email);
  if (fromContact.length === 0) return fromInvoice;
  // Steht auf der Rechnung eine Adresse, die der Kontakt inzwischen nicht mehr hat, bleibt sie vorn
  const list = fromInvoice && !fromContact.includes(fromInvoice) ? [fromInvoice, ...fromContact] : fromContact;
  return joinEmails(list.slice(0, MAX_EMAIL_RECIPIENTS));
}

/** Betrag für die E-Mail in der Währung der Rechnung, wie auf dem PDF */
async function displayGross(invoice: typeof schema.invoices.$inferSelect): Promise<string> {
  const gross = invoice.currency === "EUR" ? invoice.gross : (await invoiceDocumentTotals(invoice.id)).gross;
  return texts(invoice.language, invoice.currency).money(gross);
}

/** Skontostufen der Rechnung für {zahlbar}: Frist und Satz, ohne Betrag */
function skontoTerms(invoice: typeof schema.invoices.$inferSelect) {
  return invoice.kind === "rechnung" ? skontoFristen(invoice.skonto, invoice.issueDate, invoice.gross) : [];
}

function invoiceValues(invoice: typeof schema.invoices.$inferSelect, firma: string, betrag: string, language = invoice.language) {
  const skonto = skontoTerms(invoice);
  if (language === "en") {
    const t = texts("en");
    const discounts = skonto.map((s) => ` or by ${t.date(s.until)} less ${t.percent(s.percent)} cash discount`).join("");
    return {
      art: invoice.kind === "rechnung" && invoice.variant ? t.variants[invoice.variant] : t.titles[invoice.kind],
      nummer: invoice.number ?? "",
      datum: t.date(invoice.issueDate),
      betrag,
      faellig: t.date(invoice.dueDate),
      zahlbar:
        invoice.kind === "rechnung" && invoice.gross > 0 ? `, payable by ${t.date(invoice.dueDate)}${discounts ? ` without deduction${discounts}` : ""}` : "",
      kunde: (invoice.buyer as { name?: string } | null)?.name ?? "",
      firma,
    };
  }
  return {
    art: invoiceTitle(invoice),
    nummer: invoice.number ?? "",
    datum: germanDate(invoice.issueDate),
    betrag,
    faellig: germanDate(invoice.dueDate),
    zahlbar:
      invoice.kind === "rechnung" && invoice.gross > 0
        ? `, zahlbar bis zum ${germanDate(invoice.dueDate)}${skonto.length > 0 ? ` ohne Abzug${germanDiscounts(skonto)}` : ""}`
        : "",
    kunde: (invoice.buyer as { name?: string } | null)?.name ?? "",
    firma,
  };
}

function germanDiscounts(skonto: ReturnType<typeof skontoTerms>): string {
  return skonto.map((s) => ` oder bis zum ${germanDate(s.until)} abzüglich ${formatPercent(s.percent)} Skonto`).join("");
}

function invoiceAttachments(invoice: typeof schema.invoices.$inferSelect) {
  const attachments: { filename: string; content: Buffer | string; contentType: string }[] = [];
  if (invoice.pdf) attachments.push({ filename: `Rechnung-${invoice.number}.pdf`, content: Buffer.from(invoice.pdf), contentType: "application/pdf" });
  // ZUGFeRD trägt das XML im PDF; XRechnung braucht es als eigene Datei
  if (invoice.xml && invoice.format !== "zugferd") {
    const suffix = invoice.format === "xrechnung-ubl" ? "ubl" : "cii";
    attachments.push({ filename: `Rechnung-${invoice.number}-${suffix}.xml`, content: invoice.xml, contentType: "application/xml" });
  }
  return attachments;
}

/** Vorschlag für das Formular: Empfänger, Betreff und Text aus der Vorlage */
export async function invoiceMailDraft(invoiceId: string) {
  const [invoice, company, settings] = await Promise.all([loadInvoice(invoiceId), loadCompany(), loadMailSettings()]);
  const values = invoiceValues(invoice, company.name, await displayGross(invoice));
  const template = resolveMailTemplate(settings?.templates, invoiceTemplateKind(invoice), invoice.language);
  return {
    to: await customerEmail(invoice),
    subject: fillTemplate(template.subject, values),
    body: fillTemplate(template.body, values),
    signature: legalSignature(company, invoice.language),
    attachments: invoiceAttachments(invoice).map((a) => a.filename),
    /** Zusätzliche Anhänge an der Rechnung zur Auswahl */
    extraAttachments: (await listInvoiceAttachments(invoiceId)).map(({ id, filename, size }) => ({ id, filename, size })),
    configured: Boolean(settings),
  };
}

/** Versand mit PDF (und bei XRechnung XML) und den ausgewählten Zusatzanhängen; das Protokoll nennt alle Dateinamen */
export async function sendInvoiceMail(actor: string, invoiceId: string, input: InvoiceMail) {
  const mail = invoiceMailSchema.parse(input);
  const [invoice, settings, company] = await Promise.all([loadInvoice(invoiceId), loadMailSettings(), loadCompany()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  const extra = await attachmentsForMail(invoiceId, mail.attachmentIds);
  return send(actor, {
    kind: "rechnung",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    ...mailBody(mail.body, legalSignature(company, invoice.language)),
    attachments: [...invoiceAttachments(invoice), ...extra],
    invoiceId,
  });
}

/** Für wiederkehrende Rechnungen: mit der Vorlage an die Adresse des Kunden, ohne Formular und ohne Zusatzanhänge */
export async function sendInvoiceMailWithTemplate(actor: string, invoiceId: string) {
  const draft = await invoiceMailDraft(invoiceId);
  if (!draft.configured) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet.");
  if (!draft.to) throw new MailError("Der Kunde hat keine E-Mail-Adresse.");
  return sendInvoiceMail(actor, invoiceId, { to: draft.to, subject: draft.subject, body: draft.body });
}

async function loadDunning(id: string) {
  const [dunning] = await db.select().from(schema.dunnings).where(eq(schema.dunnings.id, id));
  if (!dunning) throw new MailError("Mahnung nicht gefunden.");
  return { dunning, invoice: await loadInvoice(dunning.invoiceId) };
}

/** Mahnungen sind deutsch (auch das PDF), also auch Datum und Art in der Mail, selbst bei einer englischen Rechnung */
function dunningValues(dunning: typeof schema.dunnings.$inferSelect, invoice: typeof schema.invoices.$inferSelect, firma: string) {
  return {
    ...invoiceValues(invoice, firma, formatEuro(dunning.total), "de"),
    stufe: DUNNING_LEVELS[dunning.level as DunningLevel].label,
    betrag: formatEuro(dunning.total),
    frist: germanDate(dunning.dueDate),
  };
}

/** Wie beim Download: Zahlungserinnerung-2026-001.pdf */
const dunningFilename = (dunning: typeof schema.dunnings.$inferSelect, number: string) =>
  `${DUNNING_LEVELS[dunning.level as DunningLevel].title.replace(/ /g, "-")}-${number}.pdf`;

export async function dunningMailDraft(dunningId: string) {
  const [{ dunning, invoice }, company, settings] = await Promise.all([loadDunning(dunningId), loadCompany(), loadMailSettings()]);
  const values = dunningValues(dunning, invoice, company.name);
  const template = resolveMailTemplate(settings?.templates, `mahnung-${dunning.level as DunningLevel}` satisfies MailTemplateKind, "de");
  return {
    to: await customerEmail(invoice),
    subject: fillTemplate(template.subject, values),
    body: fillTemplate(template.body, values),
    signature: legalSignature(company),
    attachments: [dunningFilename(dunning, invoice.number!)],
    configured: Boolean(settings),
  };
}

export async function sendDunningMail(actor: string, dunningId: string, input: OutgoingMail) {
  const mail = outgoingMailSchema.parse(input);
  const [{ dunning, invoice }, settings, company] = await Promise.all([loadDunning(dunningId), loadMailSettings(), loadCompany()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  return send(actor, {
    kind: "mahnung",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    ...mailBody(mail.body, legalSignature(company)),
    attachments: [{ filename: dunningFilename(dunning, invoice.number!), content: Buffer.from(dunning.pdf), contentType: "application/pdf" }],
    invoiceId: invoice.id,
    dunningId,
  });
}

/** Versand zu einer Rechnung samt ihrer Mahnungen, neueste zuerst */
export async function mailsForInvoice(invoiceId: string) {
  return db
    .select({
      id: schema.mailLog.id,
      kind: schema.mailLog.kind,
      recipient: schema.mailLog.recipient,
      subject: schema.mailLog.subject,
      ok: schema.mailLog.ok,
      error: schema.mailLog.error,
      attachments: schema.mailLog.attachments,
      dunningId: schema.mailLog.dunningId,
      createdAt: schema.mailLog.createdAt,
    })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.invoiceId, invoiceId), or(eq(schema.mailLog.kind, "rechnung"), eq(schema.mailLog.kind, "mahnung"))))
    .orderBy(desc(schema.mailLog.createdAt));
}

/** Erfolgreich per E-Mail versandte Rechnungen, für die Liste */
export async function invoicesSentByMail(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ invoiceId: schema.mailLog.invoiceId })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.kind, "rechnung"), eq(schema.mailLog.ok, true)));
  return new Set(rows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : [])));
}

async function loadQuote(id: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id));
  if (!quote) throw new MailError("Angebot nicht gefunden.");
  if (quote.status !== "final" || !quote.number || !quote.pdf) throw new MailError("Nur festgeschriebene Angebote lassen sich versenden.");
  return quote;
}

function quoteValues(quote: typeof schema.quotes.$inferSelect, firma: string) {
  if (quote.language === "en") {
    const t = texts("en");
    return {
      nummer: quote.number ?? "",
      datum: t.date(quote.issueDate),
      gueltig: t.date(quote.validUntil),
      betrag: t.money(quote.gross),
      kunde: (quote.buyer as { name?: string } | null)?.name ?? "",
      firma,
    };
  }
  return {
    nummer: quote.number ?? "",
    datum: germanDate(quote.issueDate),
    gueltig: germanDate(quote.validUntil),
    betrag: formatEuro(quote.gross),
    kunde: (quote.buyer as { name?: string } | null)?.name ?? "",
    firma,
  };
}

/** Vorschlag für das Formular beim Angebot */
export async function quoteMailDraft(quoteId: string) {
  const [quote, company, settings] = await Promise.all([loadQuote(quoteId), loadCompany(), loadMailSettings()]);
  const values = quoteValues(quote, company.name);
  const template = resolveMailTemplate(settings?.templates, "angebot", quote.language);
  return {
    to: await customerEmail(quote),
    subject: fillTemplate(template.subject, values),
    body: fillTemplate(template.body, values),
    signature: legalSignature(company, quote.language),
    attachments: [`Angebot-${quote.number}.pdf`],
    configured: Boolean(settings),
  };
}

export async function sendQuoteMail(actor: string, quoteId: string, input: OutgoingMail) {
  const mail = outgoingMailSchema.parse(input);
  const [quote, settings, company] = await Promise.all([loadQuote(quoteId), loadMailSettings(), loadCompany()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  return send(actor, {
    kind: "angebot",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    ...mailBody(mail.body, legalSignature(company, quote.language)),
    attachments: [{ filename: `Angebot-${quote.number}.pdf`, content: Buffer.from(quote.pdf!), contentType: "application/pdf" }],
    quoteId,
  });
}

/** Versand eines Angebots, neueste zuerst */
export async function mailsForQuote(quoteId: string) {
  return db
    .select({
      id: schema.mailLog.id,
      recipient: schema.mailLog.recipient,
      subject: schema.mailLog.subject,
      ok: schema.mailLog.ok,
      error: schema.mailLog.error,
      createdAt: schema.mailLog.createdAt,
    })
    .from(schema.mailLog)
    .where(eq(schema.mailLog.quoteId, quoteId))
    .orderBy(desc(schema.mailLog.createdAt));
}

/** Erfolgreich per E-Mail versandte Angebote, für die Liste */
export async function quotesSentByMail(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ quoteId: schema.mailLog.quoteId })
    .from(schema.mailLog)
    .where(and(eq(schema.mailLog.kind, "angebot"), eq(schema.mailLog.ok, true)));
  return new Set(rows.flatMap((r) => (r.quoteId ? [r.quoteId] : [])));
}
