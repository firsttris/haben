import { and, asc, desc, gt, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { chainHead, formatPruefwert } from "../auswertungen/index.ts";
import { BOM, csvLine, iso, json } from "./csv.ts";
import { berlinStart } from "./jahr.ts";

// Änderungsprotokoll des Jahresarchivs: audit.csv ohne Geheimnisse und der Prüfwert der Hash-Kette

const encoder = new TextEncoder();

/** Felder, die nie ins Archiv dürfen (das Audit-Log früher Versionen enthielt sie noch) */
const SECRET_KEYS = new Set(["ciphertext", "pin_ciphertext", "calendar_token_hash"]);

function withoutSecrets(table: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !SECRET_KEYS.has(key));
  // Vom Zertifikat nur die unkritischen Metadaten
  if (table === "elster_certificates") {
    return Object.fromEntries(entries.filter(([key]) => ["id", "filename", "valid_until", "active", "uploaded_at"].includes(key)));
  }
  return Object.fromEntries(entries);
}

const yearOfAudit = (year: number) => sql`${schema.auditLog.at} >= ${berlinStart(year)} and ${schema.auditLog.at} < ${berlinStart(year + 1)}`;

/** In der Reihenfolge der Hash-Kette; Nr. ist die laufende ID, Ketten-Nr. die Position in der Kette */
export async function* auditCsv(year: number): AsyncGenerator<Uint8Array> {
  yield encoder.encode(
    BOM +
      csvLine([
        "Zeitpunkt",
        "Benutzer",
        "Tabelle",
        "Zeilen-ID",
        "Aktion",
        "Alter Wert (JSON)",
        "Neuer Wert (JSON)",
        "Nr.",
        "Ketten-Nr.",
        "Vorgänger-Hash",
        "Hash",
      ]),
  );
  let after = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(gt(schema.auditLog.seq, after), yearOfAudit(year)))
      .orderBy(asc(schema.auditLog.seq))
      .limit(1000);
    if (rows.length === 0) return;
    yield encoder.encode(
      rows
        .map((r) =>
          csvLine([
            iso(r.at),
            r.actor,
            r.tableName,
            r.rowId,
            r.action,
            json(withoutSecrets(r.tableName, r.oldValue)),
            json(withoutSecrets(r.tableName, r.newValue)),
            r.id,
            r.seq,
            r.prevHash.toString("hex"),
            r.rowHash.toString("hex"),
          ]),
        )
        .join(""),
    );
    after = rows.at(-1)!.seq;
  }
}

/** Kopf der Kette beim Erstellen und letzter Eintrag des Jahres, zum Aufbewahren außerhalb des Servers */
export async function pruefwertText(year: number, now: Date): Promise<string> {
  const [head, [last]] = await Promise.all([
    chainHead(),
    db
      .select({ seq: schema.auditLog.seq, hash: schema.auditLog.rowHash })
      .from(schema.auditLog)
      .where(yearOfAudit(year))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1),
  ]);
  return [
    `Prüfwert des Änderungsprotokolls`,
    ``,
    `Beim Erstellen dieses Archivs (${now.toISOString()}):`,
    head ? formatPruefwert(head) : "keiner",
    ``,
    `Letzter Eintrag des Jahres ${year}:`,
    last ? formatPruefwert({ seq: last.seq, hash: last.hash.toString("hex") }) : "keiner",
    ``,
    `In Haben unter Einstellungen → Export → Änderungsprotokoll prüfen einfügen und vergleichen.`,
    `Stimmt der Wert, sind Audit-Log und festgeschriebene Daten bis zu diesem Eintrag unverändert.`,
    ``,
  ].join("\n");
}
