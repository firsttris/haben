import type { LayoutBeispiel } from "./layout-beispiele.ts";
import { LAYOUT_PFLICHTFELDER } from "./layout-schema.ts";

/*
 * Was ein eigenes Layout auf dem Blatt zeigen muss (§ 14 Abs. 4 UStG, § 35a GmbHG), geprüft am Text des gesetzten PDFs
 * je Seite. Leerraum, Trennstellen und Umbruchstellen zählen nicht: Ein Layout darf umbrechen, wo es will.
 */

const kompakt = (text: string) => text.replace(/[\s ­​]+/g, "").normalize("NFC");

interface Zeile {
  label: string;
  value: string;
}

interface Daten {
  author: string;
  senderLine?: string;
  recipient: string[];
  meta: Zeile[];
  title: string;
  reference?: string | null;
  payment?: string | null;
  draft?: string;
  legal?: string | null;
  footer: string[][];
  lines?: { description: string; quantity: string; net: string }[];
  totals?: { rows: Zeile[]; gross: Zeile; included?: { rows: Zeile[] } | null; euroTax?: { rows: Zeile[] } | null } | null;
  taxNote?: string | null;
  invoices?: { number: string }[];
  total?: Zeile;
}

/** Was auf dem Blatt stehen muss, mit dem Grund für die Meldung */
function pflicht(art: LayoutBeispiel["art"], d: Daten): { was: string; text: string }[] {
  const gemeinsam = [
    { was: "Name des Absenders", text: d.author },
    // Vollständige Anschrift des Ausstellers (§ 14 Abs. 4 Nr. 1 UStG): Straße sowie PLZ und Ort aus der Absenderzeile
    ...(d.senderLine ?? "")
      .split(" · ")
      .slice(1)
      .filter((text) => text.trim())
      .map((text) => ({ was: "Anschrift des Absenders", text })),
    ...d.recipient.filter(Boolean).map((text) => ({ was: "Anschrift des Empfängers", text })),
    // Je Angabe (§ 35a Abs. 1 GmbHG), denn ein Layout darf sie auf eigene Zeilen verteilen
    ...(d.legal ?? "")
      .split(" · ")
      .filter((text) => text.trim())
      .map((text) => ({ was: "Pflichtangaben der GmbH (legal)", text })),
  ];
  if (art === "mahnung") {
    return [
      ...gemeinsam,
      ...(d.invoices ?? []).map((r) => ({ was: "gemahnte Rechnung", text: r.number })),
      ...(d.total ? [{ was: "zu zahlender Betrag", text: d.total.value }] : []),
    ];
  }
  const t = d.totals;
  const steuerzeilen = t ? [...(t.included ? t.included.rows : t.rows), ...(t.euroTax?.rows ?? [])] : [];
  return [
    ...gemeinsam,
    // Eine feste Überschrift machte aus Storno oder Angebot eine „Rechnung“
    { was: "Bezeichnung des Belegs (title)", text: d.title },
    // Storno und Korrektur beziehen sich spezifisch und eindeutig auf die Rechnung (§ 31 Abs. 5 UStDV)
    ...(d.reference ? [{ was: "Bezug auf die ursprüngliche Rechnung (reference)", text: d.reference }] : []),
    ...d.meta.map((m) => ({ was: `Angabe „${m.label}“`, text: m.value })),
    ...(d.lines ?? []).flatMap((l) => [
      { was: "Bezeichnung einer Position", text: l.description },
      { was: "Menge einer Position", text: l.quantity },
      ...(l.net ? [{ was: "Betrag einer Position", text: l.net }] : []),
    ]),
    ...(t ? [{ was: "Gesamtbetrag", text: t.gross.value }] : []),
    ...steuerzeilen.map((r) => ({ was: `Summenzeile „${r.label}“`, text: r.value })),
    // Steuersatz zum Steuerbetrag (§ 14 Abs. 4 Nr. 8 UStG): der Satz aus der Beschriftung der Steuerzeile, etwa „19 %“
    ...steuerzeilen
      .filter((r) => /Umsatzsteuer|Netto|VAT|Net\b/.test(r.label))
      .flatMap((r) => /\d+(?:,\d+)? ?%/.exec(r.label) ?? [])
      .map((satz) => ({ was: "Steuersatz", text: satz })),
    ...(d.taxNote ? [{ was: "Pflichthinweis unter den Summen (taxNote)", text: d.taxNote }] : []),
    // Skonto ist eine im Voraus vereinbarte Minderung des Entgelts (§ 14 Abs. 4 Nr. 7 UStG); er steht im Zahlungssatz
    ...(d.payment && /Skonto/.test(d.payment) ? [{ was: "Hinweis auf Skonto (payment)", text: d.payment }] : []),
  ];
}

/** Fehlende Angaben in einem gesetzten Beispiel; leer = in Ordnung. seiten ist der Text je Seite (pdftotext, \f) */
export function fehlendeAngaben(beispiel: LayoutBeispiel, seiten: readonly string[]): string[] {
  const d = beispiel.data as Daten;
  const alles = kompakt(seiten.join(""));
  const fehlt = pflicht(beispiel.art, d)
    .filter(({ text }) => text.trim() && !alles.includes(kompakt(text)))
    .map(({ was, text }) => `${was} („${text.length > 60 ? `${text.slice(0, 57)}…` : text}“)`);
  // Nur auf Rechnungen, und eine der beiden genügt (§ 14 Abs. 4 Nr. 2 UStG); Angebot, Lieferschein und Mahnung brauchen keine
  if (beispiel.steuer && beispiel.steuer.length > 0 && !beispiel.steuer.some((text) => alles.includes(kompakt(text)))) {
    fehlt.push(`Steuernummer oder USt-IdNr. („${beispiel.steuer.join("“ oder „")}“)`);
  }
  if (d.draft) {
    const ohne = seiten.map((seite, i) => (kompakt(seite).includes(kompakt(d.draft!)) ? 0 : i + 1)).filter(Boolean);
    if (ohne.length > 0) fehlt.push(`Vermerk „${d.draft}“ auf Seite ${ohne.join(", ")}`);
  }
  return [...new Set(fehlt)];
}

const feldname = (pfad: string) =>
  pfad
    .split(/[.[\]]+/)
    .filter(Boolean)
    .pop() ?? pfad;

/** Nennt der Quelltext eines der Felder („a|b“) als ganzes Wort? Bei Pfaden zählt der letzte Teil (look.foldMarks → foldMarks) */
export const nennt = (source: string, eintrag: string): boolean =>
  eintrag.split("|").some((pfad) => new RegExp(`(?<![A-Za-z0-9_])${feldname(pfad)}(?![A-Za-z0-9_])`).test(source));

/**
 * Pflichtfelder aus dem Feldvertrag, deren Namen der Quelltext nirgends nennt; leer = in Ordnung. Nur ein grober Blick:
 * Ein genanntes Feld kann trotzdem fehlen, das zeigt erst das Setzen der Beispiele.
 */
export function ungenutztePflichtfelder(source: string, art: LayoutBeispiel["art"]): string[] {
  return LAYOUT_PFLICHTFELDER[art].filter((eintrag) => !nennt(source, eintrag));
}
