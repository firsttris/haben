import { formatEuro, type BescheinigungsZeile, type LegalInfo, type Steuerbescheinigung } from "@haben/core";
import { formatDate } from "./format.ts";
import { legalLine, renderSteuerbescheinigungPdf } from "./pdf.ts";
import type { Letterhead } from "./types.ts";

/*
 * Steuerbescheinigung eines Gesellschafters als PDF/A-3b. Der Inhalt kommt aus steuerbescheinigung() in @haben/core;
 * hier wird nur formatiert, im Aufbau von Muster II des BMF-Schreibens vom 16. Mai 2025 (Quelle im Kopf von
 * packages/core/src/steuerbescheinigung.ts): Bezeichnung des Schuldners, Adressfeld, Titel, Art der Bescheinigung, Satz der
 * Alternative 1, Zeilen mit den Fußnoten des Musters.
 */

export interface SteuerbescheinigungDocument extends Letterhead {
  bescheinigung: Steuerbescheinigung;
  /** Pflichtangaben der ausschüttenden GmbH oder UG (§ 35a Abs. 1 GmbHG) */
  legalInfo?: LegalInfo;
}

const HOCHGESTELLT = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/** Zeilen mit fortlaufend nummerierten Fußnoten; Beträge in Euro, Textangaben wie sie sind */
function rowsMitFussnoten(zeilen: readonly BescheinigungsZeile[]) {
  const notes: string[] = [];
  const rows = zeilen.map((z) => {
    if (!("betrag" in z)) return { label: z.label, value: z.text };
    if (!z.fussnote) return { label: z.label, value: formatEuro(z.betrag) };
    const marke = HOCHGESTELLT[notes.length + 1]!;
    notes.push(`${marke} ${z.fussnote}`);
    return { label: `${z.label}${marke}`, value: formatEuro(z.betrag) };
  });
  return { rows, notes };
}

/** Druckfertige Texte für templates/steuerbescheinigung.typ */
export function steuerbescheinigungPdfData({ bescheinigung: b, legalInfo }: SteuerbescheinigungDocument) {
  const { aussteller: a, glaeubiger: g } = b;
  const { rows, notes } = rowsMitFussnoten(b.zeilen);
  const zeitraum = b.zeitraum ? ` für ${b.zeitraum}` : "";
  return {
    docTitle: `Steuerbescheinigung ${g.name} ${formatDate(b.zahlungstag)}`,
    author: a.name,
    title: "Steuerbescheinigung",
    subtitle:
      "einer leistenden Körperschaft, Personenvereinigung oder Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds oder eines inländischen Betreibers/einer inländischen Zweigniederlassung eines ausländischen Betreibers einer Internet-Dienstleistungsplattform",
    // Das Muster bietet Einzel- und zusammengefasste Bescheinigung zum Ankreuzen; Haben stellt je Zahlungstag aus
    kind: "☒ Einzelsteuerbescheinigung",
    senderLine: [a.name, a.strasse, `${a.plz} ${a.ort}`].join(" · "),
    recipient: [g.name, ...g.anschrift],
    // Bezeichnung des Schuldners steht im Muster vor dem Titel; ihre Gestaltung ist frei (Rz. 1)
    meta: [
      { label: "Schuldner der Kapitalerträge", value: `${a.name}, ${a.strasse}, ${a.plz} ${a.ort}` },
      ...(a.steuernummer ? [{ label: "Steuernummer", value: a.steuernummer }] : []),
      { label: "Datum", value: formatDate(b.ausstellungstag) },
    ],
    // Alternative 1 des Musters; das Feld des Gläubigers ist frei gestaltbar (Rz. 1), daher dort die Identifikationsnummer
    intro: `An ${[g.name, ...g.anschrift].join(", ")} (Identifikationsnummer ${g.idnr}) wurden lt. Beschluss vom ${formatDate(b.beschlusstag)} am ${formatDate(b.zahlungstag)}${zeitraum} folgende Kapitalerträge gezahlt:`,
    rows,
    notes,
    signature: "Die Bescheinigung ist maschinell erstellt und wird nicht unterschrieben (§ 45a Abs. 2 Satz 3 EStG).",
    footer: [[a.name, a.strasse, `${a.plz} ${a.ort}`], [], a.steuernummer ? [`Steuernummer ${a.steuernummer}`] : []],
    legal: legalLine(legalInfo),
  };
}

export function buildSteuerbescheinigungPdf(doc: SteuerbescheinigungDocument): Uint8Array {
  return renderSteuerbescheinigungPdf(steuerbescheinigungPdfData(doc), doc.bescheinigung.ausstellungstag, doc);
}
