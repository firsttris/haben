/**
 * Schreibt den Skill für eigene Belegvorlagen und die Feldtabellen in docs/belegvorlagen.md aus dem Feldvertrag
 * (packages/einvoice/src/layout-schema.ts). Nach jeder Änderung am Vertrag aufrufen; layout-anleitung.test.ts prüft das.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { feldvertragMarkdown, layoutAnleitung } from "../../packages/einvoice/src/layout-anleitung.ts";

export const SKILL = new URL("../../.claude/skills/belegvorlage/SKILL.md", import.meta.url);
export const DOKU = new URL("../../docs/belegvorlagen.md", import.meta.url);
export const ANFANG = "<!-- feldvertrag:anfang (bun scripts/feldvertrag/schreiben.ts) -->";
export const ENDE = "<!-- feldvertrag:ende -->";

/** Ersetzt den Block zwischen den Markierungen */
export function mitFeldern(doku: string): string {
  const a = doku.indexOf(ANFANG);
  const e = doku.indexOf(ENDE);
  if (a < 0 || e < a) throw new Error(`docs/belegvorlagen.md braucht die Markierungen ${ANFANG} und ${ENDE}`);
  return `${doku.slice(0, a + ANFANG.length)}\n\n${feldvertragMarkdown()}\n\n${doku.slice(e)}`;
}

if (import.meta.main) {
  writeFileSync(SKILL, layoutAnleitung());
  writeFileSync(DOKU, mitFeldern(readFileSync(DOKU, "utf8")));
  console.log("Skill und Doku aus dem Feldvertrag geschrieben.");
}
