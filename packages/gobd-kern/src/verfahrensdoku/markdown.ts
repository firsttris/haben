import type { Verfahrensdoku } from "./modell.ts";

/**
 * Markdown (CommonMark) aus dem Datenmodell, etwa als Download oder als Datei im Jahresarchiv. Text aus Angaben und
 * Datenbank wird maskiert, damit ein Stern im Firmennamen oder ein „#“ am Zeilenanfang nicht zur Formatierung wird und
 * kein HTML durchkommt.
 */

/** Zeichen mit Bedeutung in CommonMark, dazu < und > gegen HTML */
const MARKDOWN = /[\\`*_{}[\]<>#|!~]/g;

export function markdownText(text: string): string {
  // Ein Zeilenanfang wie „1.“ oder „-“ würde zur Liste, „---“ oder „===“ unter einer Zeile zur Überschrift.
  // Zeilenumbrüche bleiben als harte Umbrüche, Leerzeilen trennen Absätze.
  return text
    .replace(MARKDOWN, (z) => `\\${z}`)
    .split(/\r?\n/)
    .map((zeile) =>
      zeile
        .trim()
        .replace(/^(\d+)([.)])/, "$1\\$2")
        .replace(/^([-+=])/, "\\$1"),
    )
    .filter((zeile, i, alle) => zeile !== "" || (i > 0 && alle[i - 1] !== ""))
    .join("  \n")
    .replace(/( {2}\n){2,}/g, "\n\n")
    .trim();
}

export function standText(doku: Verfahrensdoku): string {
  const stand = `Stand: ${doku.stand.datum} · ${doku.stand.programm} ${doku.stand.version}`;
  return doku.vollstaendig ? `${stand} · vollständig` : `${stand} · unvollständig, ${doku.luecken === 1 ? "1 Angabe fehlt" : `${doku.luecken} Angaben fehlen`}`;
}

export function alsMarkdown(doku: Verfahrensdoku): string {
  const teile = [`# ${markdownText(doku.titel)}`, markdownText(standText(doku))];
  for (const a of doku.abschnitte) {
    teile.push(`## ${markdownText(a.titel)}`);
    for (const absatz of a.absaetze) teile.push(markdownText(absatz));
    if (a.liste?.length) teile.push(a.liste.map((eintrag) => `- ${markdownText(eintrag).replace(/\n\n/g, "  \n")}`).join("\n"));
    if (a.luecken?.length) teile.push(a.luecken.map((l) => `> **Fehlt:** ${markdownText(l).replace(/\n\n/g, "  \n")}`).join("\n>\n"));
  }
  return `${teile.join("\n\n")}\n`;
}
