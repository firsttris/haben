import { LETTERHEAD_FONTS } from "@haben/core";
import { LAYOUT_SCHEMA_VERSION, layoutJsonSchema } from "./layout-schema.ts";
import { type FieldInfo, flattenSchema } from "./layout-schema-paths.ts";

/*
 * Anleitung für eigene Belegvorlagen, aus dem Feldvertrag erzeugt: als Skill für KI-Agenten (.claude/skills/belegvorlage)
 * und zum Herunterladen aus Haben. Sie braucht kein Repository; alles, was ein Layout wissen muss, steht darin.
 * Ändert sich der Vertrag, schreibt `bun scripts/feldvertrag/schreiben.ts` Skill und Doku neu (layout-anleitung.test.ts).
 */

/** Typst-Version des Compilers (@myriaddreamin/typst-ts-node-compiler); layout-anleitung.test.ts prüft sie */
export const TYPST_VERSION = "0.14.2";

const zelle = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** Felder als Tabelle; Unterfelder von Listen mit [] im Pfad, z. B. lines[].net */
export function feldTabelle(felder: readonly FieldInfo[]): string {
  const zeilen = felder.map((f) => `| \`${f.path}\` | \`${zelle(f.type)}\` | ${f.required ? "ja" : "nein"} | ${zelle(f.description)} |`);
  return ["| Feld | Typ | Immer da | Bedeutung |", "| --- | --- | --- | --- |", ...zeilen].join("\n");
}

/** Beide Tabellen des Vertrags, so wie sie in Skill und Doku stehen */
export function feldvertragMarkdown(ueberschrift = "###"): string {
  const schema = layoutJsonSchema();
  return [
    `${ueberschrift} Beleg: Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein`,
    "",
    feldTabelle(flattenSchema(schema.beleg as never)),
    "",
    `${ueberschrift} Mahnung`,
    "",
    feldTabelle(flattenSchema(schema.mahnung as never)),
  ].join("\n");
}

const schriften = () =>
  Object.values(LETTERHEAD_FONTS)
    .map((f) =>
      f.regular === f.semibold
        ? `- „${f.regular}“, Gewichte 400, 500 und 600, normal und kursiv`
        : `- „${f.regular}“, dazu „${f.medium}“ (500) und „${f.semibold}“ (600), normal und kursiv`,
    )
    .join("\n");

/** Kleinstes Layout für Belege; layout-anleitung.test.ts setzt es mit allen Beispielen */
export const GERUEST = `\`\`\`typst
#let d = json(bytes(sys.inputs.data))

#set page(paper: "a4", margin: (top: 20mm, bottom: 30mm, left: 25mm, right: 20mm),
  // Pflicht: Der Vermerk eines Entwurfs steht über jeder Seite
  foreground: if d.at("draft", default: none) != none { place(center + horizon, rotate(-30deg, text(60pt, fill: luma(200), d.draft))) },
  footer: context grid(columns: d.footer.len() * (1fr,), gutter: 6mm, ..d.footer.map(spalte => text(7pt, spalte.join("\\n")))),
)
#set text(font: d.font.regular, size: 9.5pt, fill: rgb(d.palette.ink), lang: "de")

#if d.at("logo", default: none) != none { place(top + right, image(d.logo, height: d.look.logoHeight * 1mm)) }
#text(7pt, d.senderLine) \\
#d.recipient.join("\\n")

#for m in d.meta [ #m.label: #m.value \\ ]
= #d.title
#if d.reference != none { par(d.reference) }
#table(columns: 4, [Pos.], [Bezeichnung], [Menge], [Betrag], ..d.lines.map(l => (l.pos, l.description, l.quantity, l.net)).flatten())
#if d.totals != none {
  for r in d.totals.rows [ #r.label: #r.value \\ ]
  strong[#d.totals.gross.label: #d.totals.gross.value]
  // Bruttopreise: Umsatzsteuer je Satz steht nur hier; Fremdwährung: Umsatzsteuer in Euro
  for block in (d.totals.at("included", default: none), d.totals.at("euroTax", default: none)) {
    if block != none [ \\ #block.label \\ #for r in block.rows [ #r.label: #r.value \\ ] ]
  }
}
#if d.taxNote != none { par(d.taxNote) }
#if d.payment != none { par(d.payment) }
#if d.legal != none { text(7pt, d.legal) }
\`\`\``;

