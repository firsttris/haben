import type { CSSProperties } from "react";
import {
  accentPalette,
  alternativeMain,
  computeInvoice,
  DEFAULT_OPTIONS,
  discountedLineAmount,
  discountLabel,
  formatEuro,
  formatPercent,
  formatQuantity,
  formatRate,
  lineAmount,
  lineDiscountAmount,
  LOGO_SIZES,
  planShareLabel,
  distinctVatRates,
  LETTERHEAD_FONTS,
  showsVatColumn,
  skontoFristen,
  type Discount,
  type InvoiceLineInput,
  type LetterheadDesign,
  type PriceMode,
  type QuoteLineKind,
  type ScheduledRow,
  type SkontoStufe,
} from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { KIND_TITLE } from "../lib/invoice.ts";
import { FormattedText } from "./FormattedText.tsx";
import { SheetFooter } from "./SheetFooter.tsx";

export interface PreviewSeller {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
  telefon?: string;
  steuernummer: string;
  ustId: string;
  iban: string;
  bic: string;
  bank: string;
  /** Leer = Firmenname */
  kontoinhaber?: string;
  /** GmbH und UG: Pflichtangaben nach § 35a GmbHG als eine Zeile unter den Spalten, wie im PDF */
  legal?: string | null;
  /** SHA-256 des Logos, wenn eines hinterlegt ist */
  logo?: string | null;
  /** SHA-256 des Briefpapiers, wenn eines hinterlegt ist */
  background?: string | null;
  /** Akzentfarbe #RRGGBB aus den Einstellungen; fehlt = Standardgrün aus styles.css */
  accent?: string;
  /** Gestaltung aus dem Profil oder dem Panel, noch ungespeichert; fehlt = Vorgaben */
  design?: LetterheadDesign;
}

export interface PreviewBuyer {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  kundennummer?: string | null;
}

/** Akzentfarbe und die daraus abgeleiteten Grautöne wie im PDF (accentPalette) */
function sheetColors(accent: string): CSSProperties {
  const { ink, muted, rule } = accentPalette(accent);
  return { "--brand": accent, "--ink": ink, "--ink-muted": muted, "--rule": rule } as CSSProperties;
}

/** Position der Vorschau mit Rabatt und (im Angebot) Art; Abzüge der Schlussrechnung zählen nicht zum Gesamtrabatt */
export type PreviewLine = InvoiceLineInput & {
  detail?: string;
  valid: boolean;
  discount?: Discount | null;
  kind?: QuoteLineKind | null;
  deductionOf?: string;
};

/** Text unter der Bezeichnung wie im PDF: „abzüglich 10 % Rabatt (95,00 €)“ */
function lineDiscountText(line: PreviewLine, money: (cents: number) => string): string | null {
  if (!line.discount) return null;
  const amount = Math.abs(lineDiscountAmount(lineAmount(line.quantity, line.unitPrice), line.discount));
  return `abzüglich ${discountLabel(line.discount)} Rabatt${line.discount.kind === "prozent" ? ` (${money(amount)})` : ""}`;
}

