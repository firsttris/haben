/*
 * Bildformat eines Logos aus den ersten Bytes (#1069). Haben (Logo im Briefkopf und Briefpapier), das Firmenportal und der
 * Abgleich im Werkzeug deploy/instanzen (portal-zeichen.ts, das nichts aus packages/ importieren darf) nehmen dieselbe Regel.
 */

/** Größte Datei, die als Logo gilt: 1 MB */
export const MAX_LOGO_BYTES = 1024 * 1024;

/** Die 8 Byte, mit denen jede PNG-Datei beginnt (W3C PNG Specification, 5.2) */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Erkennt PNG und JPEG an der Dateisignatur; alles andere (SVG, leer, zu kurz) ist null. JPEG beginnt mit dem Marker SOI
 * X'FFD8', jeder folgende Marker mit X'FF' (ITU-T T.81, Anhang B.1.1.2 und Tabelle B.1).
 */
export function bildFormat(data: Uint8Array): "png" | "jpg" | null {
  if (data.length > 8 && PNG.every((byte, i) => data[i] === byte)) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}
