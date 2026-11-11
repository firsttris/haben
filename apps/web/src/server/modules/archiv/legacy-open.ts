import { UserError } from "../../errors.ts";
import {
  addDays,
  computeInvoice,
  isLegacyVatPayment,
  legacyOpenAt,
  openingDocumentPosting,
  openingInvoicePosting,
  takeoverCutoff,
  takeoverCutoffConflict,
  takeoverCutoffIssue,
  type ExpenseCategory,
  type LegacyOpenAt,
  type PriceMode,
  type TakeoverCutoff,
} from "@haben/core";
import { and, eq, getTableColumns, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withActor } from "../../db/actor.ts";
import { activeOpenings, openBooks, post, stapelOpeningCovering } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { lastStapelYear } from "./datev-eroeffnung.ts";
import { storeInvoiceTaxes } from "../rechnungen/index.ts";
import type { LegacyCategoryRow } from "../../db/schema.ts";
import { buyerFrom, sellerFrom } from "../rechnungen/index.ts";
import { loadFile } from "../../storage.ts";
import { today } from "../../today.ts";
import { effectivePayment, paymentHistoryIssue, settledOn } from "./payment-history.ts";
import { importedTaxTreatment } from "./legacy-import-tax.ts";
import { effectiveContactName, effectiveDirection, effectiveTaxes, effectiveType } from "./sevdesk-richtung.ts";

export class TakeoverError extends UserError {}

type LegacyVoucher = typeof schema.lexofficeVouchers.$inferSelect;

/** Belegarten, die als offener Posten nach Haben wandern können */
const SALES = new Set(["invoice"]);
const PURCHASES = new Set(["purchaseinvoice"]);
const OPEN_ITEM_TYPES = new Set([...SALES, ...PURCHASES]);

const SOURCE_LABEL = {
  lexoffice: "Lexoffice",
  sevdesk: "sevDesk",
  buchhaltungsbutler: "BuchhaltungsButler",
  accountable: "Accountable",
  import: "JSON-Import",
} as const;

export interface OpenLegacyItem {
  id: string;
  source: LegacyVoucher["source"];
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  dueDate: string | null;
  contactName: string;
  gross: number;
  /** Offen am Stichtag; bei Belegen nach dem Stichtag offen heute */
  open: number;
  /** Bei unklarer Historie ist der ausgewiesene Quellsaldo kein verlässlicher Stichtagsbetrag. */
  openKnown: boolean;
  /** Davon nach dem Stichtag bezahlt: Die Zahlung ordnest du in Haben im Bankabgleich zu */
  paidAfter: number;
  /** Übernommen als Rechnung bzw. Beleg in Haben */
  takenOver: { kind: "invoice" | "document"; id: string } | null;
  /** Warum sich der Posten nicht übernehmen lässt */
  blocker: string | null;
}

async function lastVoucherDate(q: Db | Tx): Promise<string | null> {
  const [row] = await q.select({ last: sql<string | null>`max(${schema.lexofficeVouchers.date})::text` }).from(schema.lexofficeVouchers);
  return row?.last ?? null;
}

/**
 * Buchungstag der ersten Übernahme eines offenen Postens: die früheste Buchung einer übernommenen Rechnung bzw. eines
 * übernommenen Belegs. Andere Buchungen haben diese Quellen nicht (Zahlungen buchen über die Zuordnung, Korrekturen als
 * eigene Rechnung); Stornobuchungen zählen nicht.
 */
async function firstTakeoverDate(q: Db | Tx): Promise<string | null> {
  const e = schema.journalEntries;
  const [row] = await q
    .select({ first: sql<string | null>`min(${e.date})::text` })
    .from(e)
    .where(
      and(
        isNull(e.reversesId),
        sql`(${e.sourceType} = 'invoice' and exists (select 1 from ${schema.invoices} i where i.id = ${e.sourceId} and i.lexoffice_voucher_id is not null))
          or (${e.sourceType} = 'document' and exists (select 1 from ${schema.documents} d where d.id = ${e.sourceId} and d.lexoffice_voucher_id is not null))`,
      ),
    );
  return row?.first ?? null;
}

/**
 * Stichtag der Übernahme aus Firmendaten, Journal und Archiv (takeoverCutoff in @haben/core). Ein gewählter Stichtag
 * gilt nur, wenn weder eine Eröffnung noch die erste Übernahme noch bei GmbH und UG der DATEV-Stapel ihn festlegt; weicht
 * er von dem der ersten Übernahme ab, lehnt Haben ihn ab.
 */
