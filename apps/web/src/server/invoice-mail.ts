import { DUNNING_LEVELS, formatEuro, type DunningLevel } from "@haben/core";
import { texts } from "@haben/einvoice";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { db, schema } from "./db/index.ts";
import { invoiceTitle } from "./invoices.ts";
import { escapeHtml, loadMailSettings, MailError, send } from "./mail.ts";

/**
 * Rechnungen und Mahnungen per E-Mail: Empfänger aus der Rechnung bzw. dem Kontakt, Betreff und Text aus
 * Vorlagen mit Platzhaltern, PDF und bei XRechnung das XML im Anhang. Jeder Versand steht im Mail-Protokoll.
 */

export const DEFAULT_INVOICE_SUBJECT = "{art} {nummer} von {firma}";
export const DEFAULT_INVOICE_BODY = `Guten Tag,

anbei erhalten Sie unsere {art} {nummer} vom {datum} über {betrag}{zahlbar}.

Mit freundlichen Grüßen
{firma}`;
export const DEFAULT_DUNNING_SUBJECT = "{stufe} zur Rechnung {nummer}";
export const DEFAULT_DUNNING_BODY = `Guten Tag,

anbei erhalten Sie unsere {stufe} zur Rechnung {nummer} vom {datum}. Bitte überweisen Sie den offenen Betrag von {betrag} bis zum {frist}.

Sollten Sie inzwischen bezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Mit freundlichen Grüßen
{firma}`;

export const DEFAULT_QUOTE_SUBJECT = "Angebot {nummer} von {firma}";
export const DEFAULT_QUOTE_BODY = `Guten Tag,

anbei erhalten Sie unser Angebot {nummer} vom {datum} über {betrag}. Es gilt bis zum {gueltig}.

Für Rückfragen sind wir gern für Sie da.

Mit freundlichen Grüßen
{firma}`;

/** Englische Vorlagen für Kunden mit Sprache Englisch; die eigenen Vorlagen in den Einstellungen sind deutsch */
export const DEFAULT_INVOICE_SUBJECT_EN = "{art} {nummer} from {firma}";
export const DEFAULT_INVOICE_BODY_EN = `Dear Sir or Madam,

please find attached {art} {nummer} dated {datum} for {betrag}{zahlbar}.

Kind regards
{firma}`;
export const DEFAULT_QUOTE_SUBJECT_EN = "Quote {nummer} from {firma}";
export const DEFAULT_QUOTE_BODY_EN = `Dear Sir or Madam,

please find attached our quote {nummer} dated {datum} for {betrag}. It is valid until {gueltig}.

Please do not hesitate to contact us if you have any questions.

Kind regards
{firma}`;

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

export const recipientsSchema = z
  .string()
  .trim()
  .min(1, "Empfänger fehlt")
  .max(1000)
  .refine(
    (value) => {
      const list = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      return list.length > 0 && list.length <= 5 && list.every((v) => z.string().email().safeParse(v).success);
    },
    { message: "Bis zu fünf gültige E-Mail-Adressen, durch Komma getrennt" },
  )
  .transform((value) =>
    value
      .split(/[,;]/)
      .map((v) => v.trim())
      .filter(Boolean)
      .join(", "),
  );

export const outgoingMailSchema = z.object({
  to: recipientsSchema,
  subject: z.string().trim().min(1, "Betreff fehlt").max(300),
  body: z.string().trim().min(1, "Text fehlt").max(10_000),
  copyToMe: z.boolean().default(false),
});

export type OutgoingMail = z.input<typeof outgoingMailSchema>;

async function loadInvoice(id: string) {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice) throw new MailError("Rechnung nicht gefunden.");
  if (invoice.status !== "final" || !invoice.number) throw new MailError("Nur festgeschriebene Rechnungen lassen sich versenden.");
  return invoice;
}

/** E-Mail des Kunden: auf der Rechnung, sonst aktuell im Kontakt */
async function customerEmail(invoice: { buyer: unknown; contactId: string | null }): Promise<string> {
  const fromInvoice = (invoice.buyer as { email?: string } | null)?.email?.trim();
  if (fromInvoice) return fromInvoice;
  if (!invoice.contactId) return "";
  const [contact] = await db.select({ email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId));
  return contact?.email ?? "";
}

