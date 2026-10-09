/** Helfer zum Lesen der Serverantworten, die fast-xml-parser geliefert hat (Attribute mit Präfix @) */

export type Node = Record<string, unknown>;

export const asNodes = (value: unknown): Node[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is Node => typeof v === "object" && v !== null);

/** Alle Elemente mit diesem Namen, egal wie tief; reine Textelemente als { "#text": … } */
export function findDeep(node: unknown, name: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) findDeep(item, name, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name) out.push(...asNodes(value).concat(typeof value === "string" ? [{ "#text": value }] : []));
      else if (!key.startsWith("@")) findDeep(value, name, out);
    }
  }
  return out;
}

export const text = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && value !== null && "#text" in value) return String((value as Node)["#text"]).trim();
  return "";
};

export const int = (value: unknown): number => {
  const n = Number.parseInt(text(value), 10);
  return Number.isFinite(n) ? n : 0;
};