export async function legacyTakeoverCutoff(requested?: string | null, q: Db | Tx = db): Promise<TakeoverCutoff> {
  const [company, openings, stapelYear, lastVoucher, firstTakeover] = await Promise.all([
    loadCompany(q),
    activeOpenings(q),
    lastStapelYear(q),
    lastVoucherDate(q),
    firstTakeoverDate(q),
  ]);
  const input = {
    rechtsform: company.rechtsform,
    openingDate: openings[0]?.date ?? null,
    stapelYear,
    lastVoucherDate: lastVoucher,
    firstTakeoverDate: firstTakeover,
    today: today(),
  };
  const cutoff = takeoverCutoff(input);
  if (!requested) return cutoff;
  const conflict = takeoverCutoffConflict(requested, input);
  if (conflict) throw new TakeoverError(conflict);
  if (cutoff.fixed) return cutoff;
  const issue = takeoverCutoffIssue(requested, company.rechtsform, input.today);
  if (issue) throw new TakeoverError(issue);
  return takeoverCutoff({ ...input, requested });
}

function blockerFor(voucher: LegacyVoucher, state: LegacyOpenAt, cutoff: string, hasPdf: boolean): string | null {
  // Zahllast an das Finanzamt (#269): als Beleg zählte die Zahlung in der EÜR als Ausgabe ihrer Kategorie. Im Bankabgleich
  // als „Umsatzsteuer an das Finanzamt“ zugeordnet, bucht sie auf die Vorauszahlungen (SKR03 1780, SKR04 3820) und steht in
  // der EÜR unter der gezahlten Umsatzsteuer, wie die Zahllast für Dezember nach dem Jahreswechsel.
  if (isLegacyVatPayment({ ...voucher, categories: voucher.categories.map((c) => c.name) }))
    return "Umsatzsteuer an das Finanzamt – kein Beleg in Haben; die Zahlung im Bankabgleich als „Umsatzsteuer an das Finanzamt“ zuordnen";
  if (voucher.currency !== "EUR") return "Fremdwährung";
  if (voucher.date > cutoff) return "nach dem Stichtag ausgestellt – gehört in die Bücher von Haben; dort als Rechnung bzw. Beleg erfassen";
  if (state.issue) return `Stand am Stichtag unklar (${state.issue}) – in ${SOURCE_LABEL[voucher.source]} prüfen und von Hand erfassen`;
  // Die Rechnung in Haben trägt den Betrag des Original-PDFs; offen ist dort, was keine Zahlung im Bankabgleich deckt.
  // Eine Zahlung vor dem Stichtag hat keinen Bankumsatz in Haben, eine Ausbuchung änderte die Steuer (§ 17 Abs. 1 UStG).
  if (state.open !== Math.abs(voucher.gross))
    return `bis zum Stichtag teilweise bezahlt – Restbetrag erst in ${SOURCE_LABEL[voucher.source]} ausgleichen oder in Haben direkt buchen`;
  if (voucher.taxes.some((t) => ![1900, 700, 0].includes(t.rate))) return "Steuersatz, den Haben nicht kennt";
  if (voucher.gross <= 0) return "Betrag nicht positiv";
  if (!hasPdf) return `keine Datei aus ${SOURCE_LABEL[voucher.source]}`;
  return null;
}

/**
 * Stichtag beim Übernehmen: der angezeigte. Legt inzwischen eine Eröffnung einen anderen fest, bricht die Übernahme ab,
 * statt an einem anderen Tag zu buchen als angezeigt.
 */
async function shownCutoff(requested?: string | null): Promise<TakeoverCutoff> {
  const cutoff = await legacyTakeoverCutoff(requested);
  if (requested && cutoff.date !== requested) throw new TakeoverError("Der Stichtag hat sich inzwischen geändert. Bitte die Seite neu laden.");
  return cutoff;
}

/** Stichtag für den Stand heute: keine Zahlung liegt danach */
const TODAY_STATE = "9999-12-31";

/**
 * Rechnungen und Eingangsbelege aus Lexoffice oder sevDesk, die am Stichtag offen waren und in Haben bezahlt werden,
 * dazu heute offene nach dem Stichtag (nicht übernehmbar) und schon übernommene.
 */
