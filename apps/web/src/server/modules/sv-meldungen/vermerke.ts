import { isDeepStrictEqual } from "node:util";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { lockFileUse } from "../../db/file-in-use.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { SvPortalWert } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { loadFile, sha256Of, sniff, storeFile } from "../../storage.ts";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { alleMeldungen, beitragsnachweiseImMonat, beitragsnachweisTitel, listenDaten, werteVon } from "./liste.ts";

/*
 * Vermerk „im Portal abgegeben“: Der Nutzer hält fest, dass er einen Beitragsnachweis oder eine Meldung im
 * SV-Meldeportal abgegeben hat, mit Tag und auf Wunsch dem Protokoll des Portals. Nur anhängbar und im Audit-Log
 * (Trigger aus 0140); eine Rücknahme ist eine neue Zeile. Titel und Werte bildet der Server selbst aus der Liste, nicht
 * aus Angaben des Browsers.
 */

export class SvMeldungError extends UserError {}

export type Vermerk = typeof schema.svPortalFilings.$inferSelect;

export const vermerkSchema = z.object({
  gegenstand: z.string().trim().min(1).max(200),
  datum: z.iso.date("Datum im Format JJJJ-MM-TT"),
  notiz: z.string().trim().max(500).default(""),
});

export const ruecknahmeSchema = z.object({ id: z.uuid(), grund: z.string().trim().min(1, "Grund fehlt").max(500) });

export interface Protokoll {
  bytes: Uint8Array;
  filename: string;
}

/** Dateiname ohne Pfad und Steuerzeichen */
function dateiname(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen gehören nicht in einen Dateinamen
  const name = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.slice(0, 200) || "Protokoll";
}

/** PDF oder Bildschirmfoto, am Inhalt erkannt, höchstens 20 MB wie Belege */
function protokollTyp(p: Protokoll): string {
  if (p.bytes.byteLength === 0) throw new SvMeldungError("Das Protokoll ist leer.");
  if (p.bytes.byteLength > MAX_DOCUMENT_SIZE) throw new SvMeldungError("Das Protokoll ist größer als 20 MB.");
  const typ = sniff(p.bytes);
  if (!typ || !["pdf", "png", "jpeg"].includes(typ.kind)) throw new SvMeldungError("Als Protokoll gehen PDF, PNG oder JPEG.");
  return typ.mimeType;
}

/** Was zum Gegenstand gerade in der Liste steht; null, wenn es ihn nicht gibt */
async function eintrag(gegenstand: string, heute: string, q: Tx) {
  const d = await listenDaten(q);
  const bn = /^beitragsnachweis:(\d{4})-(\d{2}):/.exec(gegenstand);
  if (bn) {
    const treffer = beitragsnachweiseImMonat(d, Number(bn[1]), Number(bn[2])).find((b) => b.gegenstand === gegenstand);
    return treffer ? { art: "beitragsnachweis" as const, titel: beitragsnachweisTitel(treffer), employeeId: null, werte: werteVon(treffer) } : null;
  }
  const meldung = alleMeldungen(d, Number(heute.slice(0, 4))).find((m) => m.gegenstand === gegenstand);
  return meldung ? { art: meldung.art, titel: meldung.titel, employeeId: meldung.employeeId, werte: werteVon(meldung) } : null;
}

/** Hält fest, dass der Gegenstand im Portal abgegeben ist; legt das Protokoll im Dokumentenspeicher ab */
export async function vermerken(actor: string, input: z.input<typeof vermerkSchema>, heute: string, protokoll?: Protokoll): Promise<string> {
  const { gegenstand, datum, notiz } = vermerkSchema.parse(input);
  if (datum > heute) throw new SvMeldungError("Das Datum der Abgabe liegt in der Zukunft.");
  const mimeType = protokoll ? protokollTyp(protokoll) : null;
  const sha256 = protokoll ? sha256Of(protokoll.bytes) : null;
  return withActor(actor, async (tx) => {
    const e = await eintrag(gegenstand, heute, tx);
    if (!e) throw new SvMeldungError("Diesen Beitragsnachweis oder diese Meldung gibt es in der Liste nicht.");
    if (protokoll && sha256) {
      // Unter der Sperre auf den Hash ablegen, damit ein gleichzeitiges Löschen derselben Datei sie nicht entfernt
      await lockFileUse(tx, sha256);
      await storeFile(protokoll.bytes);
    }
    const [row] = await tx
      .insert(schema.svPortalFilings)
      .values({
        gegenstand,
        art: e.art,
        titel: e.titel,
        employeeId: e.employeeId,
        datum,
        werte: e.werte,
        notiz,
        ...(protokoll && sha256
          ? {
              protokollSha256: sha256,
              protokollDateiname: dateiname(protokoll.filename),
              protokollMimeType: mimeType,
              protokollGroesse: protokoll.bytes.byteLength,
            }
          : {}),
      })
      .returning({ id: schema.svPortalFilings.id });
    return row!.id;
  });
}

