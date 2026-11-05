import { ARTICLE_FIELDS } from "./articles.ts";
import { ASSET_FIELDS } from "./assets.ts";
import { CONTACT_FIELDS } from "./contacts.ts";
import type { ImportField } from "./mapping.ts";

export { ARTICLE_FIELDS, articleCandidates, articleKeys, articleStockKeys, type ArticleRow } from "./articles.ts";
export { ASSET_FIELDS, assetCandidates, assetKeys, takeoverProblems, type AssetRow } from "./assets.ts";
export { CONTACT_FIELDS, contactCandidates, contactKeys, ustIdImportProblem, type ContactRow } from "./contacts.ts";
export { mappingProblem, normalizeColumnName, suggestMapping, type ColumnMapping, type ImportField } from "./mapping.ts";
export { duplicateKey, planCounts, planRows, type DuplicateKey, type PlannedRow, type RowCandidate } from "./plan.ts";
export {
  CSV_DELIMITER_LABEL,
  CSV_ENCODING_LABEL,
  MAX_IMPORT_BYTES,
  readCsvTable,
  type CsvDelimiter,
  type CsvDelimiterChoice,
  type CsvEncoding,
  type CsvEncodingChoice,
  type CsvTable,
} from "./read.ts";

/** Was sich per CSV übernehmen lässt; der Schlüssel steht so auch in der Adresse der Seite (?art=kontakte) */
export type CsvImportKind = "kontakte" | "artikel" | "anlagen";
export const CSV_IMPORT_KINDS = ["kontakte", "artikel", "anlagen"] as const satisfies readonly CsvImportKind[];

export const CSV_IMPORT_FIELDS: Record<CsvImportKind, readonly ImportField[]> = {
  kontakte: CONTACT_FIELDS,
  artikel: ARTICLE_FIELDS,
  anlagen: ASSET_FIELDS,
};

export const CSV_IMPORT_LABEL: Record<CsvImportKind, string> = { kontakte: "Kontakte", artikel: "Artikel", anlagen: "Anlagen" };
