import { legalInfo } from "@haben/core";
import { legalLine } from "@haben/einvoice";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { listArticles } from "./articles.ts";
import { backgroundInfo } from "./background.ts";
import { letterIssues, loadCompany, sellerIssues } from "./company.ts";
import { contactPersonOptions } from "./contact-persons.ts";
import { listContacts } from "./contacts.ts";
import { loadDesign } from "./letterhead.ts";
import { logoInfo } from "./logo.ts";
import { mandateOptions } from "./sepa-mandate.ts";
import { listTextBlocks } from "./text-blocks.ts";
import { listUnits } from "./units.ts";

/** Gemeinsame Daten für den Rechnungs- und den Angebotseditor, mit der letzten vergebenen Nummer je Jahr */
export async function editorContext(kind: "rechnung" | "angebot") {
  const [company, counters, contacts, articles, textBlocks, logo, background, design, mandates, contactPersons, units] = await Promise.all([
    loadCompany(),
    kind === "rechnung" ? db.select().from(schema.invoiceNumberCounters) : db.select().from(schema.quoteNumberCounters),
    listContacts(),
    listArticles(),
    listTextBlocks(),
    logoInfo(),
    backgroundInfo(),
    loadDesign(),
    kind === "rechnung" ? mandateOptions(today()) : Promise.resolve([]),
    contactPersonOptions(),
    listUnits(),
  ]);
  const { name, strasse, plz, ort, email, telefon, steuernummer, ustId, iban, bic, bank, kontoinhaber } = company;
  return {
    contacts,
    /** Gültige Lastschriftmandate je Kunde (#445), für die Zahlungsart der Rechnung */
    mandates,
    /** Ansprechpartner aller Kunden (#424), für die Auswahl unter „Kunde“ */
    contactPersons,
    articles: articles.map(({ id, number, description, detail, unit, unitPrice, taxRate, priceIncludesTax }) => ({
      id,
      number,
      description,
      detail,
      unit,
      unitPrice,
      taxRate,
      priceIncludesTax,
    })),
    textBlocks: textBlocks.map(({ id, name, kind, text, contactId }) => ({ id, name, kind, text, contactId })),
    /** Eigene Einheiten (#748) für die Auswahl in den Positionen, ohne archivierte */
    units: units.filter((unit) => !unit.archivedAt).map((unit) => unit.label),
    company: {
      name,
      strasse,
      plz,
      ort,
      email,
      telefon,
      steuernummer,
      ustId,
      iban,
      bic,
      bank,
      kontoinhaber,
      logo: logo?.sha256 ?? null,
      background: background?.sha256 ?? null,
      accent: design.accent,
      design,
      legal: legalLine(legalInfo(company)),
    },
    sellerIssues: sellerIssues(company),
    letterIssues: letterIssues(company),
    bundesland: company.bundesland,
    kleinunternehmer: company.kleinunternehmer,
    tageskurs: company.tageskurs,
    /** Skonto-Vorgabe für Kunden ohne eigenes */
    companySkonto: company.skonto,
    /** Vorlagen für den Zahlungsplan im Angebot */
    planTemplates: company.paymentPlanTemplates,
    numberFormat: kind === "rechnung" ? company.invoiceNumberFormat : company.quoteNumberFormat,
    /** Letzte Nummer je Kreis: Jahr, 0 = durchlaufender Zähler */
    numberCounters: Object.fromEntries(counters.map((c) => [c.year, c.last])) as Record<number, number>,
    numberRunning: kind === "rechnung" ? company.invoiceCounterRunning : company.quoteCounterRunning,
  };
}
