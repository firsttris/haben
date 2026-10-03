import {
  buildPostfachAnfrageXml,
  buildPostfachBestaetigungXml,
  postfachDateiname,
  TEST_HERSTELLER_ID,
  type ElsterClient,
  type PostfachBereitstellung,
} from "@haben/elster";
import { and, desc, eq } from "drizzle-orm";
import { loadCompany } from "./company.ts";
import { decrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { FinanzamtError } from "./finanzamt.ts";
import { sniff, storeFile } from "./storage.ts";
import { loadActiveCertificate, PRODUKT_VERSION } from "./vat.ts";

export interface PostfachFetchOptions {
  kind: "test" | "send";
  pin: string;
  herstellerId?: string;
}

export interface PostfachFetchSummary {
  ok: boolean;
  message: string;
  /** neu gespeicherte Dokumente */
  neu: number;
  fehler: { referenzId: string; fehler: string }[];
  bestaetigt: number;
  /** Fehlertext der Bestätigung, falls sie scheiterte */
  bestaetigungFehler: string | null;
}

export async function listPostfachDocuments(limit = 200) {
  return db
    .select({
      id: schema.postfachDocuments.id,
      datenart: schema.postfachDocuments.datenart,
      veranlagungszeitraum: schema.postfachDocuments.veranlagungszeitraum,
      bescheiddatum: schema.postfachDocuments.bescheiddatum,
      dateibezeichnung: schema.postfachDocuments.dateibezeichnung,
      filename: schema.postfachDocuments.filename,
      mimeType: schema.postfachDocuments.mimeType,
      size: schema.postfachDocuments.size,
      test: schema.postfachDocuments.test,
      fetchedAt: schema.postfachDocuments.fetchedAt,
    })
    .from(schema.postfachDocuments)
    .orderBy(desc(schema.postfachDocuments.fetchedAt))
    .limit(limit);
}

export async function postfachDocumentFile(id: string) {
  const [row] = await db
    .select({ sha256: schema.postfachDocuments.sha256, mimeType: schema.postfachDocuments.mimeType, filename: schema.postfachDocuments.filename })
    .from(schema.postfachDocuments)
    .where(eq(schema.postfachDocuments.id, id));
  return row;
}

export async function lastPostfachRequest() {
  const [row] = await db
    .select({ createdAt: schema.postfachRequests.createdAt, ok: schema.postfachRequests.ok, message: schema.postfachRequests.message, test: schema.postfachRequests.test })
    .from(schema.postfachRequests)
    .where(eq(schema.postfachRequests.art, "anfrage"))
    .orderBy(desc(schema.postfachRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/** Vollständig abgeholte, aber noch nicht bestätigte Bereitstellungen */
export async function pendingConfirmations(test: boolean): Promise<string[]> {
  const rows = await db
    .select({ art: schema.postfachRequests.art, ids: schema.postfachRequests.bereitstellungIds })
    .from(schema.postfachRequests)
    .where(and(eq(schema.postfachRequests.test, test), eq(schema.postfachRequests.ok, true)));
  const abgeholt = new Set(rows.filter((r) => r.art === "anfrage").flatMap((r) => r.ids));
  for (const id of rows.filter((r) => r.art === "bestaetigung").flatMap((r) => r.ids)) abgeholt.delete(id);
  return [...abgeholt];
}

/**
 * Holt Bescheide und Mitteilungen aus dem ELSTER-Postfach, speichert sie und bestätigt danach die Abholung.
 * Bestätigt wird nur, was vollständig gespeichert ist; eine gescheiterte Bestätigung holt der nächste Abruf nach.
 */
export async function fetchPostfach(actor: string, client: ElsterClient, options: PostfachFetchOptions): Promise<PostfachFetchSummary> {
  const test = options.kind !== "send";
  const herstellerId = test ? TEST_HERSTELLER_ID : options.herstellerId;
  if (!herstellerId) throw new FinanzamtError("Für den echten Abruf fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
  if (!test && "isFake" in client && client.isFake) {
    throw new FinanzamtError("Ohne ERiC ist kein echter Abruf möglich; der Testabruf läuft nur simuliert.");
  }
  if (!options.pin) throw new FinanzamtError("Die Zertifikats-PIN fehlt.");
  const certificate = await loadActiveCertificate();
  if (!certificate) throw new FinanzamtError("Es ist kein ELSTER-Zertifikat hinterlegt.");
  const company = await loadCompany();
  const person = company.taxpayer.a;
  const datenlieferant = (person ? `${person.vorname} ${person.name}` : company.name).trim() || "Haben";
  const xmlInput = { datenlieferant, herstellerId, produktVersion: PRODUKT_VERSION, test };
  const pfx = decrypt(certificate.ciphertext);

  const anfrageXml = buildPostfachAnfrageXml(xmlInput);
  const result = await client.fetchPostfach(anfrageXml, pfx, options.pin, { test, herstellerId });

  const inhalt = new Map(result.dateien.flatMap((d) => (d.inhalt ? [[d.referenzId, d.inhalt] as const] : [])));
  const fehler = result.dateien.flatMap((d) => (d.fehler ? [{ referenzId: d.referenzId, fehler: d.fehler }] : []));
  const stored = await storeAll(result.bereitstellungen, inhalt);
  const complete = result.bereitstellungen
    .filter((b) => b.anhaenge.length > 0 && b.anhaenge.every((a) => stored.has(a.referenzId)))
    .map((b) => b.id);

  const neu = await withActor(actor, async (tx) => {
    const [request] = await tx
      .insert(schema.postfachRequests)
      .values({
        art: "anfrage",
        test,
        ok: result.ok,
        code: result.code,
        message: result.message,
        bereitstellungIds: complete,
        fehler,
        requestXml: anfrageXml,
        responseXml: result.responseXml,
        serverResponseXml: result.serverResponseXml,
      })
      .returning({ id: schema.postfachRequests.id });
    const rows = result.bereitstellungen.flatMap((b) =>
      b.anhaenge.flatMap((a) => {
        const file = stored.get(a.referenzId);
        if (!file) return [];
        return [
          {
            referenzId: a.referenzId,
            bereitstellungId: b.id,
            datenart: b.datenart,
            veranlagungszeitraum: b.veranlagungszeitraum,
            steuernummer: b.steuernummer,
            bescheiddatum: b.bescheiddatum,
            dateibezeichnung: a.dateibezeichnung,
            mimeType: file.mimeType,
            filename: postfachDateiname(b, a),
            sha256: file.sha256,
            size: file.size,
            test,
            requestId: request!.id,
          },
        ];
      }),
    );
    if (rows.length === 0) return 0;
    const inserted = await tx.insert(schema.postfachDocuments).values(rows).onConflictDoNothing().returning({ id: schema.postfachDocuments.id });
    return inserted.length;
  });

  if (!result.ok) return { ok: false, message: result.message, neu, fehler, bestaetigt: 0, bestaetigungFehler: null };

  const pending = await pendingConfirmations(test);
  let bestaetigt = 0;
  let bestaetigungFehler: string | null = null;
  if (pending.length > 0) {
    const bestaetigungXml = buildPostfachBestaetigungXml(pending, xmlInput);
    const confirmation = await client.send(bestaetigungXml, pfx, options.pin, { test, print: false });
    await withActor(actor, (tx) =>
      tx.insert(schema.postfachRequests).values({
        art: "bestaetigung",
        test,
        ok: confirmation.ok,
        code: confirmation.code,
        message: confirmation.message,
        bereitstellungIds: pending,
        requestXml: bestaetigungXml,
        responseXml: confirmation.responseXml,
        serverResponseXml: confirmation.serverResponseXml,
      }),
    );
    if (confirmation.ok) bestaetigt = pending.length;
    else bestaetigungFehler = confirmation.message;
  }

  const message =
    neu === 0 && fehler.length === 0 ? "Keine neuen Dokumente im Postfach." : `${neu} neue${neu === 1 ? "s" : ""} Dokument${neu === 1 ? "" : "e"} abgeholt.`;
  return { ok: true, message, neu, fehler, bestaetigt, bestaetigungFehler };
}

/** Legt die Anhänge im Dokumentenspeicher ab; Typ nach Inhalt, sonst laut ELSTER */
async function storeAll(bereitstellungen: PostfachBereitstellung[], inhalt: Map<string, Uint8Array>) {
  const stored = new Map<string, { sha256: string; mimeType: string; size: number }>();
  for (const anhang of bereitstellungen.flatMap((b) => b.anhaenge)) {
    const bytes = inhalt.get(anhang.referenzId);
    if (!bytes) continue;
    const sha256 = await storeFile(bytes);
    const mimeType = sniff(bytes)?.mimeType ?? (anhang.dateityp || "application/octet-stream");
    stored.set(anhang.referenzId, { sha256, mimeType, size: bytes.byteLength });
  }
  return stored;
}
