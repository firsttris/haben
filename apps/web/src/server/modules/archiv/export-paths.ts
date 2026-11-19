// Dateinamen und -endungen im Jahresarchiv

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

/** ASCII, ohne Pfadtrenner und Sonderzeichen, gekürzt; leer wird zum Ersatzwert. */
export function safeName(value: string, maxLength = 40, fallback = "unbekannt"): string {
  const ascii = value
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cut = ascii.slice(0, maxLength).replace(/[-.]+$/g, "");
  return cut || fallback;
}

/** Hängt -2, -3 … vor der Endung an, bis der Pfad frei ist. */
export function uniquePath(used: Set<string>, path: string): string {
  let candidate = path;
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/xml": "xml",
};