/** HTML-Abbild des PDFs für den Editor; das verbindliche Dokument rendert Typst. */
export function InvoicePreview({
  kind,
  number,
  issueDate,
  dueDate,
  validUntil = null,
  serviceFrom,
  serviceTo,
  seller,
  buyer,
  lines,
  intro = "",
  note,
  priceMode = "netto",
  taxNote,
  needsVatId = false,
  corrects,
  title,
  currency = "EUR",
  skonto = [],
  discount = null,
  plan = [],
}: {
  kind: keyof typeof KIND_TITLE;
  number: string;
  issueDate: string;
  dueDate: string;
  /** Nur beim Angebot */
  validUntil?: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  seller: PreviewSeller;
  buyer: PreviewBuyer | null;
  lines: PreviewLine[];
  /** Einleitung über den Positionen */
  intro?: string;
  note: string;
  /** Bruttopreise: letzte Spalte brutto, unter dem Gesamtbetrag „darin enthalten“ */
  priceMode?: PriceMode;
  /** Pflichthinweis bei Rechnungen ohne Steuerausweis; dann keine Steuerspalte */
  taxNote?: string | null;
  /** Reverse Charge oder innergemeinschaftliche Lieferung: Die USt-IdNr. muss in den Fuß (§ 14a UStG) */
  needsVatId?: boolean;
  corrects?: { number: string | null; issueDate: string } | null;
  /** Abweichender Titel, z. B. Abschlagsrechnung */
  title?: string;
  /** Währung der Rechnung; Beträge in dieser Währung wie auf dem PDF */
  currency?: string;
  /** Skontostufen der Rechnung; der Satz dazu wie im PDF (paymentSentence in @haben/einvoice) */
  skonto?: SkontoStufe[];
  /** Gesamtrabatt */
  discount?: Discount | null;
  /** Zahlungsplan des Angebots mit Beträgen */
  plan?: ScheduledRow[];
}) {
  const money =
    currency === "EUR"
      ? formatEuro
      : (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
  const valid = lines.filter((l) => l.valid);
  const gross = priceMode === "brutto";
  // Optionale und alternative Positionen stehen zur Wahl und zählen nicht zur Summe
  const counted = valid.filter((l) => !l.kind);
  const { totals, allowances } = computeInvoice(counted, priceMode, discount);
  const reduction = allowances.reduce((s, a) => s + a.amount, 0);
  const subtotal = counted.reduce((s, l) => s + discountedLineAmount(l), 0);
  const positions = valid.map((l, i) => ({ position: i + 1, kind: l.kind ?? null }));
  const quote = kind === "angebot";
  const sender = [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`.trim()].filter(Boolean).join(" · ");
  const options = seller.design ?? DEFAULT_OPTIONS;
  const meta: [string, string][] = [
    [quote ? "Angebotsnummer" : "Rechnungsnummer", number],
    [quote ? "Angebotsdatum" : "Rechnungsdatum", formatDate(issueDate)],
  ];
  if (quote) meta.push(["Gültig bis", validUntil ? formatDate(validUntil) : "–"]);
  if (serviceFrom && serviceTo && serviceFrom !== serviceTo) {
    meta.push(["Leistungszeitraum", `${formatDate(serviceFrom)} – ${formatDate(serviceTo)}`]);
  } else if (serviceFrom || serviceTo) {
    meta.push(["Leistungsdatum", formatDate((serviceFrom ?? serviceTo)!)]);
  } else if (!quote) {
    meta.push(["Leistungsdatum", "entspricht Rechnungsdatum"]);
  }
  if (buyer?.kundennummer && options.customerNumber) meta.push(["Kundennummer", buyer.kundennummer]);
  // Wie im PDF: bei mehreren Steuersätzen steht die Bemessungsgrundlage dabei
  const taxes = taxNote ? [] : totals.taxes;
  const vatColumn = showsVatColumn(options.vatColumn, taxNote ? totals.taxes.length : distinctVatRates(valid));
  const logoSize = LOGO_SIZES[options.logoSize];
  // Wie im PDF (pdfData): GiroCode nur für Rechnungen mit Zahlbetrag in Euro und Konto; hier als Platzhalter gleicher Größe
  const giroCode = options.giroCode && kind === "rechnung" && currency === "EUR" && totals.gross > 0 && Boolean(seller.iban);
  const payment = quote
    ? `Dieses Angebot gilt bis zum ${validUntil ? formatDate(validUntil) : "…"}. Wir freuen uns auf Ihren Auftrag.`
    : totals.gross < 0
      ? "Der Betrag wird Ihnen erstattet."
      : totals.gross === 0
        ? "Es ist keine Zahlung erforderlich."
        : [
            `Bitte überweisen Sie den Betrag bis zum ${formatDate(dueDate)} unter Angabe der Rechnungsnummer.`,
            ...(kind === "rechnung" ? skontoFristen(skonto, issueDate, totals.gross) : []).map(
              (s) =>
                `Bei Zahlung bis zum ${formatDate(s.until)} gewähren wir ${formatPercent(s.percent)} Skonto (${money(s.amount)}); Sie überweisen dann ${money(s.payable)}.`,
            ),
          ].join(" ");
  // Maße in mm wie in templates/rechnung.typ (DIN 5008 Form B), über --mm auf die Breite skaliert
  return (
    <div className="sheet-frame">
      <div
        className="sheet"
        aria-label={quote ? "Vorschau des Angebots" : "Vorschau der Rechnung"}
        style={{
          ...(seller.accent ? sheetColors(seller.accent) : {}),
          fontFamily: `"${LETTERHEAD_FONTS[options.font].name}", var(--sans)`,
          ...(seller.background
            ? { backgroundImage: `url("/api/briefpapier?v=${seller.background.slice(0, 12)}")`, backgroundSize: "cover", backgroundPosition: "center" }
            : {}),
        }}
      >
        {options.foldMarks && (
          <>
            <span className="sheet-fold" style={{ top: "calc(105 * var(--mm))" }} />
            <span className="sheet-fold long" style={{ top: "calc(148.5 * var(--mm))" }} />
            <span className="sheet-fold" style={{ top: "calc(210 * var(--mm))" }} />
          </>
        )}
        {seller.logo && (
          <img
            className="sheet-logo"
            src={`/api/logo?v=${seller.logo.slice(0, 12)}`}
            alt="Logo"
            data-seite={options.logoPosition}
            style={{ maxHeight: `calc(${logoSize.height} * var(--mm))`, maxWidth: `calc(${logoSize.width} * var(--mm))` }}
          />
        )}
        <div className="sheet-address">
          <div className="sheet-sender">{sender || "[Absender]"}</div>
          {buyer ? (
            <div>
              {buyer.name}
              <br />
              {buyer.strasse}
              <br />
              {buyer.plz} {buyer.ort}
            </div>
          ) : (
            <div className="sheet-muted">[Kunde wählen]</div>
          )}
        </div>
        <dl className="sheet-meta">
          {meta.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="sheet-body">
          <div className="sheet-title">{title ?? KIND_TITLE[kind]}</div>
          {corrects && (
            <div className="sheet-muted">
              zur Rechnung {corrects.number} vom {formatDate(corrects.issueDate)}
            </div>
          )}
          {intro.trim() && (
            <p style={{ whiteSpace: "pre-wrap" }}>
              <FormattedText text={intro.trim()} />
            </p>
          )}
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Beschreibung</th>
                <th className="num">Menge</th>
                <th className="num">Einzelpreis</th>
                {vatColumn && <th className="num">USt</th>}
                <th className="num">{gross ? "Brutto" : "Netto"}</th>
              </tr>
            </thead>
            <tbody>
              {valid.map((line, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="desc">
                    {line.kind && (
                      <div className="sheet-tag">
                        {line.kind === "optional" ? "Optional" : `Alternative zu Pos. ${alternativeMain(positions, index + 1) ?? "?"}`}, nicht in der
                        Angebotssumme
                      </div>
                    )}
                    {line.detail || line.kind ? <strong>{line.description}</strong> : line.description}
                    {line.detail && (
                      <div className="sheet-muted" style={{ whiteSpace: "pre-wrap" }}>
                        <FormattedText text={line.detail} />
                      </div>
                    )}
                    {line.discount && <div className="sheet-muted">{lineDiscountText(line, money)}</div>}
                  </td>
                  <td className="num">
                    {formatQuantity(line.quantity)} {line.unit}
                  </td>
                  <td className="num">{money(line.unitPrice)}</td>
                  {vatColumn && <td className="num">{taxNote ? "–" : formatRate(line.taxRate)}</td>}
                  <td className="num">{money(discountedLineAmount(line))}</td>
                </tr>
              ))}
              {valid.length === 0 && (
                <tr>
                  <td />
                  <td className="sheet-muted" colSpan={vatColumn ? 5 : 4}>
                    [Positionen]
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <dl className="sheet-totals">
            {allowances.length > 0 && discount && (
              <>
                <dt>Zwischensumme</dt>
                <dd>{money(subtotal)}</dd>
                <dt>Gesamtrabatt{discount.kind === "prozent" && ` ${discountLabel(discount)}`}</dt>
                <dd>−{money(reduction)}</dd>
              </>
            )}
            {!gross && (
              <>
                <dt>Summe netto</dt>
                <dd>{money(totals.net)}</dd>
                {taxes.map((t) => (
                  <div key={t.rate} style={{ display: "contents" }}>
                    <dt>
                      Umsatzsteuer {formatRate(t.rate)}
                      {taxes.length > 1 && ` auf ${money(t.base)}`}
                    </dt>
                    <dd>{money(t.tax)}</dd>
                  </div>
                ))}
              </>
            )}
            <dt className="gross">
              {quote ? "Angebotssumme" : "Gesamtbetrag"}
              {gross && " (inkl. USt)"}
            </dt>
            <dd className="gross">{money(totals.gross)}</dd>
            {gross && taxes.length > 0 && (
              <>
                <dt className="sheet-included">darin enthalten:</dt>
                <dd className="sheet-included" />
                {taxes.map((t) => (
                  <div key={t.rate} style={{ display: "contents" }}>
                    <dt className="sheet-included">Netto{taxes.length > 1 && ` ${formatRate(t.rate)}`}</dt>
                    <dd className="sheet-included">{money(t.base)}</dd>
                    <dt className="sheet-included">Umsatzsteuer {formatRate(t.rate)}</dt>
                    <dd className="sheet-included">{money(t.tax)}</dd>
                  </div>
                ))}
              </>
            )}
          </dl>
          {plan.length > 0 && (
            <table className="sheet-table sheet-plan" aria-label="Zahlungsplan">
              <caption>Zahlungsplan</caption>
              <thead>
                <tr>
                  <th>Zahlung</th>
                  <th>Fällig bei</th>
                  <th className="num">Anteil</th>
                  <th className="num">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((row, i) => (
                  <tr key={i}>
                    <td>
                      {i + 1}. {row.label}
                    </td>
                    <td>{row.due}</td>
                    <td className="num">{planShareLabel(row.share, formatPercent, money, "Rest")}</td>
                    <td className="num">{!taxNote && !gross ? `${money(row.net)} netto (${money(row.gross)} brutto)` : money(row.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {taxNote && <p className="sheet-strong">{taxNote}</p>}
          <div className="sheet-payment">
            <p>{payment}</p>
            {giroCode && <div className="sheet-giro">GiroCode</div>}
          </div>
          {note && (
            <p style={{ whiteSpace: "pre-wrap" }}>
              <FormattedText text={note} />
            </p>
          )}
        </div>
        <SheetFooter seller={seller} options={options} needsVatId={needsVatId} />
      </div>
    </div>
  );
}