export async function openLegacyItems(requestedCutoff?: string | null): Promise<OpenLegacyItem[]> {
  return itemsAt((await legacyTakeoverCutoff(requestedCutoff)).date);
}

/**
 * Für den Schritt „Offene Posten übernehmen“: Stichtag und Posten. Ein ungültiger gewählter Stichtag fällt auf den
 * Vorschlag zurück und kommt als Hinweis mit.
 */
export async function openItemsOverview(
  requestedCutoff?: string | null,
): Promise<{ cutoff: TakeoverCutoff; cutoffError: string | null; items: OpenLegacyItem[] }> {
  let cutoffError: string | null = null;
  const cutoff = await legacyTakeoverCutoff(requestedCutoff).catch(async (error: unknown) => {
    if (!(error instanceof TakeoverError)) throw error;
    cutoffError = error.message;
    return legacyTakeoverCutoff();
  });
  return { cutoff, cutoffError, items: await itemsAt(cutoff.date) };
}

function sevPayDate(raw: Record<string, unknown>): string | null {
  return typeof raw.payDate === "string" ? raw.payDate : null;
}

async function itemsAt(cutoff: string): Promise<OpenLegacyItem[]> {
  const vouchers = await db
    .select({
      ...getTableColumns(schema.lexofficeVouchers),
      type: effectiveType("lexoffice_vouchers"),
      direction: effectiveDirection("lexoffice_vouchers"),
      contactName: effectiveContactName("lexoffice_vouchers"),
      taxes: effectiveTaxes("lexoffice_vouchers"),
      payment: effectivePayment("lexoffice_vouchers"),
    })
    .from(schema.lexofficeVouchers)
    // Auch die gespeicherte Art: Früher als Ausgabebeleg übernommene D-Belege bleiben als übernommen sichtbar
    .where(or(inArray(effectiveType("lexoffice_vouchers"), [...OPEN_ITEM_TYPES]), inArray(schema.lexofficeVouchers.type, [...OPEN_ITEM_TYPES])))
    .orderBy(schema.lexofficeVouchers.date, schema.lexofficeVouchers.number);
  const [invoices, documents] = await Promise.all([
    db
      .select({ id: schema.invoices.id, voucherId: schema.invoices.lexofficeVoucherId })
      .from(schema.invoices)
      .where(isNotNull(schema.invoices.lexofficeVoucherId)),
    db
      .select({ id: schema.documents.id, voucherId: schema.documents.lexofficeVoucherId })
      .from(schema.documents)
      .where(isNotNull(schema.documents.lexofficeVoucherId)),
  ]);
  const invoiceBy = new Map(invoices.map((i) => [i.voucherId, i.id]));
  const documentBy = new Map(documents.map((d) => [d.voucherId, d.id]));
  const takenOverOf = (id: string): OpenLegacyItem["takenOver"] => {
    const invoiceId = invoiceBy.get(id);
    const documentId = documentBy.get(id);
    return invoiceId ? { kind: "invoice", id: invoiceId } : documentId ? { kind: "document", id: documentId } : null;
  };
  const candidates = vouchers
    .map((v) => {
      const issue = paymentHistoryIssue(v);
      const settled = issue ? settledOn({ ...v, payDate: sevPayDate(v.raw) }) : null;
      // Am Stichtag war die Rechnung noch eine Forderung; ihr Storno gehört dann in die Bücher von Haben
      const cancelledLater = v.payment?.history === "storno" && v.date <= cutoff && v.payment.cancelledOn! > cutoff;
      // Vor dem Stichtag ausgeglichen (oder heute ausgeglichen bei Belegen danach): sicher bezahlt, nichts offen
      const state = cancelledLater
        ? { open: Math.abs(v.gross), paidAfter: 0, issue: "Storno nach dem Stichtag" }
        : settled && (settled <= cutoff || v.date > cutoff)
          ? { open: 0, paidAfter: 0, issue: null }
          : issue
            ? { open: Math.abs(v.payment?.openAmount ?? v.gross), paidAfter: 0, issue }
            : legacyOpenAt(v, v.date <= cutoff ? cutoff : TODAY_STATE);
      return { voucher: v, state, takenOver: takenOverOf(v.id) };
    })
    // Ein Posten ohne offenen Betrag und ohne Problem ist kein offener Posten — auch dann nicht, wenn er
    // schon übernommen wurde. Sonst füllt eine vollständig bezahlte Altdatenbank die Tabelle mit 0,00-Zeilen.
    .filter((c) => (c.state.open > 0 || c.state.issue) && (c.takenOver || OPEN_ITEM_TYPES.has(c.voucher.type)));
  if (candidates.length === 0) return [];
  const files = await db
    .selectDistinct({ voucherId: schema.lexofficeVoucherFiles.voucherId })
    .from(schema.lexofficeVoucherFiles)
    .where(
      and(
        inArray(
          schema.lexofficeVoucherFiles.voucherId,
          candidates.map((c) => c.voucher.id),
        ),
        inArray(schema.lexofficeVoucherFiles.role, ["pdf", "anhang"]),
      ),
    );
  const withFile = new Set(files.map((f) => f.voucherId));
  const journalCovered = new Set(
    (
      await db.execute<{ id: string }>(sql`select i.voucher_id as id from external_imports i
    where i.kind='invoice' and exists (select 1 from external_imports j where j.source=i.source and j.kind='journal')`)
    ).map((r) => r.id),
  );
  return candidates.map(({ voucher: v, state, takenOver }) => ({
    id: v.id,
    source: v.source,
    type: v.type,
    direction: v.direction,
    number: v.number,
    date: v.date,
    dueDate: v.dueDate,
    contactName: v.contactName,
    gross: v.gross,
    open: state.open,
    openKnown: state.issue === null,
    paidAfter: v.date <= cutoff ? state.paidAfter : 0,
    takenOver,
    blocker:
      blockerFor(v, state, cutoff, withFile.has(v.id)) ??
      (!takenOver && journalCovered.has(v.id)
        ? "Quelljournal bereits übernommen: Forderungen und Verbindlichkeiten vor einer weiteren Eröffnungsbuchung abgleichen."
        : v.source === "import" && !v.dueDate
          ? "Fälligkeit fehlt im Original; vor der nativen Übernahme klären."
          : !takenOver && SALES.has(v.type)
            ? taxProblem(v)
            : null),
  }));
}

