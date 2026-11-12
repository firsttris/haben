/*
 * Kleiner XML-Baum für die E-Rechnung (CII, später UBL): Elemente in fester Reihenfolge, eingerückt mit Tabs wie das
 * XML, das Haben bis #734 mit @e-invoice-eu/core erzeugt hat. Fehlende Teile (null, undefined, false) fallen weg.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  /** Text oder Kindelemente; ein Element ohne beides wird zu <name/> */
  content: string | XmlElement[];
}

/** Attribute ohne Wert fallen weg */
type Attributes = Record<string, string | undefined>;

function definedAttributes(attributes: Attributes): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).filter((e): e is [string, string] => e[1] !== undefined));
}

type Part = XmlElement | null | undefined | false | "";

/** Element mit Kindern; ohne vorhandene Kinder leer */
export function el(name: string, children: Part[], attributes: Attributes = {}): XmlElement {
  return { name, attributes: definedAttributes(attributes), content: children.filter((c): c is XmlElement => Boolean(c)) };
}

/** Element mit Text; ohne Text (undefined, null, "") fällt es weg */
export function txt(name: string, value: string | number | null | undefined, attributes: Attributes = {}): XmlElement | null {
  if (value === undefined || value === null || value === "") return null;
  return { name, attributes: definedAttributes(attributes), content: String(value) };
}

/** Ein Element nur, wenn es Kinder hat */
export function elIf(name: string, children: Part[], attributes: Attributes = {}): XmlElement | null {
  const element = el(name, children, attributes);
  return element.content.length > 0 ? element : null;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function serialize(element: XmlElement, depth: number): string {
  const indent = "\t".repeat(depth);
  const attributes = Object.entries(element.attributes)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  const open = `${indent}<${element.name}${attributes}`;
  if (typeof element.content === "string") return `${open}>${escapeText(element.content)}</${element.name}>`;
  if (element.content.length === 0) return `${open}/>`;
  const children = element.content.map((child) => serialize(child, depth + 1)).join("\n");
  return `${open}>\n${children}\n${indent}</${element.name}>`;
}

/** Dokument mit XML-Deklaration, ohne Zeilenumbruch am Ende */
export function xmlDocument(root: XmlElement): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n${serialize(root, 0)}`;
}
