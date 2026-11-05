import { formatEuro, periodKey, periodRange, vatReturnSendProblem, type Cents } from "@haben/core";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { lockFileUse } from "../../db/file-in-use.ts";
import { db, schema } from "../../db/index.ts";
import { loadFile, sha256Of, sniff, storeFile } from "../../storage.ts";
import { today } from "../../today.ts";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { underSendLock } from "../elster/index.ts";
import { saveDraft, VatError, type VatReturn } from "./vat.ts";
import { loadFrequencies, periodProblem } from "./zeitraum.ts";

/*
 * Abgabe vermerken: Eine Voranmeldung, die außerhalb von Haben abgegeben wurde (XML-Import in Mein ELSTER, Erweiterung
 * „Haben für Mein ELSTER“, KI-Assistent), wird mit Tag der Abgabe, Transferticket und Übermittlungsprotokoll an der
 * Anmeldung festgehalten und festgeschrieben wie nach einer Übermittlung über ERiC (submitReturn). Die Frist ist damit
 * erledigt, und die Zahllast wird ein offener Posten (zahlung.ts).
 */

export interface VermerkInput {
  /** Tag der Abgabe laut Übermittlungsprotokoll, JJJJ-MM-TT */
  filedOn: string;
  transferTicket: string;
  /** Kz 83 laut Protokoll in Cent; muss der Anmeldung entsprechen */
  kz83: Cents;
  /** Übermittlungsprotokoll aus Mein ELSTER (PDF) */
  file: { bytes: Uint8Array; filename: string };
}

/** Transfertickets von ELSTER bestehen aus Buchstaben und Ziffern; Bindestrich und Punkt lassen wir zu */
const TICKET = /^[A-Za-z0-9][A-Za-z0-9.-]{3,63}$/;

/** Was gegen die Eingaben spricht, die ohne Datenbank prüfbar sind, oder null */
export function vermerkProblem(input: VermerkInput, period: { year: number; month: number }, heute: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.filedOn) || Number.isNaN(Date.parse(input.filedOn))) return "Bitte den Tag der Abgabe angeben.";
  if (input.filedOn > heute) return "Der Tag der Abgabe liegt in der Zukunft.";
  if (input.filedOn < periodRange(period).start) return "Der Tag der Abgabe liegt vor Beginn des Zeitraums.";
  if (!TICKET.test(input.transferTicket.trim())) return "Bitte das Transferticket aus dem Übermittlungsprotokoll angeben (Buchstaben und Ziffern).";
  if (input.file.bytes.byteLength === 0) return "Die Datei des Protokolls ist leer.";
  if (input.file.bytes.byteLength > MAX_DOCUMENT_SIZE) return "Das Protokoll ist größer als 20 MB.";
  if (sniff(input.file.bytes)?.kind !== "pdf") return "Das Übermittlungsprotokoll muss eine PDF-Datei sein.";
  return null;
}

