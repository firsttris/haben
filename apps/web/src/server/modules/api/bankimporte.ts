import { batchSchema } from "@haben/import";
import { z } from "zod";
import { externalSources, importExternalBatch } from "../bank/index.ts";
import { fail, ok, type ApiRequest, type ApiResult } from "./http.ts";
import { CENTS, isoDate, requestSchemas, responseSchemas, timestamp } from "./schemas.ts";

/*
 * REST-Import von Bankumsätzen (#306, Schritt 4): Ein Dienst liefert Bewegungen nach dem Importvertrag in eine Quelle,
 * die der Nutzer am Konto freigegeben hat. Haben baut daraus die Umsätze, ordnet nichts zu und bucht nichts. Prüfen,
 * Speichern und Abrufstand macht das Modul bank (externe-quellen.ts).
 */

batchSchema.register(requestSchemas, { id: "BankImport" });

export const bankImportResultSchema = z
  .object({
    replay: z.boolean().describe("true: dieselbe Lieferung kam schon (etwa nach verlorener Antwort); Haben hat nichts neu angelegt"),
    added: z.number().int().describe("Neu angelegte Umsätze"),
    skipped: z.number().int().describe("Schon bekannte oder nicht übernommene Bewegungen"),
    checkpoint: isoDate.nullable().describe("Bis einschließlich diesem Tag vollständig geliefert; null: noch kein Tag"),
    complete: z.boolean().describe("Ob diese Lieferung ihren Zeitraum abschließt; sonst nennt reason den Grund"),
    reason: z.string().nullable().describe("Warum der Zeitraum offen bleibt, etwa ein fehlender Teil oder ein nicht unterstütztes Ereignis"),
    warnings: z.array(z.string()).describe("Hinweise wie im Importprotokoll, etwa eine Erstattung ohne Bezug"),
  })
  .register(responseSchemas, { id: "BankImportResult" });

const bankSourceSchema = z.object({
  provider: z.string().describe("Anbieter, wie bei der Freigabe eingetragen"),
  externalAccountId: z.string().describe("Kennung des Kontos beim Anbieter"),
  accountKind: z.enum(["bank", "psp"]).describe("bank: Bankkonto; psp: Konto eines Zahlungsdienstleisters"),
  accountName: z.string().describe("Name des Kontos in Haben"),
  cutoverDate: isoDate.nullable().describe("Stichtag: erster Tag, den die Quelle liefert; Bewegungen davor nimmt Haben nicht an"),
  checkpoint: isoDate.nullable().describe("Bis einschließlich diesem Tag vollständig geliefert; null: noch nichts"),
  complete: z.boolean().describe("Ob die jüngste Lieferung ihren Zeitraum abgeschlossen hat"),
  lastDelivery: timestamp.nullable().describe("Zeitpunkt der jüngsten angenommenen Lieferung"),
  openConflicts: z.number().int().describe("Offene Konflikte; bis der Nutzer sie in Haben klärt, nimmt die Quelle nichts Neues an"),
});

export const bankSourceListSchema = z.object({ data: z.array(bankSourceSchema) }).register(responseSchemas, { id: "BankSourceList" });

export async function listBankSourcesHandler(): Promise<ApiResult> {
  const sources = await externalSources();
  return ok({
    data: sources.map((s) => ({
      provider: s.provider,
      externalAccountId: s.externalAccountId,
      accountKind: s.accountKind,
      accountName: s.accountName,
      cutoverDate: s.cutoverDate,
      checkpoint: s.checkpoint,
      complete: s.complete,
      lastDelivery: s.lastDelivery ? new Date(s.lastDelivery).toISOString() : null,
      openConflicts: s.openConflicts,
    })),
  });
}

export async function createBankImportHandler(request: ApiRequest): Promise<ApiResult> {
  const r = await importExternalBatch(request.actor, request.body);
  switch (r.status) {
    case "ok":
      return ok(
        {
          replay: r.result.replay,
          added: r.result.added,
          skipped: r.result.skipped,
          checkpoint: r.result.checkpoint ?? null,
          complete: r.result.complete,
          reason: r.result.reason ?? null,
          warnings: r.result.warnings,
        },
        r.result.replay ? 200 : 201,
      );
    case "not_found":
      return fail("not_found", r.message);
    case "too_large":
      return fail("payload_too_large", r.message);
    case "invalid":
      return fail("unprocessable", r.message, { issues: r.problems.map((message) => ({ path: "", message })) });
    case "conflict":
      return fail("conflict", r.message, {
        issues: r.conflicts.map((c) => ({
          path: `${c.sourceEventId}/${c.component}`,
          message: `${c.kind} am ${c.bookingDate} über ${c.amount} Cent weicht von der schon übernommenen Bewegung ab`,
        })),
      });
  }
}

export const BANK_IMPORT_DESCRIPTION =
  "Liefert Bewegungen nach dem Importvertrag (#306) in eine Quelle, die in Haben am Konto freigegeben ist (Bank › Konto › Externe Quelle hinzufügen). " +
  `Beträge in ganzen Cent (${CENTS}), Eingang positiv, Ausgang negativ; nur EUR. Höchstens 1.000 Bewegungen je Lieferung, mehr über mehrere Teile (part). ` +
  "Dieselbe Lieferung (gleicher idempotencyKey, gleicher Inhalt) noch einmal gibt das bisherige Ergebnis mit 200 zurück. " +
  "Haben legt Umsätze an, ordnet nichts zu und bucht nichts.";
