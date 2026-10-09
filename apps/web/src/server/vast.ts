import { parseVastBeleg, TEST_HERSTELLER_ID, vastBelegartLabel, type ElsterClient } from "@haben/elster";
import { desc, eq } from "drizzle-orm";
import { loadCompany } from "./company.ts";
import { decrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { FinanzamtError } from "./finanzamt.ts";
import { loadActiveCertificate } from "./vat.ts";

export interface VastFetchOptions {
  kind: "test" | "send";
  year: number;
  /** a = steuerpflichtige Person, b = Ehegatte */
  person: "a" | "b";
  /** leer: die gespeicherte PIN (beim Postfachabruf hinterlegt, gilt für alle Abrufe mit dem Zertifikat) */
  pin?: string;
  herstellerId?: string;
}

export interface VastFetchSummary {
  ok: boolean;
  message: string;
  /** Belege laut ELSTER */
  gefunden: number;
  /** neu gespeicherte Belege */
  neu: number;
  fehler: { id: string; fehler: string }[];
}

/**
 * Gemeinsame Vorbereitung für Belegabruf und Berechtigungen: Hersteller-ID, kein Echtabruf ohne ERiC,
 * Zertifikat und PIN. Ohne eingegebene PIN gilt die gespeicherte: Sie wird beim Postfachabruf hinterlegt,
 * aber auch für Belegabruf und Berechtigungsanträge genutzt; die Oberfläche zeigt das im PIN-Feld an.
 */
export async function prepareElsterAbruf(client: ElsterClient, options: { kind: "test" | "send"; pin?: string; herstellerId?: string }) {
  const test = options.kind !== "send";
  // ERiC 43 sperrt die Test-Hersteller-ID 74931; auch Testfälle laufen mit der eigenen, falls vorhanden
  const herstellerId = options.herstellerId || (test ? TEST_HERSTELLER_ID : undefined);
  if (!herstellerId) throw new FinanzamtError("Für den echten Abruf fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
  if (!test && "isFake" in client && client.isFake) {
    throw new FinanzamtError("Ohne ERiC ist kein echter Abruf möglich; der Testabruf läuft nur simuliert.");
  }
  const certificate = await loadActiveCertificate();
  if (!certificate) throw new FinanzamtError("Es ist kein ELSTER-Zertifikat hinterlegt.");
  const pin = options.pin || (certificate.pinCiphertext ? new TextDecoder().decode(decrypt(certificate.pinCiphertext)) : "");
  if (!pin) throw new FinanzamtError("Die Zertifikats-PIN fehlt.");
  return { test, herstellerId, pfx: decrypt(certificate.ciphertext), pin };
}

/**
 * Holt die Belege der vorausgefüllten Steuererklärung (Lohnsteuerbescheinigung, Rentenbezüge, Beiträge …)
 * für eine Person und ein Jahr von ELSTER, entschlüsselt und speichert sie. Bereits gespeicherte Belege
 * bleiben, wie sie sind; ein berichtigter Beleg kommt bei ELSTER mit neuer ID.
 */
export async function fetchVastBelege(actor: string, client: ElsterClient, options: VastFetchOptions): Promise<VastFetchSummary> {
  const { test, herstellerId, pfx, pin } = await prepareElsterAbruf(client, options);
  const company = await loadCompany();
  const person = company.taxpayer[options.person];
  if (!person) {
    throw new FinanzamtError(
      options.person === "a" ? "Persönliche Angaben fehlen (Einstellungen → Steuerpflichtige Person)." : "Angaben zum Ehegatten fehlen (Einstellungen).",
    );
  }
  const datenlieferant = `${company.taxpayer.a?.vorname ?? ""} ${company.taxpayer.a?.name ?? ""}`.trim() || company.name || "Haben";

  const result = await client.fetchBelege(
    { idnr: person.idnr, veranlagungsjahr: options.year, datenlieferant, herstellerId, test },
    pfx,
    pin,
  );
  const refs = new Map(result.liste.map((ref) => [ref.id, ref]));
  const fehler = result.belege.flatMap((b) => (b.fehler ? [{ id: b.id, fehler: b.fehler }] : []));

  const neu = await withActor(actor, async (tx) => {
    const [request] = await tx
      .insert(schema.vastRequests)
      .values({
        person: options.person,
        idnr: person.idnr,
        year: options.year,
        test,
        ok: result.ok,
        code: result.code,
        message: result.message,
        fehler,
        requestXml: result.requestXml,
        responseXml: result.responseXml,
        serverResponseXml: result.serverResponseXml,
        abholung: result.abholung ?? null,
      })
      .returning({ id: schema.vastRequests.id });
    const rows = result.belege.flatMap((b) => {
      const ref = refs.get(b.id);
      if (!b.xml || !ref) return [];
      return [
        {
          belegId: b.id,
          person: options.person,
          idnr: person.idnr,
          year: options.year,
          belegart: ref.belegart,
          schemaversion: ref.schemaversion,
          hashwert: ref.hashwert,
          xml: b.xml,
          test,
          requestId: request!.id,
        },
      ];
    });
    if (rows.length === 0) return 0;
    const inserted = await tx.insert(schema.vastBelege).values(rows).onConflictDoNothing().returning({ id: schema.vastBelege.id });
    return inserted.length;
  });

  const gefunden = result.liste.length;
  let message = result.message;
  if (result.ok) {
    message =
      gefunden === 0
        ? `ELSTER hat für ${options.year} keine Belege zu ${person.vorname} ${person.name}.`
        : `${gefunden} Beleg${gefunden === 1 ? "" : "e"} bei ELSTER, ${neu} neu gespeichert.`;
  }
  return { ok: result.ok, message, gefunden, neu, fehler };
}

/** Gespeicherte Belege eines Jahres, lesbar aufbereitet; Testbelege nur, wenn es keine echten gibt */
export async function listVastBelege(year: number) {
  const rows = await db
    .select({
      id: schema.vastBelege.id,
      belegId: schema.vastBelege.belegId,
      person: schema.vastBelege.person,
      belegart: schema.vastBelege.belegart,
      xml: schema.vastBelege.xml,
      test: schema.vastBelege.test,
      fetchedAt: schema.vastBelege.fetchedAt,
    })
    .from(schema.vastBelege)
    .where(eq(schema.vastBelege.year, year))
    .orderBy(schema.vastBelege.person, schema.vastBelege.belegart, desc(schema.vastBelege.fetchedAt));
  const live = rows.some((r) => !r.test);
  // Persönliche Daten nach den Belegen mit Beträgen
  const rang = (belegart: string) => (belegart.startsWith("VaSt_Pers") ? 1 : 0);
  return rows
    .filter((r) => !live || !r.test)
    .sort((x, y) => x.person.localeCompare(y.person) || rang(x.belegart) - rang(y.belegart))
    .map(({ xml, ...row }) => {
      let werte: { pfad: string[]; wert: string }[] = [];
      let lesbar = true;
      try {
        werte = parseVastBeleg(xml).flatMap((b) => b.werte);
      } catch {
        lesbar = false;
      }
      return { ...row, label: vastBelegartLabel(row.belegart), werte, lesbar };
    });
}

export async function lastVastRequest(year: number) {
  const [row] = await db
    .select({
      createdAt: schema.vastRequests.createdAt,
      ok: schema.vastRequests.ok,
      message: schema.vastRequests.message,
      test: schema.vastRequests.test,
      person: schema.vastRequests.person,
    })
    .from(schema.vastRequests)
    .where(eq(schema.vastRequests.year, year))
    .orderBy(desc(schema.vastRequests.createdAt))
    .limit(1);
  return row ?? null;
}

export async function vastBelegXml(id: string) {
  const [row] = await db
    .select({ xml: schema.vastBelege.xml, belegart: schema.vastBelege.belegart, year: schema.vastBelege.year })
    .from(schema.vastBelege)
    .where(eq(schema.vastBelege.id, id));
  return row;
}