const taxProblem = (v: LegacyVoucher) => {
  const tax = importedTaxTreatment(v);
  return "problem" in tax ? tax.problem : null;
};

/** Kategorie aus Lexoffice grob auf die Ausgabenkategorie von Haben abbilden; sie zählt nur für die EÜR-Aufteilung */
const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/bewirtung/i, "bewirtung"],
  // Nur abziehbare Geschenke; „Geschenke über 50 €“ bzw. „nicht abzugsfähig“ fallen nicht darunter
  [/^(?!.*(über|nicht abz)).*geschenk/i, "geschenke"],
  [/software|lizenz/i, "software"],
  [/hosting|server|cloud|edv|it-/i, "edv"],
  [/hardware|gwg|geringwertig/i, "hardware"],
  [/telefon|mobilfunk/i, "telefon"],
  [/internet/i, "internet"],
  [/büro|buero/i, "buero"],
  [/literatur|zeitschrift|bücher/i, "literatur"],
  [/fortbildung|seminar|weiterbildung/i, "fortbildung"],
  [/übernachtung|hotel/i, "uebernachtung"],
  [/reise|fahrt|bahn|taxi/i, "fahrtkosten"],
  [/porto|versand/i, "porto"],
  [/werbung|marketing/i, "werbung"],
  [/buchführung|buchhaltung|steuerberat/i, "buchfuehrung"],
  [/beratung|rechts/i, "beratung"],
  [/wareneingang|wareneinkauf|handelsware|\bwaren\b/i, "wareneinkauf"],
  [/fremdleistung|subunternehm/i, "fremdleistung"],
  [/kontoführung|gebühr|nebenkosten des geldverkehrs/i, "geldverkehr"],
  [/versicherung/i, "versicherung"],
  [/beitr/i, "beitraege"],
];

function categoryFor(categories: LegacyCategoryRow[]): ExpenseCategory {
  const names = categories.map((c) => c.name).join(" ");
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(names))?.[1] ?? "sonstiges";
}

