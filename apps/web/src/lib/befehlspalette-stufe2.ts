import { BESCHAEFTIGUNGSARTEN, DARLEHENSGEBER, formatEuro, PAUSCHALE_LABEL, periodKey } from "@haben/core";
import type { PaletteItem, PaletteSection } from "./befehlspalette.ts";
import { ELSTER_KIND_LABEL } from "./elster.ts";
import { formatDate } from "./format.ts";
import type { CommandPaletteResult } from "../server/functions/search.ts";

function intervalLabel(months: number): string {
  if (months === 1) return "monatlich";
  if (months === 3) return "vierteljährlich";
  if (months === 6) return "halbjährlich";
  return "jährlich";
}

function periodLabel(year: number, month: number): string {
  return month >= 41 && month <= 44 ? `Q${month - 40} ${year}` : `${String(month).padStart(2, "0")}/${year}`;
}

function bookingTarget(sourceType: string, sourceId: string): { to: string; params?: Record<string, string> } {
  if (sourceType === "invoice") return { to: "/rechnungen/$id", params: { id: sourceId } };
  if (sourceType === "document") return { to: "/belege/$id", params: { id: sourceId } };
  return { to: "/buchungen" };
}

function buildBankAndLedgerSections(remote: CommandPaletteResult, inhaber: boolean): PaletteSection[] {
  const sections: PaletteSection[] = [];
  if (inhaber && remote.bankTransactions.hits.length > 0) {
    sections.push({
      id: "bank",
      label: "Bankumsätze",
      // Über alle Konten: auch wenn die ersten Treffer in einem liegen, können weitere in anderen stehen
      to: "/bank",
      moreSearch: { konto: "alle", filter: "alle" },
      items: remote.bankTransactions.hits.map((tx) => ({
        id: `bank-${tx.id}`,
        kind: "link",
        title: tx.counterpartyName || tx.purpose || "Bankumsatz",
        meta: [formatDate(tx.bookingDate), tx.accountName, tx.ibanLast4 ? `… ${tx.ibanLast4}` : ""].filter(Boolean).join(" · "),
        amount: formatEuro(tx.amount),
        status: { kind: "bank", tx: { hint: tx.hint, open: tx.open } },
        icon: "bank",
        to: "/bank",
        search: { konto: tx.bankAccountId, filter: "alle", umsatz: tx.id },
      })),
    });
  }
  if (remote.bookings.hits.length > 0) {
    sections.push({
      id: "buchungen",
      label: "Buchungen",
      items: remote.bookings.hits.map((b) => {
        const target = bookingTarget(b.sourceType, b.sourceId);
        return {
          id: `booking-${b.id}`,
          kind: "link",
          title: b.description || "Buchung",
          meta: [formatDate(b.date), b.accounts, b.reversed ? "storniert" : ""].filter(Boolean).join(" · "),
          amount: formatEuro(b.amount),
          icon: "journal",
          ...target,
        };
      }),
    });
  }
  if (remote.accounts.hits.length > 0) {
    sections.push({
      id: "konten",
      label: "Konten",
      items: remote.accounts.hits.map((a) => ({
        id: `account-${a.account}`,
        kind: "link",
        title: `${a.account} ${a.name}`,
        meta: a.kontenrahmen,
        icon: "book",
        to: "/konten/$konto",
        params: { konto: a.account },
      })),
    });
  }
  return sections;
}

