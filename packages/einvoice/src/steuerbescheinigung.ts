import { formatEuro, type Steuerbescheinigung } from "@haben/core";
import { formatDate } from "./format.ts";
import { renderSteuerbescheinigungPdf } from "./pdf.ts";
import type { Letterhead } from "./types.ts";

/*
 * Steuerbescheinigung eines Gesellschafters als PDF/A-3b. Der Inhalt kommt aus steuerbescheinigung() in @haben/core;
 * hier wird nur formatiert. Wortlaut von Titel und Zeilen nach Muster II des BMF-Schreibens vom 16. Mai 2025.
 */

export interface SteuerbescheinigungDocument extends Letterhead {
  bescheinigung: Steuerbescheinigung;
}

/** Druckfertige Texte für templates/steuerbescheinigung.typ */
export function steuerbescheinigungPdfData({ bescheinigung: b }: SteuerbescheinigungDocument) {
  const { aussteller: a, glaeubiger: g } = b;
  const ausstellerAnschrift = `${a.strasse}, ${a.plz} ${a.ort}`;
  return {
    docTitle: `Steuerbescheinigung ${g.name} ${formatDate(b.zahlungstag)}`,
    author: a.name,
    title: "Steuerbescheinigung",
    // Titel des Musters II; Einzelsteuerbescheinigung für einen Zahlungstag
    subtitle:
      "einer leistenden Körperschaft, Personenvereinigung oder Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds – Einzelsteuerbescheinigung",
    senderLine: [a.name, a.strasse, `${a.plz} ${a.ort}`].join(" · "),
    recipient: [g.name, ...g.anschrift],
    meta: [
      { label: "Datum", value: formatDate(b.ausstellungstag) },
      { label: "Zahlungstag", value: formatDate(b.zahlungstag) },
    ],
    parties: [
      { label: "Schuldner der Kapitalerträge", value: `${a.name}, ${ausstellerAnschrift}` },
      ...(a.steuernummer ? [{ label: "Steuernummer", value: a.steuernummer }] : []),
      { label: "Gläubiger der Kapitalerträge", value: `${g.name}, ${g.anschrift.join(", ")}` },
      { label: "Identifikationsnummer", value: g.idnr },
    ],
    intro: `Für den Zahlungstag ${formatDate(b.zahlungstag)} wurden folgende Kapitalerträge gezahlt:`,
    rows: b.zeilen.map((z) => ({ label: z.label, value: formatEuro(z.betrag) })),
    notes: [
      ...(b.religionsschluessel ? [`Kirchensteuer einbehalten für den Religionsschlüssel ${b.religionsschluessel} laut Kirchensteuerabzugsmerkmal.`] : []),
      "Leistungen aus dem steuerlichen Einlagekonto sind keine Kapitalerträge; sie sind in der Höhe der Kapitalerträge nicht enthalten.",
      "Bitte bewahren Sie diese Bescheinigung für Ihre Einkommensteuererklärung auf.",
    ],
    signature: "Die Bescheinigung ist maschinell erstellt und wird nicht unterschrieben (§ 45a Abs. 2 EStG).",
    footer: [[a.name, a.strasse, `${a.plz} ${a.ort}`], [], a.steuernummer ? [`Steuernummer ${a.steuernummer}`] : []],
  };
}

export function buildSteuerbescheinigungPdf(doc: SteuerbescheinigungDocument): Uint8Array {
  return renderSteuerbescheinigungPdf(steuerbescheinigungPdfData(doc), doc.bescheinigung.ausstellungstag, doc);
}