export function layoutAnleitung(): string {
  return `---
name: "belegvorlage"
description: "Eigenes Layout für Belege von Haben in Typst schreiben oder ändern: Rechnung, Angebot, Auftragsbestätigung, Lieferschein und Mahnung. Mit allen Feldern, die Haben der Vorlage übergibt (Feldvertrag v${LAYOUT_SCHEMA_VERSION}), den Schriften, den Pflichtangaben und dem, was Haben beim Hochladen prüft. Braucht kein Repository."
---

# Eigene Belegvorlage für Haben

Haben setzt Belege mit [Typst](https://typst.app/docs/) ${TYPST_VERSION} als PDF/A-3b. Ein eigenes Layout ist eine einzelne \`.typ\`-Datei. Haben übergibt ihr die Daten des Belegs fertig formatiert, die Vorlage rechnet nichts: Beträge, Daten und Mengen sind Text. Die E-Rechnung (ZUGFeRD-XML) hängt Haben selbst an, eine Vorlage kann sie nicht verlieren.

## Daten lesen

\`\`\`typst
#let d = json(bytes(sys.inputs.data))
\`\`\`

Es gibt zwei Arten mit eigenen Feldern: **Beleg** (Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein) und **Mahnung**. Beim Hochladen wählt man, wofür das Layout ist.

- Ein Feld mit „Immer da: nein“ kann fehlen. Lies es mit \`d.at("feld", default: none)\`, sonst bricht das Layout bei Belegen ohne dieses Feld.
- \`null\` heißt: auf diesem Beleg gibt es das nicht. Prüfe mit \`!= none\`.
- Text mit Auszeichnungen kommt zweimal: als reiner Text (\`intro\`) und in Abschnitten (\`introFormatted\`, je Abschnitt \`text\`, \`bold\`, \`italic\`, \`underline\`). Für das Blatt die Abschnitte nehmen.
- Neue Felder kommen nur dazu. Ein Layout für Version ${LAYOUT_SCHEMA_VERSION} bekommt auch künftig alle Felder dieser Version mit gleichem Namen und Typ.

## Schriften

Nur diese Schriften sind eingebettet; andere fehlen auf dem Server, und PDF/A verlangt eingebettete Schriften. Die in der Gestaltung gewählte steht in \`d.font\`:

${schriften()}

## Dateien und Pakete

- Logo und Briefpapier liegen beim Setzen neben der Vorlage, ihre Dateinamen stehen in \`d.logo\` und \`d.background\` (fehlen ohne). Lies sie mit \`image(d.logo)\`, nie mit festem Namen.
- Andere Dateien gibt es nicht, und Typst liest nichts außerhalb des Ordners der Vorlage.
- Pakete (\`#import "@preview/name:1.2.3"\`) nur mit fester Version. Haben fragt beim Hochladen nach, lädt sie nach der Bestätigung einmal und setzt danach ohne Netz. Ohne Paket ist ein Layout einfacher zu prüfen; ein zur Laufzeit zusammengesetzter Paketname scheitert.
- Ein Lauf darf höchstens 5 Sekunden dauern, sonst bricht Haben ihn ab.

## Pflichtangaben

Haben setzt das Layout beim Hochladen mit Beispieldaten und lehnt es ab, wenn auf dem Blatt etwas davon fehlt:

- Absender mit Name und vollständiger Anschrift, also Straße sowie PLZ und Ort (\`author\` und \`senderLine\`; die Fußzeile genügt dafür nicht, denn was dort steht, legt die Gestaltung fest; § 14 Abs. 4 Nr. 1 UStG) und Empfänger (\`recipient\`), die Bezeichnung des Belegs (\`title\`, keine feste Überschrift wie „Rechnung“), bei Storno und Korrektur der Bezug auf die Rechnung (\`reference\`; § 31 Abs. 5 UStDV), Angaben aus \`meta\` (Nummer, Datum, Leistungsdatum).
- Jede Position mit Menge und Bezeichnung (\`lines\`), die Summen mit Umsatzsteuer und Steuersatz je Satz, etwa „Umsatzsteuer 19 %“ (\`totals.rows\`, bei Bruttopreisen in \`totals.included\`, bei Fremdwährung zusätzlich in Euro in \`totals.euroTax\`), der Hinweis ohne Steuerausweis (\`taxNote\`), bei Skonto der Zahlungssatz (\`payment\`; § 14 Abs. 4 Nr. 7 UStG), auf Rechnungen die Steuernummer oder die USt-IdNr. des Ausstellers, eine genügt (meist in der Fußzeile, \`footer\`; § 14 Abs. 4 Nr. 2 UStG; Angebot, Auftragsbestätigung, Lieferschein und Mahnung brauchen keine) und bei GmbH oder UG die Pflichtangaben aus \`legal\`, gern je Angabe auf eigener Zeile (Trenner „ · “; § 14 Abs. 4 UStG, § 35a GmbHG).
- Bei einem Entwurf der Vermerk aus \`draft\` auf jeder Seite.
- Mehrseitige Belege müssen gehen: Die Beispiele haben bis zu 40 Positionen.

## Grundgerüst

${GERUEST}

## Prüfen

Haben bietet unter Einstellungen › Beleggestaltung › Layouts die eingebauten Layouts als Grundlage und die Beispieldaten zum Herunterladen an. Die Beispieldaten sind eine Liste aus \`name\` und \`data\`; ein Beispiel daraus geht mit der Typst-CLI so (die Schriften oben gibt es frei unter der SIL Open Font License, etwa bei Google Fonts):

\`\`\`sh
jq '.[0].data' beispieldaten-beleg.json > beispiel.json
typst compile --input data="$(cat beispiel.json)" --font-path schriften/ vorlage.typ
\`\`\`

## Felder (Feldvertrag v${LAYOUT_SCHEMA_VERSION})

${feldvertragMarkdown()}
`;
}