/** Nimmt einen Vermerk zurück, etwa wenn er versehentlich gesetzt ist; der Vermerk selbst bleibt stehen */
export async function zuruecknehmen(actor: string, input: z.input<typeof ruecknahmeSchema>, heute: string): Promise<void> {
  const { id, grund } = ruecknahmeSchema.parse(input);
  await withActor(actor, async (tx) => {
    const [v] = await tx.select().from(schema.svPortalFilings).where(eq(schema.svPortalFilings.id, id)).for("update");
    if (!v || v.revokesId) throw new SvMeldungError("Den Vermerk gibt es nicht.");
    const [schon] = await tx.select({ id: schema.svPortalFilings.id }).from(schema.svPortalFilings).where(eq(schema.svPortalFilings.revokesId, id));
    if (schon) throw new SvMeldungError("Der Vermerk ist schon zurückgenommen.");
    await tx.insert(schema.svPortalFilings).values({
      gegenstand: v.gegenstand,
      art: v.art,
      titel: v.titel,
      employeeId: v.employeeId,
      datum: heute,
      werte: [],
      notiz: grund,
      revokesId: id,
    });
  });
}

export async function listVermerke(q: Db | Tx = db): Promise<Vermerk[]> {
  return q.select().from(schema.svPortalFilings).orderBy(asc(schema.svPortalFilings.createdAt), asc(schema.svPortalFilings.id));
}

export interface VermerkStand {
  /** Gültige Vermerke, ältester zuerst */
  vermerke: (Pick<Vermerk, "id" | "datum" | "notiz" | "protokollDateiname" | "protokollGroesse" | "createdAt"> & { geaendert: boolean })[];
  /** Zurückgenommene Vermerke mit Grund */
  zurueckgenommen: { id: string; datum: string; grund: string; abgegebenAm: string }[];
  abgegeben: boolean;
  /** Die Liste weicht vom letzten gültigen Vermerk ab: im Portal korrigieren */
  geaendert: boolean;
}

/** Stand der Vermerke je Gegenstand, verglichen mit den Werten, die die Liste jetzt zeigt */
export function vermerkStand(alle: Vermerk[], gegenstand: string, werte: SvPortalWert[]): VermerkStand {
  const eigene = alle.filter((v) => v.gegenstand === gegenstand);
  const ruecknahmen = new Map(eigene.filter((v) => v.revokesId).map((v) => [v.revokesId!, v]));
  const vermerke = eigene
    .filter((v) => !v.revokesId && !ruecknahmen.has(v.id))
    .map((v) => ({
      id: v.id,
      datum: v.datum,
      notiz: v.notiz,
      protokollDateiname: v.protokollDateiname,
      protokollGroesse: v.protokollGroesse,
      createdAt: v.createdAt,
      geaendert: !isDeepStrictEqual(v.werte, werte),
    }));
  const zurueckgenommen = eigene
    .filter((v) => ruecknahmen.has(v.id))
    .map((v) => ({ id: v.id, datum: ruecknahmen.get(v.id)!.datum, grund: ruecknahmen.get(v.id)!.notiz, abgegebenAm: v.datum }));
  const letzter = vermerke.at(-1);
  return { vermerke, zurueckgenommen, abgegeben: Boolean(letzter), geaendert: letzter?.geaendert ?? false };
}

/** Protokoll eines Vermerks zum Ansehen */
export async function loadProtokoll(id: string): Promise<{ filename: string; mimeType: string; bytes: Buffer } | null> {
  const [v] = await db.select().from(schema.svPortalFilings).where(eq(schema.svPortalFilings.id, id));
  if (!v?.protokollSha256 || !v.protokollDateiname || !v.protokollMimeType) return null;
  return { filename: v.protokollDateiname, mimeType: v.protokollMimeType, bytes: await loadFile(v.protokollSha256) };
}
