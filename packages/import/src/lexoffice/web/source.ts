import { unzipSync } from "fflate";
import type { z } from "zod";
import { LexwareWebExportError } from "./errors.ts";
import type { LexofficeSource } from "../source.ts";
import type { LexFile, LexVoucherListType } from "../types.ts";
import {
  SALES_TYPES,
  webBookkeepingVoucher,
  webContact,
  webListItem,
  webPayments,
  webPostingCategories,
  webSalesDocument,
  webVoucherType,
} from "./convert.ts";
import {
  WEB_EXPORT_FORMAT,
  WEB_EXPORT_VERSION,
  webContactSchema,
  webEntrySchema,
  webManifestSchema,
  type WebContact,
  type WebEntry,
} from "./schema.ts";

export { LexwareWebExportError };

/** Ein Beleg, den das Skript oder das Einlesen nicht laden konnte; er erscheint in der Liste der fehlgeschlagenen. */
export interface WebExportFailure {
  id: string;
  type: string | null;
  number: string;
  message: string;
}

/** Inhalt einer oder mehrerer Teile der Sicherung */
export interface WebExport {
  createdAt: string;
  contacts: WebContact[];
  entries: Map<string, WebEntry>;
  files: Map<string, Uint8Array>;
  failures: Map<string, WebExportFailure>;
}

const decoder = new TextDecoder();

function readJson<S extends z.ZodType>(files: Record<string, Uint8Array>, name: string, schema: S, partName: string): z.infer<S> {
  const bytes = files[name];
  if (!bytes) throw new LexwareWebExportError(`${partName}: ${name} fehlt – das ist keine Sicherung aus dem Skript für Lexware Office.`);
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LexwareWebExportError(`${partName}: ${name} ist kein gültiges JSON.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new LexwareWebExportError(`${partName}: ${name} hat ein unerwartetes Format.`);
  return parsed.data;
}

function unzip(bytes: Uint8Array, partName: string): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new LexwareWebExportError(`${partName}: keine gültige ZIP-Datei.`);
  }
}

/**
 * Liest die Teile einer Sicherung. Teile dürfen einzeln oder zusammen kommen; doppelte Belege und Kontakte
 * zählen einmal. Ein Beleg, dessen JSON nicht passt, wird als fehlgeschlagen gemeldet statt alles abzulehnen.
 */
export function readWebExport(parts: { name: string; bytes: Uint8Array }[]): WebExport {
  const result: WebExport = { createdAt: "", contacts: [], entries: new Map(), files: new Map(), failures: new Map() };
  const contacts = new Map<string, WebContact>();
  for (const part of parts) {
    const files = unzip(part.bytes, part.name);
    const manifest = readJson(files, "manifest.json", webManifestSchema, part.name);
    if (manifest.format !== WEB_EXPORT_FORMAT) {
      throw new LexwareWebExportError(`${part.name}: keine Sicherung aus dem Skript für Lexware Office.`);
    }
    if (manifest.version > WEB_EXPORT_VERSION) {
      throw new LexwareWebExportError(`${part.name}: Die Sicherung hat Version ${manifest.version}; diese Version von Haben liest bis Version ${WEB_EXPORT_VERSION}.`);
    }
    result.createdAt = manifest.createdAt;
    for (const c of readJson(files, "kontakte.json", webContactSchema.array(), part.name)) contacts.set(c.id, c);
    for (const failure of manifest.failed ?? []) {
      result.failures.set(failure.id, { id: failure.id, type: failure.type ?? null, number: failure.number ?? "", message: `In Lexware Office nicht geladen: ${failure.message}` });
    }
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith("dateien/")) result.files.set(name, bytes);
      const id = /^belege\/([^/]+)\.json$/.exec(name)?.[1];
      if (!id) continue;
      let parsed;
      try {
        parsed = webEntrySchema.safeParse(JSON.parse(decoder.decode(bytes)));
      } catch {
        parsed = null;
      }
      if (parsed?.success) {
        result.entries.set(id, parsed.data);
        result.failures.delete(id);
      } else if (!result.entries.has(id)) {
        result.failures.set(id, { id, type: null, number: "", message: `${name} in ${part.name} hat ein unerwartetes Format` });
      }
    }
  }
  result.contacts = [...contacts.values()];
  return result;
}

/**
 * Die Sicherung als Quelle für den Umzug, mit derselben Schnittstelle wie der Client der Public API.
 * Fehlgeschlagene Belege stehen in der Belegliste und werfen beim Abruf ihren Fehler; so landen sie
 * in der Liste der fehlgeschlagenen Belege, und ein späterer Upload holt sie nach.
 */
export function webExportSource(data: WebExport): LexofficeSource {
  const entry = (id: string): WebEntry => {
    const found = data.entries.get(id);
    if (found) return found;
    throw new LexwareWebExportError(data.failures.get(id)?.message ?? "Beleg fehlt in der Sicherung");
  };

  const fileOf = (id: string, path: string): LexFile => {
    const bytes = data.files.get(path);
    const meta = data.entries.get(id)?.files.find((f) => f.path === path);
    if (!bytes || !meta) throw new LexwareWebExportError(`Datei ${path} fehlt in der Sicherung`);
    return { bytes, mimeType: meta.mimeType, filename: meta.filename ?? null };
  };

  const firstFile = (id: string, role: "pdf" | "xml"): LexFile | null => {
    const meta = entry(id).files.find((f) => f.role === role);
    return meta ? fileOf(id, meta.path) : null;
  };

  return {
    async *contacts() {
      for (const c of data.contacts) yield webContact(c);
    },

    async postingCategories() {
      return webPostingCategories(data.entries.values());
    },

    async *voucherList(types: LexVoucherListType[]) {
      const wanted = new Set<string>(types);
      for (const e of data.entries.values()) {
        const item = webListItem(e.list);
        if (wanted.has(item.voucherType)) yield item;
      }
      for (const failure of data.failures.values()) {
        const subType = failure.type ?? "";
        const entityType = subType in SALES_TYPES ? "salesvoucher" : "bookkeepingvoucher";
        // Ohne erkennbare Art läuft der Beleg als Buchhaltungsbeleg; der Abruf meldet ohnehin den Fehler
        const voucherType = webVoucherType({ entityType, entitySubType: subType }) ?? "purchaseinvoice";
        if (wanted.has(voucherType)) yield { id: failure.id, voucherType, voucherStatus: "", voucherNumber: failure.number };
      }
    },

    async salesDocument(_type, id) {
      const e = entry(id);
      return { ...webSalesDocument(e), quelle: "lexware-web", web: e };
    },

    async salesDocumentPdf(_type, id) {
      return firstFile(id, "pdf");
    },

    async salesDocumentXml(_type, id) {
      return firstFile(id, "xml");
    },

    async voucher(id) {
      const e = entry(id);
      return { ...webBookkeepingVoucher(e), quelle: "lexware-web", web: e };
    },

    async file(path) {
      const id = /^dateien\/([^/]+)\//.exec(path)?.[1] ?? "";
      return fileOf(id, path);
    },

    async payments(id) {
      return webPayments(entry(id));
    },
  };
}
