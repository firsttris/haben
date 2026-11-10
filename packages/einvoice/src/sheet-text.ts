import type { FormattedTextRun } from "@haben/core";

/** Das gesetzte Blatt ist ein Bild; was darauf steht, bekommen Screenreader aus denselben Daten als Text */
export interface SheetTextPart {
  part: "kopf" | "positionen" | "summen" | "hinweise" | "fuss";
  lines: string[];
}

interface Row {
  label: string;
  value: string;
}

interface SheetLine {
  pos: string;
  itemNumber?: string;
  description: string;
  detailFormatted?: FormattedTextRun[] | null;
  discount?: string | null;
  quantity: string;
  unitPrice: string;
  rate: string;
  net: string;
}

export interface SheetData {
  senderLine: string;
  recipient: string[];
  title: string;
  reference?: string | null;
  meta: Row[];
  introFormatted?: FormattedTextRun[] | null;
  lines: SheetLine[];
  /** Die Spalte USt entfällt, wenn nur ein Satz vorkommt und sie abgewählt ist */
  hideVatColumn?: boolean;
  totals?: { rows: Row[]; gross: Row; included?: { label: string; rows: Row[] } | null } | null;
  taxNote?: string | null;
  payment?: string | null;
  noteFormatted?: FormattedTextRun[] | null;
  plan?: { title: string; rows: { label: string; due: string; share: string; amount: string }[] } | null;
  footer: string[][];
  legal?: string | null;
}

const plain = (runs: FormattedTextRun[] | null | undefined) => runs?.map((run) => run.text).join("") ?? "";
const row = ({ label, value }: Row) => `${label}: ${value}`;
const filled = (lines: (string | null | undefined)[]) => lines.filter((line): line is string => Boolean(line?.trim()));

export function sheetText(data: SheetData): SheetTextPart[] {
  const parts: SheetTextPart[] = [
    { part: "kopf", lines: filled([data.senderLine, ...data.recipient, data.title, data.reference, ...data.meta.map(row), plain(data.introFormatted)]) },
    {
      part: "positionen",
      lines: data.lines.flatMap((line) => [
        filled([line.pos, line.itemNumber, line.description, line.quantity, line.unitPrice, data.hideVatColumn ? null : line.rate, line.net]).join(" "),
        ...filled([plain(line.detailFormatted), line.discount]),
      ]),
    },
    {
      part: "summen",
      lines: data.totals ? [...data.totals.rows.map(row), row(data.totals.gross), ...(data.totals.included?.rows.map(row) ?? [])] : [],
    },
    {
      part: "hinweise",
      lines: filled([
        data.taxNote,
        data.payment,
        ...(data.plan ? [data.plan.title, ...data.plan.rows.map((r) => `${r.label}, ${r.due}, ${r.share}, ${r.amount}`)] : []),
        plain(data.noteFormatted),
      ]),
    },
    { part: "fuss", lines: filled([...data.footer.flat(), data.legal]) },
  ];
  return parts.filter((part) => part.lines.length > 0);
}