function buildRecurringAndCatalogSections(remote: CommandPaletteResult): PaletteSection[] {
  const sections: PaletteSection[] = [];
  const recurring: PaletteItem[] = [
    ...remote.recurringInvoices.hits.map(
      (ri): PaletteItem => ({
        id: `rec-inv-${ri.id}`,
        kind: "link",
        title: ri.name,
        meta: [ri.customer, intervalLabel(ri.intervalMonths), `nächster Termin ${formatDate(ri.nextDate)}`].join(" · "),
        icon: "invoice",
        to: "/rechnungen/wiederkehrend/$id",
        params: { id: ri.id },
        status: { kind: "recurringInvoice", active: ri.active, lastError: ri.lastError },
      }),
    ),
    ...remote.recurringDocuments.hits.map(
      (rd): PaletteItem => ({
        id: `rec-doc-${rd.id}`,
        kind: "link",
        title: rd.name,
        meta: [rd.supplierName, intervalLabel(rd.intervalMonths), `nächster Termin ${formatDate(rd.nextDate)}`].join(" · "),
        icon: "calendar",
        to: "/dauerbelege/$id",
        params: { id: rd.id },
        status: { kind: "recurringDocument", status: rd.status, lastError: rd.lastError },
      }),
    ),
  ];
  if (recurring.length > 0) sections.push({ id: "wiederkehrend", label: "Wiederkehrende Vorgänge", items: recurring });

  const catalog: PaletteItem[] = [
    ...remote.articles.hits.map(
      (a): PaletteItem => ({
        id: `article-${a.id}`,
        kind: "link",
        title: a.description,
        meta: [a.number, a.unit].filter(Boolean).join(" · "),
        amount: formatEuro(a.unitPrice),
        icon: "article",
        to: "/artikel",
      }),
    ),
    ...remote.textBlocks.hits.map(
      (tb): PaletteItem => ({
        id: `textblock-${tb.id}`,
        kind: "link",
        title: tb.name,
        meta: tb.kind === "kopf" ? "Kopftext" : "Fußtext",
        icon: "textblock",
        to: "/textbausteine",
      }),
    ),
    ...remote.serviceEntries.hits.map(
      (se): PaletteItem => ({
        id: `service-${se.id}`,
        kind: "link",
        title: se.description || se.project || "Leistung",
        meta: [se.customer, formatDate(se.workedOn), `${se.minutes} Min.`].filter(Boolean).join(" · "),
        icon: "calendar",
        to: "/leistungen",
      }),
    ),
  ];
  if (catalog.length > 0) sections.push({ id: "katalog", label: "Artikel, Textbausteine & Leistungen", items: catalog });
  return sections;
}

function buildAssetsAndCashSections(remote: CommandPaletteResult): PaletteSection[] {
  const sections: PaletteSection[] = [];
  const assetsLoans: PaletteItem[] = [
    ...remote.assets.hits.map(
      (a): PaletteItem => ({
        id: `asset-${a.id}`,
        kind: "link",
        title: a.name,
        meta: [`Konto ${a.account}`, formatDate(a.acquisitionDate)].join(" · "),
        amount: formatEuro(a.cost),
        icon: "assets",
        to: "/anlagen/$id",
        params: { id: a.id },
      }),
    ),
    ...remote.loans.hits.map(
      (l): PaletteItem => ({
        id: `loan-${l.id}`,
        kind: "link",
        title: l.name,
        meta: [DARLEHENSGEBER[l.lender], l.openingDate ? formatDate(l.openingDate) : ""].filter(Boolean).join(" · "),
        amount: formatEuro(l.balance),
        icon: "bank",
        to: "/darlehen",
      }),
    ),
  ];
  if (assetsLoans.length > 0) sections.push({ id: "anlagen", label: "Anlagen & Darlehen", items: assetsLoans });

  const cashPauschalen: PaletteItem[] = [
    ...remote.cashEntries.hits.map(
      (ce): PaletteItem => ({
        id: `cash-${ce.id}`,
        kind: "link",
        title: ce.text || `Kasse #${ce.number}`,
        meta: [`Nr. ${ce.number}`, formatDate(ce.date), ce.reversed ? "storniert" : ""].filter(Boolean).join(" · "),
        amount: formatEuro(ce.amount),
        icon: "cash",
        to: "/kasse",
      }),
    ),
    ...remote.pauschalen.hits.map(
      (p): PaletteItem => ({
        id: `pauschale-${p.id}`,
        kind: "link",
        title: p.description,
        meta: [PAUSCHALE_LABEL[p.art], formatDate(p.date)].join(" · "),
        amount: formatEuro(p.amount),
        icon: "pauschale",
        to: "/pauschalen",
        status: { kind: "pauschale", storniert: p.storniert },
      }),
    ),
  ];
  if (cashPauschalen.length > 0) sections.push({ id: "kasse", label: "Kasse & Pauschalen", items: cashPauschalen });
  return sections;
}