/**
 * Übernimmt einen offenen Posten aus Lexoffice oder sevDesk, damit der Zahlungseingang bzw. die Zahlung im Bankabgleich
 * zugeordnet werden kann: Rechnungen mit Original-PDF und bisheriger Nummer, Belege gebucht und gesperrt.
 * Gebucht wird gegen den Saldenvortrag, nicht als Erlös oder Aufwand; die stehen schon in den alten Büchern. Datum ist der
 * Tag nach dem Stichtag, der erste Tag in Haben, nicht der Tag der Übernahme.
 * Steht schon eine Eröffnung aus dem DATEV-Stapel nach dem Belegdatum, enthält ihr Saldo der Forderungen bzw.
 * Verbindlichkeiten den Posten bereits; dann legt die Übernahme nur Rechnung bzw. Beleg für den Bankabgleich an und bucht
 * nicht noch einmal gegen 9000.
 */
export async function takeOverLegacyItem(
  actor: string,
  voucherId: string,
  requestedCutoff?: string | null,
): Promise<{ kind: "invoice" | "document"; id: string }> {
  const cutoff = await shownCutoff(requestedCutoff);
  const items = await itemsAt(cutoff.date);
  const item = items.find((i) => i.id === voucherId);
  if (!item) throw new TakeoverError("Dieser Beleg ist in der bisherigen Buchhaltung nicht offen.");
  if (item.takenOver) throw new TakeoverError("Schon übernommen.");
  if (item.blocker) throw new TakeoverError(`Nicht übernehmbar: ${item.blocker}.`);
  return takeOver(actor, item, cutoff);
}

async function takeOver(actor: string, item: OpenLegacyItem, cutoff: TakeoverCutoff): Promise<{ kind: "invoice" | "document"; id: string }> {
  const [voucher] = await db
    .select({
      ...getTableColumns(schema.lexofficeVouchers),
      contactName: effectiveContactName("lexoffice_vouchers"),
      taxes: effectiveTaxes("lexoffice_vouchers"),
    })
    .from(schema.lexofficeVouchers)
    .where(eq(schema.lexofficeVouchers.id, item.id));
  const files = await db.select().from(schema.lexofficeVoucherFiles).where(eq(schema.lexofficeVoucherFiles.voucherId, item.id));
  return item.direction === "einnahme" ? takeOverInvoice(actor, voucher!, files, cutoff) : takeOverDocument(actor, voucher!, files, cutoff);
}

/**
 * Sperrt wie die Eröffnung (stapelOpeningCovering) und liefert die Eröffnung aus dem Stapel, die den Posten enthält.
 * Hat inzwischen jemand eine Eröffnung gebucht, die den Stichtag verschiebt, bricht die Übernahme ab, statt an einem
 * anderen Tag zu buchen als angezeigt.
 */
async function lockedCovering(tx: Tx, voucher: LegacyVoucher, cutoff: TakeoverCutoff) {
  if (voucher.source === "import") {
    const [origin] = await tx
      .select({ source: schema.externalImports.source })
      .from(schema.externalImports)
      .where(eq(schema.externalImports.voucherId, voucher.id));
    if (!origin) throw new TakeoverError("Herkunftsnachweis des Betreiberimports fehlt.");
    // Derselbe Quell-Lock wie der Paketimport: keine parallele Eröffnung neben einem nachgereichten Journal.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`external-import:${origin.source}`}, 0))`);
    const [journal] = await tx
      .select({ id: schema.externalImports.id })
      .from(schema.externalImports)
      .where(and(eq(schema.externalImports.source, origin.source), eq(schema.externalImports.kind, "journal")))
      .limit(1);
    if (journal) throw new TakeoverError("Quelljournal bereits übernommen: Vor einer weiteren Eröffnungsbuchung abgleichen.");
    if (!voucher.dueDate) throw new TakeoverError("Fälligkeit fehlt im Original; vor der nativen Übernahme klären.");
  }
  const covering = await stapelOpeningCovering(tx, voucher.date);
  const current = await legacyTakeoverCutoff(cutoff.fixed ? null : cutoff.date, tx);
  if (current.date !== cutoff.date) throw new TakeoverError("Der Stichtag hat sich inzwischen geändert. Bitte die Seite neu laden.");
  return covering;
}