function protocolFilename(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gehören nicht in einen Dateinamen
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  if (!name) return "Übermittlungsprotokoll.pdf";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/**
 * Vermerkt die Abgabe außerhalb von Haben. Unter derselben Sendesperre wie die Übermittlung über ERiC, damit nicht beide
 * zugleich festschreiben. Ein berechneter Entwurf wird vorher auf den Stand der Buchungen gebracht, wie vor dem Senden.
 * Weicht Kz 83 laut Protokoll von der Anmeldung ab, lehnt Haben ab: Dann ist beim Finanzamt etwas anderes angekommen,
 * und die Anmeldung müsste erst angepasst (manuell überschrieben) werden.
 */
export function vermerkeAbgabe(actor: string, returnId: string, input: VermerkInput, heute = today()): Promise<VatReturn> {
  return underSendLock(`haben.ustva.${returnId}`, "send", async () => {
    let [vatReturn] = await db.select().from(schema.vatReturns).where(eq(schema.vatReturns.id, returnId));
    if (!vatReturn) throw new VatError("Anmeldung nicht gefunden.");
    const sendProblem = vatReturnSendProblem(vatReturn);
    if (sendProblem) throw new VatError(sendProblem);
    const problem = vermerkProblem(input, vatReturn, heute) ?? (vatReturn.berichtigt ? null : periodProblem(await loadFrequencies(), vatReturn));
    if (problem) throw new VatError(problem);
    const transferTicket = input.transferTicket.trim();
    const [usedTicket] = await db
      .select({ year: schema.vatReturns.year, month: schema.vatReturns.month })
      .from(schema.vatReturns)
      .where(and(eq(schema.vatReturns.transferTicket, transferTicket), ne(schema.vatReturns.id, returnId)));
    if (usedTicket) throw new VatError(`Das Transferticket ist schon bei der Voranmeldung ${periodKey(usedTicket)} vermerkt.`);
    if (vatReturn.source === "berechnet") {
      vatReturn = await saveDraft(actor, { year: vatReturn.year, month: vatReturn.month }, { mode: "berechnet" });
    }
    const sha256 = sha256Of(input.file.bytes);
    return withActor(actor, async (tx) => {
      const [locked] = await tx.select().from(schema.vatReturns).where(eq(schema.vatReturns.id, returnId)).for("update");
      const lockedProblem = locked ? vatReturnSendProblem(locked) : "Anmeldung nicht gefunden.";
      if (lockedProblem) throw new VatError(lockedProblem);
      if (locked!.kz83 !== input.kz83) {
        throw new VatError(
          `Kz 83 laut Protokoll (${formatEuro(input.kz83)}) weicht von der Voranmeldung (${formatEuro(locked!.kz83)}) ab. Gemeldet ist also etwas anderes; passe die Anmeldung an (manuell überschreiben, mit Begründung) und vermerke dann.`,
        );
      }
      await lockFileUse(tx, sha256);
      await storeFile(input.file.bytes);
      await tx.insert(schema.vatReturnFilings).values({
        vatReturnId: returnId,
        filedOn: input.filedOn,
        transferTicket,
        kz83: input.kz83,
        filename: protocolFilename(input.file.filename),
        sha256,
        size: input.file.bytes.byteLength,
      });
      const now = new Date();
      const [sent] = await tx
        .update(schema.vatReturns)
        .set({ status: "sent", transferTicket, sentAt: now, lockedAt: now, updatedAt: now })
        .where(eq(schema.vatReturns.id, returnId))
        .returning();
      return sent!;
    });
  });
}

export type VatReturnFiling = Omit<typeof schema.vatReturnFilings.$inferSelect, "sha256">;

/** Abgabevermerke der Anmeldungen, für Verlauf und Archiv */
export async function filingsFor(returnIds: string[]): Promise<VatReturnFiling[]> {
  if (returnIds.length === 0) return [];
  const f = schema.vatReturnFilings;
  return db
    .select({
      id: f.id,
      vatReturnId: f.vatReturnId,
      filedOn: f.filedOn,
      transferTicket: f.transferTicket,
      kz83: f.kz83,
      filename: f.filename,
      size: f.size,
      createdAt: f.createdAt,
    })
    .from(f)
    .where(inArray(f.vatReturnId, returnIds))
    .orderBy(asc(f.createdAt));
}

/** Übermittlungsprotokoll eines Vermerks zum Anzeigen; die Datei prüft loadFile gegen ihren SHA-256 */
export async function loadFilingProtocol(id: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const [row] = await db
    .select({ sha256: schema.vatReturnFilings.sha256, filename: schema.vatReturnFilings.filename })
    .from(schema.vatReturnFilings)
    .where(eq(schema.vatReturnFilings.id, id));
  if (!row) return null;
  return { pdf: new Uint8Array(await loadFile(row.sha256)), filename: row.filename };
}
