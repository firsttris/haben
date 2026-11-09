import { RECURRING_PLACEHOLDERS } from "./recurring.ts";
import { type FormattedTextRun, TEXT_MARKERS, type TextStyle, appendTextRun, parseTextFormatting, plainFormattedText } from "./text-format.ts";

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

type Styles = Pick<FormattedTextRun, TextStyle>;

const EDGE = /[\s*_]/;
const MARKER = /[*_]/;
const ALNUM = /[\p{L}\p{N}]/u;
// Wie im Parser: Neben diesen Zeichen öffnet oder schließt keine Auszeichnung. Dazu kombinierende Zeichen,
// sonst endet ein Wort mit getrennt gespeichertem Umlaut (u + U+0308, so liefert macOS Dateinamen) mittendrin.
const WORD = /[\p{L}\p{M}\p{N}/\\]/u;
const OPENING = /^[([{„“‚‘"'«‹]+/u;
const CLOSING = /[.,;:!?)}\]“”"'’‘»›]+$/u;
const EMPTY_PAIR: Record<TextStyle, string> = { bold: "*", italic: "_", underline: "__" };
// Satzzeichen neben dem Wort: Hinter einem Wort könnte die zweite Hälfte einer geteilten Auszeichnung nicht öffnen
const PUNCTUATION = /[^\s\p{L}\p{M}\p{N}*_]/u;
const TOKEN_PART = /[^\s*_]/;
// `_` und `__` direkt nebeneinander liest der Parser als `___`; dann hilft nur, die umgebende Auszeichnung zu teilen
const MERGES_WITH: Partial<Record<TextStyle, TextStyle>> = { italic: "underline", underline: "italic" };

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
  // Mitten in `__` beginnt nur scheinbar ein Paar: `_x_` aus `__x__` ist nicht kursiv
  const cutsMarker = (MARKER.test(text[start] ?? "") && text[start - 1] === text[start]) || (MARKER.test(text[end - 1] ?? "") && text[end] === text[end - 1]);
  const complete = !cutsMarker && parseTextFormatting(text.slice(start, end)).some((run) => run.bold || run.italic || run.underline);
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
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const [l, r] = [left[i]!, right[i]!];
    // In `_a __b___` schließt der längere Block auch die äußere Auszeichnung; innen gilt nur das kürzere Paar
    if (!TEXT_MARKERS[l] || !r.startsWith(l)) break;
    layers.push(l);
    if (l !== r) break;
  }
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

interface MarkerGroup {
  at: number;
  marker: string;
}

function markerGroups(text: string, from: number, to: number): MarkerGroup[] {
  return [...text.slice(from, to).matchAll(/\*+|_+/g)].filter((m) => TEXT_MARKERS[m[0]]).map((m) => ({ at: from + m.index, marker: m[0] }));
}

/** Das nächste Zeichenpaar um die Auswahl, dessen ganzer Inhalt die Auszeichnung trägt. */
function enclosingPair(text: string, start: number, end: number, style: TextStyle): [MarkerGroup, MarkerGroup] | null {
  const opens = markerGroups(text, 0, start).reverse();
  const closes = markerGroups(text, end, text.length);
  for (const open of opens) {
    for (const close of closes) {
      if (open.marker !== close.marker) continue;
      const runs = parseTextFormatting(text.slice(open.at, close.at + close.marker.length)).filter((run) => run.text.trim());
      if (runs.length > 0 && runs.every((run) => run[style])) return [open, close];
    }
  }
  return null;
}

const plainRun = (text: string, styles: Partial<Styles>): FormattedTextRun => ({ text, bold: false, italic: false, underline: false, ...styles });

const SELECTION_START = "\uE000";
const SELECTION_END = "\uE001";

/**
 * Für innere Paare, die über die Auswahl reichen, wie in `*eins _zwei drei_*`: Die Rohtexte der Hälften wären
 * unvollständig, darum werden die gelesenen Abschnitte an der Auswahl geteilt. Marken aus dem privaten Unicode-Bereich
 * tragen die Auswahl durch den Parser.
 */
function splitParsedRuns(text: string, open: MarkerGroup, close: MarkerGroup, from: number, to: number, style: TextStyle): TextEdit | null {
  const spanEnd = close.at + close.marker.length;
  const marked = `${text.slice(open.at, from)}${SELECTION_START}${text.slice(from, to)}${SELECTION_END}${text.slice(to, spanEnd)}`;
  const zones: FormattedTextRun[][] = [[], [], []];
  let zone = 0;
  for (const run of parseTextFormatting(marked)) {
    for (const piece of run.text.split(/([\uE000\uE001])/)) {
      if (piece === SELECTION_START || piece === SELECTION_END) zone++;
      else appendTextRun(zones[zone]!, { ...run, text: piece, ...(zone === 1 ? { [style]: false } : {}) });
    }
  }
  if (zone !== 2) return null;
  const [before, middle, after] = zones.map((runs) => runs.map(wrapRun).join("")) as [string, string, string];
  const next = `${text.slice(0, open.at)}${before}${middle}${after}${text.slice(spanEnd)}`;
  if (styledLength(next, style) >= styledLength(text, style) || plainFormattedText(next) !== plainFormattedText(text)) return null;
  const base = open.at + before.length;
  return { text: next, start: base + /^\s*[*_]*/.exec(middle)![0].length, end: base + middle.length - /[*_]*\s*$/.exec(middle)![0].length };
}

/**
 * Teilt die umgebende Auszeichnung an der Auswahl: Aus `*eins zwei*` wird `*eins* zwei`, und mit `on` aus
 * `_eins zwei_` beim Unterstreichen von „eins“ `___eins___ _zwei_`.
 */
function splitEnclosing(text: string, start: number, end: number, style: TextStyle, on: boolean): TextEdit | null {
  const carried = on ? MERGES_WITH[style] : style;
  if (!carried) return null;
  const layerLength = surroundingLayers(text, start, end).join("").length;
  let [from, to] = [start - layerLength, end + layerLength];
  const pair = enclosingPair(text, from, to, carried);
  if (!pair) return null;
  const [open, close] = pair;
  const stack = [open.marker];
  let innerStart = open.at + open.marker.length;
  let innerEnd = close.at;
  // Direkt anschließende Paare wie in `*_x y_*` gehören zu beiden Hälften
  for (;;) {
    const inner = /^(\*+|_+)/.exec(text.slice(innerStart))?.[0];
    if (!inner || !TEXT_MARKERS[inner] || !text.slice(0, innerEnd).endsWith(inner) || innerStart + inner.length > from || innerEnd - inner.length < to) break;
    stack.push(inner);
    innerStart += inner.length;
    innerEnd -= inner.length;
  }
  // Beim Dazunehmen das ganze Stück: `_a____-b___` läse beim zweiten Klick niemand mehr als zwei Paare
  const widen = on ? TOKEN_PART : PUNCTUATION;
  // Satzzeichen bleiben außerhalb der Klammern eines Platzhalters, sonst stünde dort ein Zeichen
  const insidePlaceholder = (at: number) => !on && toPlaceholder(text, at, at)[0] !== at;
  while (from > innerStart && widen.test(text[from - 1]!) && !insidePlaceholder(from - 1)) from--;
  while (to < innerEnd && widen.test(text[to]!) && !insidePlaceholder(to + 1)) to++;
  const kept = Object.fromEntries(stack.flatMap((marker) => TEXT_MARKERS[marker]!.map((s) => [s, true]))) as Partial<Styles>;
  const before = wrapRun(plainRun(text.slice(innerStart, from), kept));
  const middle = wrapRun(plainRun(text.slice(from, to), { ...kept, [style]: on }));
  const after = wrapRun(plainRun(text.slice(to, innerEnd), kept));
  const next = `${text.slice(0, open.at)}${before}${middle}${after}${text.slice(close.at + close.marker.length)}`;
  const changed = on ? styledLength(next, style) > styledLength(text, style) : styledLength(next, style) < styledLength(text, style);
  if (!changed || plainFormattedText(next) !== plainFormattedText(text)) return on ? null : splitParsedRuns(text, open, close, from, to, style);
  const base = open.at + before.length;
  return { text: next, start: base + /^\s*[*_]*/.exec(middle)![0].length, end: base + middle.length - /[*_]*\s*$/.exec(middle)![0].length };
}

function toggleEmptyPair(text: string, at: number, style: TextStyle): TextEdit {
  const marker = EMPTY_PAIR[style];
  const size = marker.length;
  // Der ganze Block links zählt: Der innere `_` von `__|__` ist die Hälfte des Unterstreichens, kein Kursiv-Paar
  const left = (marker[0] === "_" ? /_*$/ : /\**$/).exec(text.slice(0, at))![0];
  if (TEXT_MARKERS[left]?.includes(style) && text.startsWith(left, at)) {
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
  const split = splitEnclosing(text, start, end, style, false) ?? splitEnclosing(text, start, end, style, true);
  if (split) return split;
  const [tokenStart, tokenEnd] = narrow(text, ...toPlaceholder(text, ...toToken(text, start, end)));
  return tokenStart < tokenEnd && (tokenStart !== start || tokenEnd !== end) ? toggleRange(text, tokenStart, tokenEnd, style) : null;
}
