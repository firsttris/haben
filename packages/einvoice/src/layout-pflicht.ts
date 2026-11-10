import type { LayoutBeispiel } from "./layout-beispiele.ts";

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
  const steuer = d.footer.flat().filter((zeile) => /Steuernummer|USt-IdNr|VAT/.test(zeile));
  const gemeinsam = [
    { was: "Name des Absenders", text: d.author },
    // Vollständige Anschrift des Ausstellers (§ 14 Abs. 4 Nr. 1 UStG): Straße sowie PLZ und Ort aus der Absenderzeile
    ...(d.senderLine ?? "")
      .split(" · ")
      .slice(1)
      .filter((text) => text.trim())
      .map((text) => ({ was: "Anschrift des Absenders", text })),
    ...d.recipient.filter(Boolean).map((text) => ({ was: "Anschrift des Empfängers", text })),
    ...steuer.map((text) => ({ was: "Steuernummer oder USt-IdNr.", text })),
    ...(d.legal ? [{ was: "Pflichtangaben der GmbH (legal)", text: d.legal }] : []),
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
    ...d.meta.map((m) => ({ was: `Angabe „${m.label}“`, text: m.value })),
    ...(d.lines ?? []).flatMap((l) => [
      { was: "Bezeichnung einer Position", text: l.description },
      { was: "Menge einer Position", text: l.quantity },
      ...(l.net ? [{ was: "Betrag einer Position", text: l.net }] : []),
    ]),
    ...(t ? [{ was: "Gesamtbetrag", text: t.gross.value }] : []),
    ...steuerzeilen.map((r) => ({ was: `Summenzeile „${r.label}“`, text: r.value })),
    ...(d.taxNote ? [{ was: "Hinweis ohne Steuerausweis", text: d.taxNote }] : []),
  ];
}

/** Fehlende Angaben in einem gesetzten Beispiel; leer = in Ordnung. seiten ist der Text je Seite (pdftotext, \f) */
export function fehlendeAngaben(beispiel: LayoutBeispiel, seiten: readonly string[]): string[] {
  const d = beispiel.data as Daten;
  const alles = kompakt(seiten.join(""));
  const fehlt = pflicht(beispiel.art, d)
    .filter(({ text }) => text.trim() && !alles.includes(kompakt(text)))
    .map(({ was, text }) => `${was} („${text.length > 60 ? `${text.slice(0, 57)}…` : text}“)`);
  if (d.draft) {
    const ohne = seiten.map((seite, i) => (kompakt(seite).includes(kompakt(d.draft!)) ? 0 : i + 1)).filter(Boolean);
    if (ohne.length > 0) fehlt.push(`Vermerk „${d.draft}“ auf Seite ${ohne.join(", ")}`);
  }
  return [...new Set(fehlt)];
}