async function takeOverInvoice(
  actor: string,
  voucher: LegacyVoucher,
  files: (typeof schema.lexofficeVoucherFiles.$inferSelect)[],
  cutoff: TakeoverCutoff,
): Promise<{ kind: "invoice"; id: string }> {
  const pdfFile = files.find((f) => f.role === "pdf") ?? files.find((f) => f.mimeType === "application/pdf");
  if (!pdfFile) throw new TakeoverError("Zu dieser Rechnung fehlt das PDF.");
  const xmlFile = files.find((f) => f.role === "xml");
  const pdf = await loadFile(pdfFile.sha256);
  const xml = xmlFile ? (await loadFile(xmlFile.sha256)).toString("utf8") : null;
  const tax = importedTaxTreatment(voucher);
  if ("problem" in tax) throw new TakeoverError(tax.problem);
  const taxTreatment = tax.treatment;

  // Eine Position je Steuersatz. Die Summen müssen exakt zu Lexoffice passen, sonst stimmt die Steuer nicht,
  // auch nicht bei einem späteren Storno: erst netto nachbilden, sonst brutto (in Lexoffice mit Endpreisen gerechnet)
  const taxes = voucher.taxes.filter((t) => t.net !== 0);
  const rebuild = (priceMode: PriceMode) => {
    const lines = taxes.map((t, i) => ({
      position: i + 1,
      description: `Rechnung ${voucher.number} aus ${SOURCE_LABEL[voucher.source]}${taxes.length > 1 ? ` (${t.rate / 100} %)` : ""}`,
      quantity: 1000,
      unit: "Psch.",
      unitPrice: priceMode === "brutto" ? t.net + t.tax : t.net,
      taxRate: t.rate as 1900 | 700 | 0,
    }));
    const { totals, lineNets } = computeInvoice(lines, priceMode);
    return { priceMode, totals, lines: lines.map((l, i) => ({ ...l, net: lineNets[i]! })) };
  };
  const matches = (r: ReturnType<typeof rebuild>) => r.totals.gross === voucher.gross && r.totals.tax === voucher.tax;
  const netto = rebuild("netto");
  const { priceMode, totals, lines } = matches(netto) ? netto : rebuild("brutto");
  if (totals.gross !== voucher.gross || totals.tax !== voucher.tax) {
    throw new TakeoverError(
      `Die Steuer lässt sich nicht centgenau nachbilden (${SOURCE_LABEL[voucher.source]} ${voucher.tax / 100} €, Haben ${netto.totals.tax / 100} €).`,
    );
  }

  return withActor(actor, async (tx) => {
    const covering = await lockedCovering(tx, voucher, cutoff);
    const company = await openBooks(tx);
    // Kz 45 meldet Haben auch bei Ist mit der Rechnung (NACH_RECHNUNGSDATUM), das Quellprogramm bei Ist mit der Zahlung
    // (legacy-vat.ts). Eine am Stichtag offene Drittlandsleistung stünde so in keiner Voranmeldung.
    if (taxTreatment === "drittland" && company.versteuerung === "ist")
      throw new TakeoverError(
        "Leistung ins Drittland bei Ist-Versteuerung: Kz 45 meldet das Quellprogramm mit der Zahlung, Haben mit der Rechnung. Den Posten von Hand erfassen.",
      );
    if (voucher.number) {
      const [clash] = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.number, voucher.number));
      if (clash) throw new TakeoverError(`Die Rechnungsnummer ${voucher.number} gibt es in Haben schon.`);
    }
    let [contact] = voucher.contactId ? await tx.select().from(schema.contacts).where(eq(schema.contacts.id, voucher.contactId)) : [];
    if (!contact) {
      const raw = voucher.raw as { address?: { name?: string; street?: string; zip?: string; city?: string; countryCode?: string } };
      [contact] = await tx
        .insert(schema.contacts)
        .values({
          name: raw.address?.name || voucher.contactName || "Unbekannt",
          strasse: raw.address?.street ?? "",
          plz: raw.address?.zip ?? "",
          ort: raw.address?.city ?? "",
          land: raw.address?.countryCode ?? "DE",
        })
        .returning();
    }
    const dueDate = voucher.dueDate ?? addDays(voucher.date, 14);
    const term = Math.max(0, Math.min(365, Math.round((Date.parse(dueDate) - Date.parse(voucher.date)) / 86_400_000)));
    const [invoice] = await tx
      .insert(schema.invoices)
      .values({
        kind: "rechnung",
        contactId: contact!.id,
        issueDate: voucher.date,
        serviceFrom: voucher.serviceFrom,
        serviceTo: voucher.serviceTo,
        paymentTermDays: term,
        dueDate,
        note: `Aus ${SOURCE_LABEL[voucher.source]} übernommen; das PDF ist das Original.`,
        priceMode,
        taxTreatment,
        net: totals.net,
        tax: totals.tax,
        gross: totals.gross,
      })
      .returning({ id: schema.invoices.id });
    const id = invoice!.id;
    await tx.insert(schema.invoiceLines).values(lines.map((l) => ({ ...l, invoiceId: id })));
    await storeInvoiceTaxes(tx, id, totals.taxes);
    const now = new Date();
    await tx
      .update(schema.invoices)
      .set({
        status: "final",
        number: voucher.number || (voucher.source === "sevdesk" ? `SD-${voucher.lexofficeId.split("/").pop()}` : `LX-${voucher.lexofficeId.slice(0, 8)}`),
        contactVersion: contact!.version,
        seller: sellerFrom(company),
        buyer: buyerFrom(contact!),
        pdf: Buffer.from(pdf),
        pdfSha256: pdfFile.sha256,
        xml,
        xmlSha256: xml ? createHash("sha256").update(xml).digest("hex") : null,
        lexofficeVoucherId: voucher.id,
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, id));
    if (!covering)
      await post(tx, company, {
        date: cutoff.bookingDate,
        description: `Offene Rechnung ${voucher.number} aus ${SOURCE_LABEL[voucher.source]} · ${contact!.name}`,
        sourceType: "invoice",
        sourceId: id,
        lines: openingInvoicePosting(totals, company.kontenrahmen, company.versteuerung),
      });
    return { kind: "invoice" as const, id };
  });
}