function buildTaxAndArchiveSections(remote: CommandPaletteResult): PaletteSection[] {
  const sections: PaletteSection[] = [];
  if (remote.employees.hits.length > 0) {
    sections.push({
      id: "mitarbeiter",
      label: "Mitarbeiter",
      items: remote.employees.hits.map((e) => ({
        id: `employee-${e.id}`,
        kind: "link",
        title: `${e.vorname} ${e.nachname}`,
        meta: [`Personalnr. ${e.personalnummer}`, BESCHAEFTIGUNGSARTEN[e.art]].join(" · "),
        icon: "badge",
        to: "/lohn/mitarbeiter/$id",
        params: { id: e.id },
      })),
    });
  }

  const taxItems: PaletteItem[] = [
    ...remote.vatReturns.hits.map(
      (v): PaletteItem => ({
        id: `vat-${v.id}`,
        kind: "link",
        title: `USt-VA ${periodLabel(v.year, v.month)}`,
        meta: "Voranmeldung",
        icon: "vat",
        to: "/umsatzsteuer/$zeitraum",
        params: { zeitraum: periodKey(v) },
        status: { kind: "vat", vat: v },
      }),
    ),
    ...remote.zmSubmissions.hits.map(
      (z): PaletteItem => ({
        id: `zm-${z.id}`,
        kind: "link",
        title: `ZM ${periodLabel(z.year, z.month)}`,
        meta: ELSTER_KIND_LABEL[z.kind],
        icon: "vat",
        to: "/umsatzsteuer/zm/$quartal",
        params: { quartal: periodKey(z) },
        status: { kind: "zm", ok: z.ok, code: z.code },
      }),
    ),
    ...remote.postfachDocuments.hits.map(
      (pd): PaletteItem => ({
        id: `postfach-${pd.id}`,
        kind: "link",
        title: pd.dateibezeichnung,
        meta: [pd.veranlagungszeitraum, pd.bescheiddatum].filter(Boolean).join(" · "),
        icon: "mail",
        to: "/finanzamt",
      }),
    ),
  ];
  if (taxItems.length > 0) sections.push({ id: "finanzamt", label: "Finanzamt & Meldungen", items: taxItems });

  if (remote.archive.hits.length > 0) {
    sections.push({
      id: "archiv",
      label: "Archiv aus dem Umzug",
      items: remote.archive.hits.map((a) => ({
        id: `archive-${a.target}-${a.id}`,
        kind: "link",
        title: a.number || a.contactName || "Archivbeleg",
        meta: [a.contactName, formatDate(a.date), "Archiv"].filter(Boolean).join(" · "),
        amount: a.gross === null ? undefined : formatEuro(a.gross),
        icon: "receipt",
        to: a.target === "auftrag" ? "/archiv/auftrag/$id" : "/archiv/beleg/$id",
        params: { id: a.id },
      })),
    });
  }
  return sections;
}

export function buildStufe2Sections(remote: CommandPaletteResult, inhaber: boolean): PaletteSection[] {
  return [
    ...buildBankAndLedgerSections(remote, inhaber),
    ...(inhaber ? buildRecurringAndCatalogSections(remote) : []),
    ...(inhaber ? buildAssetsAndCashSections(remote) : []),
    ...(inhaber ? buildTaxAndArchiveSections(remote) : []),
  ];
}
