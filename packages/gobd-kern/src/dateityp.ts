export type DocumentKind = "pdf" | "jpeg" | "png" | "webp" | "heic" | "xml";

const MIME: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  xml: "application/xml",
};

/** Dateityp am Inhalt erkennen, nicht an Endung oder Browser-Angabe. */
export function sniff(bytes: Uint8Array): { kind: DocumentKind; mimeType: string } | null {
  const head = Buffer.from(bytes.subarray(0, 64));
  const ascii = head.toString("latin1");
  let kind: DocumentKind | null = null;
  if (ascii.startsWith("%PDF-")) kind = "pdf";
  else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) kind = "jpeg";
  else if (ascii.startsWith("\x89PNG\r\n\x1a\n")) kind = "png";
  else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") kind = "webp";
  else if (/^....ftyp(heic|heix|mif1|msf1)/s.test(ascii)) kind = "heic";
  // XML, auch mit UTF-8-BOM (EF BB BF) davor
  else if (/^\s*<(\?xml|[A-Za-z])/.test(ascii.replace(/^\xEF\xBB\xBF/, ""))) kind = "xml";
  return kind ? { kind, mimeType: MIME[kind] } : null;
}
