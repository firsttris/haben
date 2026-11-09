/** Drei Auszeichnungen für Belegtexte; keine HTML-, Markdown- oder Typst-Auswertung. */
export interface FormattedTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type TextStyle = "bold" | "italic" | "underline";
interface Frame {
  marker: string;
  styles: TextStyle[];
  runs: FormattedTextRun[];
}

const emptyStyle = { bold: false, italic: false, underline: false };
const word = /[\p{L}\p{N}/\\]/u;

/** Die gültigen Zeichenpaare; drei Unterstriche, weil `_` und `__` direkt nebeneinander nicht trennbar wären. */
export const TEXT_MARKERS: Readonly<Record<string, readonly TextStyle[]>> = {
  "*": ["bold"],
  "**": ["bold"],
  _: ["italic"],
  __: ["underline"],
  ___: ["italic", "underline"],
};

export function appendTextRun(runs: FormattedTextRun[], run: FormattedTextRun): void {
  if (!run.text) return;
  const last = runs.at(-1);
  if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) last.text += run.text;
  else runs.push({ ...run });
}

function literal(frame: Frame, text: string): void {
  appendTextRun(frame.runs, { text, ...emptyStyle });
}

function canOpen(text: string, at: number, size: number): boolean {
  const before = text[at - 1];
  const after = text[at + size];
  const inFilename = before === "." && /[\p{L}\p{N}]/u.test(text[at - 2] ?? "");
  return !inFilename && (!before || !word.test(before)) && !!after && !/\s/.test(after) && after !== text[at];
}

function canClose(text: string, at: number, size: number): boolean {
  const before = text[at - 1];
  const after = text[at + size];
  const extension = after === "." && /[\p{L}\p{N}]/u.test(text[at + size + 1] ?? "");
  return !extension && !!before && !/\s/.test(before) && (!after || !word.test(after));
}

/** `___:___` ist eine Linie zum Ausfüllen: Nur um mehr als Satzzeichen ist `___` eine Auszeichnung. */
function hasContent(frame: Frame): boolean {
  return frame.marker !== "___" || frame.runs.some((run) => /[^\s\p{P}]/u.test(run.text));
}

/** Eine nicht geschlossene Auszeichnung verliert weder ihr Zeichen noch ihren Text. */
function dissolve(frames: Frame[]): void {
  const frame = frames.pop()!;
  const parent = frames.at(-1)!;
  literal(parent, frame.marker);
  for (const run of frame.runs) appendTextRun(parent.runs, run);
}

function close(frames: Frame[]): void {
  const frame = frames.pop()!;
  const parent = frames.at(-1)!;
  const styles = Object.fromEntries(frame.styles.map((style) => [style, true]));
  for (const run of frame.runs) appendTextRun(parent.runs, { ...run, ...styles });
}

/**
 * *fett* (auch **fett**), _kursiv_, __unterstrichen__ und ___beides___. Nur Zeichenpaare an Wortgrenzen
 * zählen; Dateinamen, Pfade und nicht geschlossene Zeichen bleiben lesbar erhalten.
 */
export function parseTextFormatting(text: string): FormattedTextRun[] {
  const frames: Frame[] = [{ marker: "", styles: [], runs: [] }];
  let at = 0;
  while (at < text.length) {
    const frame = frames.at(-1)!;
    // Pfade und URLs sind häufige Bestandteile von IT-Angeboten und bleiben wörtlich.
    if (frame.runs.length === 0 || /\s/.test(text[at - 1] ?? "")) {
      const rest = text.slice(at);
      // Einzelner Backslash ab Laufwerkswurzel: ein weiterer Trenner macht den
      // Pfad erkennbar. Explizite Paare wie \_wörtlich\_ bleiben dagegen Escapes.
      const escaped = /^\\([*_])[^\s]*\\\1/.test(rest);
      // Hinter öffnender Klammer oder Anführungszeichen beginnt ein Pfad nie mit einem
      // Formatierungszeichen: (*01/2026*) ist fett. `\*` ist ein Escape, kein Trenner,
      // denn `*` ist in Windows-Namen unzulässig.
      const path =
        /^[([{„“‚‘"'«‹]*(?:[^\s*_\\/([{„“‚‘"'«‹][^\s\\/]*(?:\/|\\(?!\*))|\/|\\\\)[^\s]*/u.exec(rest) ?? (!escaped ? /^\\[^\s\\]+\\[^\s]*/.exec(rest) : null);
      if (path) {
        let end = at + path[0].length;
        // Äußere Auszeichnungen dürfen den ganzen Pfad umschließen. Ihre
        // Schlusszeichen gehören zum Parser, Zeichen im Pfad bleiben wörtlich.
        const punctuation = /[.,;:!?)}\]“”"'’‘»›]*$/u.exec(path[0])![0].length;
        let boundary = end - punctuation;
        for (const open of frames.slice(1)) {
          const closer = boundary - open.marker.length;
          if (text.startsWith(open.marker, closer) && canClose(text, closer, open.marker.length)) boundary = closer;
        }
        if (boundary < end - punctuation) end = boundary;
        literal(frame, text.slice(at, end));
        at = end;
        continue;
      }
    }
    const char = text[at]!;
    if (char === "\\" && /[*_\\]/.test(text[at + 1] ?? "")) {
      literal(frame, text[at + 1]!);
      at += 2;
      continue;
    }
    if (char !== "*" && char !== "_") {
      literal(frame, char);
      at++;
      continue;
    }
    if (frame.marker && text.startsWith(frame.marker, at) && canClose(text, at, frame.marker.length)) {
      at += frame.marker.length;
      if (hasContent(frame)) close(frames);
      else {
        dissolve(frames);
        literal(frames.at(-1)!, frame.marker);
      }
      continue;
    }
    let count = 1;
    while (text[at + count] === char) count++;
    const marker = char.repeat(count);
    if (TEXT_MARKERS[marker] && canOpen(text, at, count) && !frames.some((f) => f.marker === marker)) {
      frames.push({ marker, styles: [...TEXT_MARKERS[marker]], runs: [] });
    } else literal(frame, marker);
    at += count;
  }
  while (frames.length > 1) dissolve(frames);
  return frames[0]!.runs;
}

/** Inhalt für E-Rechnungs-XML; Formatierungszeichen werden dort nicht mitgegeben. */
export function plainFormattedText(text: string): string {
  return parseTextFormatting(text)
    .map((run) => run.text)
    .join("");
}
