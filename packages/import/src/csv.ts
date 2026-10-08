/**
 * Zerlegt CSV mit Anführungszeichen (RFC 4180) in Zeilen und Felder. Leere Zeilen entfallen nicht.
 * Ein Anführungszeichen öffnet nur am Feldanfang; mitten im Feld ist es ein normales Zeichen.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && fieldStart) {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += c;
    }
    fieldStart = c === delimiter || c === "\n" || c === "\r";
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function isBlankRow(row: string[]): boolean {
  return row.every((f) => f.trim() === "");
}