async function takeOverDocument(
  actor: string,
  voucher: LegacyVoucher,
  files: (typeof schema.lexofficeVoucherFiles.$inferSelect)[],
  cutoff: TakeoverCutoff,
): Promise<{ kind: "document"; id: string }> {
  const file = files.find((f) => f.mimeType === "application/pdf") ?? files[0];
  if (!file) throw new TakeoverError("Zu diesem Beleg fehlt die Datei.");
  return withActor(actor, async (tx) => {
    const covering = await lockedCovering(tx, voucher, cutoff);
    const company = await openBooks(tx);
    const [existing] = await tx.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.sha256, file.sha256));
    if (existing) throw new TakeoverError("Die Datei liegt in Haben schon als Beleg; bitte dort bezahlen.");
    const now = new Date();
    const [doc] = await tx
      .insert(schema.documents)
      .values({
        sha256: file.sha256,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        extractedBy: "manuell",
        supplierName: voucher.contactName,
        invoiceNumber: voucher.number,
        documentDate: voucher.date,
        dueDate: voucher.dueDate,
        category: categoryFor(voucher.categories),
        payment: "bank",
        note: `Aus ${SOURCE_LABEL[voucher.source]} übernommen; die Vorsteuer ist dort schon angemeldet.`,
        net: voucher.net,
        tax: voucher.tax,
        gross: voucher.gross,
        lexofficeVoucherId: voucher.id,
      })
      .returning({ id: schema.documents.id });
    const id = doc!.id;
    await tx.insert(schema.documentAmounts).values(voucher.taxes.map((t) => ({ documentId: id, taxRate: t.rate, net: t.net, tax: t.tax })));
    if (!covering)
      await post(tx, company, {
        date: cutoff.bookingDate,
        description: `Offener Beleg ${voucher.number || file.filename} aus ${SOURCE_LABEL[voucher.source]} · ${voucher.contactName}`,
        sourceType: "document",
        sourceId: id,
        lines: openingDocumentPosting(voucher.gross, company.kontenrahmen),
      });
    await tx.update(schema.documents).set({ status: "gebucht", lockedAt: now, updatedAt: now }).where(eq(schema.documents.id, id));
    return { kind: "document" as const, id };
  });
}

/** Alle übernehmbaren offenen Posten auf einmal; Fehler einzelner Posten kommen zurück */
export async function takeOverAll(actor: string, requestedCutoff?: string | null) {
  const cutoff = await shownCutoff(requestedCutoff);
  const items = (await itemsAt(cutoff.date)).filter((i) => !i.takenOver && !i.blocker);
  const results: { number: string; error?: string }[] = [];
  for (const item of items) {
    try {
      await takeOver(actor, item, cutoff);
      results.push({ number: item.number });
    } catch (error) {
      if (!(error instanceof TakeoverError)) throw error;
      results.push({ number: item.number, error: error.message });
    }
  }
  return results;
}
