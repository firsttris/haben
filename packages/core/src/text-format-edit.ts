import { RECURRING_PLACEHOLDERS } from "./recurring.ts";
import { type FormattedTextRun, TEXT_MARKERS, type TextStyle, appendTextRun, parseTextFormatting, plainFormattedText } from "./text-format.ts";

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

type Styles = Pick<FormattedTextRun, TextStyle>;

const EDGE = /[\s*_]/;
const ALNUM = /[\p{L}\p{N}]/u;
// Wie im Parser: Neben diesen Zeichen öffnet oder schließt keine Auszeichnung
const WORD = /[\p{L}\p{N}/\\]/u;
const OPENING = /^[([{„“‚‘"'«‹]+/u;
const CLOSING = /[.,;:!?)}\]“”"'’‘»›]+$/u;
const EMPTY_PAIR: Record<TextStyle, string> = { bold: "*", italic: "_", underline: "__" };

function trimRange(text: string, from: number, to: number, edge: RegExp): [number, number] {
  let start = from;
  let end = to;
  while (start < end && edge.test(text[start]!)) start++;
  while (end > start && edge.test(text[end - 1]!)) end--;
  return [start, end];
}

/** Leerraum am Rand gehört nicht zur Auszeichnung; einzelne Zeichen auch nicht, ein vollständiges Paar schon. */
function narrow(text: string, from: number, to: number): [number, number] {
  const [start, end] = trimRange(text, from, to, /\s/);
  const complete = parseTextFormatting(text.slice(start, end)).some((run) => run.bold || run.italic || run.underline);
  return complete ? [start, end] : trimRange(text, start, end, EDGE);
}

function joinsWord(text: string, at: number): boolean {
  const char = text[at] ?? "";
  // Der Punkt in „datei.zip“ hält das Wort zusammen, der am Satzende nicht
  return WORD.test(char) || (char === "." && ALNUM.test(text[at - 1] ?? "") && ALNUM.test(text[at + 1] ?? ""));
}

/** Auszeichnungen wirken nur an Wortgrenzen, also wird die Auswahl auf ganze Wörter erweitert. */
function toWord(text: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start > 0 && joinsWord(text, start - 1)) start--;
  while (end < text.length && joinsWord(text, end)) end++;
  return [start, end];
}

/** Ein Platzhalter bleibt ganz: Mit Zeichen in den Klammern könnte fillPlaceholders ihn nicht mehr ersetzen. */
function toPlaceholder(text: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  for (const placeholder of Object.keys(RECURRING_PLACEHOLDERS)) {
    for (let at = text.indexOf(placeholder); at >= 0; at = text.indexOf(placeholder, at + 1)) {
      const close = at + placeholder.length;
      if (at < start && start < close) start = at;
      if (at < end && end < close) end = close;
    }
  }
  return [start, end];
}

/** Das ganze durch Leerraum begrenzte Stück ohne Satzzeichen am Rand: In Pfaden bleiben Zeichen sonst wörtlich. */
function toToken(text: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  const token = text.slice(start, end);
  return [start + (OPENING.exec(token)?.[0].length ?? 0), end - (CLOSING.exec(token)?.[0].length ?? 0)];
}

/** Die Zeichenpaare direkt um die Auswahl, von innen nach außen, soweit sie links und rechts zusammenpassen. */
function surroundingLayers(text: string, start: number, end: number): string[] {
  const left = (/[*_]*$/.exec(text.slice(0, start))?.[0].match(/\*+|_+/g) ?? []).reverse();
  const right = /^[*_]*/.exec(text.slice(end))?.[0].match(/\*+|_+/g) ?? [];
  const layers: string[] = [];
  for (let i = 0; i < Math.min(left.length, right.length) && left[i] === right[i] && TEXT_MARKERS[left[i]!]; i++) layers.push(left[i]!);
  return layers;
}

function wrapRun(run: FormattedTextRun): string {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
  if (!core) return run.text;
  const inner = run.italic && run.underline ? "___" : run.italic ? "_" : run.underline ? "__" : "";
  const open = `${run.bold ? "*" : ""}${inner}`;
  return `${lead}${open}${core}${[...open].reverse().join("")}${trail}`;
}

function styledLength(text: string, style: TextStyle): number {
  return parseTextFormatting(text).reduce((sum, run) => sum + (run[style] ? run.text.length : 0), 0);
}

function toggleRange(text: string, start: number, end: number, style: TextStyle): TextEdit | null {
  const layers = surroundingLayers(text, start, end);
  const layerLength = layers.join("").length;
  const outer = Object.fromEntries(layers.flatMap((layer) => TEXT_MARKERS[layer]!.map((s) => [s, true]))) as Partial<Styles>;
  const runs = parseTextFormatting(text.slice(start, end)).map((run) => ({ ...run, ...outer }));
  const remove = runs.filter((run) => run.text.trim()).every((run) => run[style]);
  const merged: FormattedTextRun[] = [];
  for (const run of runs) appendTextRun(merged, { ...run, [style]: !remove });
  const body = merged.map(wrapRun).join("");
  const base = start - layerLength;
  const next = `${text.slice(0, base)}${body}${text.slice(end + layerLength)}`;
  // Der Parser entscheidet: Bleibt ein Zeichen stehen oder ändert sich nichts, gilt die Änderung nicht.
  const changed = remove ? styledLength(next, style) < styledLength(text, style) : styledLength(next, style) > styledLength(text, style);
  if (!changed || plainFormattedText(next) !== plainFormattedText(text)) return null;
  return {
    text: next,
    start: base + /^\s*[*_]*/.exec(body)![0].length,
    end: base + body.length - /[*_]*\s*$/.exec(body)![0].length,
  };
}

function toggleEmptyPair(text: string, at: number, style: TextStyle): TextEdit {
  const marker = EMPTY_PAIR[style];
  const size = marker.length;
  if (text.slice(at - size, at) === marker && text.startsWith(marker, at)) {
    return { text: `${text.slice(0, at - size)}${text.slice(at + size)}`, start: at - size, end: at - size };
  }
  return { text: `${text.slice(0, at)}${marker}${marker}${text.slice(at)}`, start: at + size, end: at + size };
}

/**
 * Schaltet eine Auszeichnung für die Auswahl um und gibt Text und neue Auswahl zurück. `null`, wenn sie
 * dort nicht möglich ist, etwa hinter einem offenen Sternchen; das Feld bleibt dann unverändert.
 */
export function toggleTextStyle(text: string, selectionStart: number, selectionEnd: number, style: TextStyle): TextEdit | null {
  const [narrowStart, narrowEnd] = narrow(text, selectionStart, selectionEnd);
  const [start, end] = toPlaceholder(text, ...toWord(text, narrowStart, narrowEnd));
  if (start === end) return selectionStart === selectionEnd ? toggleEmptyPair(text, start, style) : null;
  const direct = toggleRange(text, start, end, style);
  if (direct) return direct;
  const [tokenStart, tokenEnd] = narrow(text, ...toToken(text, start, end));
  return tokenStart < tokenEnd && (tokenStart !== start || tokenEnd !== end) ? toggleRange(text, tokenStart, tokenEnd, style) : null;
}