function invoiceValues(invoice: typeof schema.invoices.$inferSelect, firma: string) {
  if (invoice.language === "en") {
    const t = texts("en");
    return {
      art: invoice.kind === "rechnung" && invoice.variant ? t.variants[invoice.variant] : t.titles[invoice.kind],
      nummer: invoice.number ?? "",
      datum: t.date(invoice.issueDate),
      betrag: t.money(invoice.gross),
      faellig: t.date(invoice.dueDate),
      zahlbar: invoice.kind === "rechnung" && invoice.gross > 0 ? `, payable by ${t.date(invoice.dueDate)}` : "",
      kunde: (invoice.buyer as { name?: string } | null)?.name ?? "",
      firma,
    };
  }
  return {
    art: invoiceTitle(invoice),
    nummer: invoice.number ?? "",
    datum: germanDate(invoice.issueDate),
    betrag: formatEuro(invoice.gross),
    faellig: germanDate(invoice.dueDate),
    zahlbar: invoice.kind === "rechnung" && invoice.gross > 0 ? `, zahlbar bis zum ${germanDate(invoice.dueDate)}` : "",
    kunde: (invoice.buyer as { name?: string } | null)?.name ?? "",
    firma,
  };
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
  const values = invoiceValues(invoice, company.name);
  return {
    to: await customerEmail(invoice),
    subject: fillTemplate(invoice.language === "en" ? DEFAULT_INVOICE_SUBJECT_EN : settings?.invoiceSubject || DEFAULT_INVOICE_SUBJECT, values),
    body: fillTemplate(invoice.language === "en" ? DEFAULT_INVOICE_BODY_EN : settings?.invoiceBody || DEFAULT_INVOICE_BODY, values),
    attachments: invoiceAttachments(invoice).map((a) => a.filename),
    configured: Boolean(settings),
  };
}

export async function sendInvoiceMail(actor: string, invoiceId: string, input: OutgoingMail) {
  const mail = outgoingMailSchema.parse(input);
  const [invoice, settings] = await Promise.all([loadInvoice(invoiceId), loadMailSettings()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  return send(actor, {
    kind: "rechnung",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    text: mail.body,
    html: textToHtml(mail.body),
    attachments: invoiceAttachments(invoice),
    invoiceId,
  });
}

/** Für wiederkehrende Rechnungen: mit der Vorlage an die Adresse des Kunden, ohne Formular */
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

function dunningValues(dunning: typeof schema.dunnings.$inferSelect, invoice: typeof schema.invoices.$inferSelect, firma: string) {
  return {
    ...invoiceValues(invoice, firma),
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
  return {
    to: await customerEmail(invoice),
    subject: fillTemplate(settings?.dunningSubject || DEFAULT_DUNNING_SUBJECT, values),
    body: fillTemplate(settings?.dunningBody || DEFAULT_DUNNING_BODY, values),
    attachments: [dunningFilename(dunning, invoice.number!)],
    configured: Boolean(settings),
  };
}

export async function sendDunningMail(actor: string, dunningId: string, input: OutgoingMail) {
  const mail = outgoingMailSchema.parse(input);
  const [{ dunning, invoice }, settings] = await Promise.all([loadDunning(dunningId), loadMailSettings()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  return send(actor, {
    kind: "mahnung",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    text: mail.body,
    html: textToHtml(mail.body),
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
  return {
    to: await customerEmail(quote),
    subject: fillTemplate(quote.language === "en" ? DEFAULT_QUOTE_SUBJECT_EN : DEFAULT_QUOTE_SUBJECT, values),
    body: fillTemplate(quote.language === "en" ? DEFAULT_QUOTE_BODY_EN : DEFAULT_QUOTE_BODY, values),
    attachments: [`Angebot-${quote.number}.pdf`],
    configured: Boolean(settings),
  };
}

export async function sendQuoteMail(actor: string, quoteId: string, input: OutgoingMail) {
  const mail = outgoingMailSchema.parse(input);
  const [quote, settings] = await Promise.all([loadQuote(quoteId), loadMailSettings()]);
  if (!settings) throw new MailError("Es ist kein E-Mail-Zugang eingerichtet (Einstellungen › E-Mail-Versand).");
  return send(actor, {
    kind: "angebot",
    to: mail.to,
    ...(mail.copyToMe ? { bcc: settings.fromAddress } : {}),
    subject: mail.subject,
    text: mail.body,
    html: textToHtml(mail.body),
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
