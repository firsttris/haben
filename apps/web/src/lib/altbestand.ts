import type { LegacySource } from "../server/db/schema.ts";

/** Herkunft eines archivierten Belegs: Name im Archiv und Produkt, aus dem er stammt */
export const LEGACY_SOURCE: Record<LegacySource, { name: string; product: string }> = {
  lexoffice: { name: "Lexoffice", product: "Lexware Office" },
  sevdesk: { name: "sevDesk", product: "sevDesk" },
  buchhaltungsbutler: { name: "BuchhaltungsButler", product: "BuchhaltungsButler" },
  accountable: { name: "Accountable", product: "Accountable" },
  import: { name: "JSON-Import", product: "Quellprogramm" },
};

/** Beim JSON-Import nennt das Paket das Quellprogramm selbst */
export function legacySource(source: LegacySource, sourceName: string | null): { name: string; product: string } {
  return source === "import" ? { name: sourceName || LEGACY_SOURCE.import.name, product: LEGACY_SOURCE.import.product } : LEGACY_SOURCE[source];
}
