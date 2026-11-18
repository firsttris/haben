import {
  EVATR_URL,
  evatrAnfrage,
  type EvatrAnfrage,
  type EvatrAntwort,
  evatrAntwortSchema,
  type EvatrArt,
  evatrFrischGueltig,
  evatrGueltig,
  evatrMeldung,
  evatrNachweis,
  evatrNeuNoetig,
  evatrPruefbar,
  evatrQualifizierbar,
  evatrZeitpunkt,
  isValidGermanUstId,
  normalizeUstId,
} from "@haben/core";
import { desc, eq, inArray } from "drizzle-orm";
import { formatDate } from "../../../lib/format.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { loadCompany } from "./company.ts";
import { ContactError } from "./contacts.ts";

/*
 * USt-IdNr. eines Kontakts beim BZSt bestätigen lassen (§ 18e UStG, #1385), über die eVatR-REST-API. Erst einfach, dann
 * mit Name und Anschrift qualifiziert, wie die FAQ des BZSt es verlangen; jede Antwort zur Nummer bleibt als Nachweis in
 * ustid_bestaetigungen (nur anhängbar). Ein Fehler des Dienstes ändert nichts und kommt als Hinweis zurück: Das BZSt bittet,
 * bei Zeitüberschreitung später erneut zu fragen statt sofort, deshalb wiederholt Haben nicht selbst.
 * `HABEN_EVATR=off` schaltet die Abfrage ab.
 */

const TIMEOUT_MS = 20_000;
/** Die Antworten sind ein kleines JSON-Objekt; was weit darüber liegt, ist keine Antwort der Abfrage */
const MAX_ANTWORT = 10_000;

export type UstIdBestaetigung = typeof schema.ustidBestaetigungen.$inferSelect;

/** Ob am Kontakt bestätigt werden kann, und wenn ja, ob nach dem Speichern eine Abfrage fällig ist */
export type UstIdBestaetigungsZustand = { art: "aus" } | { art: "ohne-eigene" } | { art: "nicht-pruefbar" } | { art: "bereit"; faellig: boolean };

export interface UstIdBestaetigungsErgebnis {
  /** Neu gespeicherte Antworten */
  neu: number;
  /** Was nicht bestätigt werden konnte, sonst null */
  hinweis: string | null;
}

export interface EvatrVerbindung {
  fetch: typeof fetch;
  url: string;
}

const verbindung = (): EvatrVerbindung => ({ fetch, url: env().EVATR_API_URL ?? EVATR_URL });

export const evatrAbgeschaltet = () => process.env.HABEN_EVATR === "off";

const ZUSTAND_TEXT: Record<Exclude<UstIdBestaetigungsZustand["art"], "bereit">, string> = {
  aus: "Die Bestätigung beim BZSt ist auf dieser Installation abgeschaltet (HABEN_EVATR=off).",
  "ohne-eigene": "Für die Bestätigung braucht es deine deutsche USt-IdNr. in den Firmendaten.",
  "nicht-pruefbar": "Bestätigen lässt sich nur die USt-IdNr. eines anderen EU-Mitgliedstaats mit passendem Aufbau.",
};

/** Antworten des BZSt zu einem Kontakt, neueste zuerst */
export async function listUstIdBestaetigungen(contactId: string): Promise<UstIdBestaetigung[]> {
  return db
    .select()
    .from(schema.ustidBestaetigungen)
    .where(eq(schema.ustidBestaetigungen.contactId, contactId))
    .orderBy(desc(schema.ustidBestaetigungen.createdAt), desc(schema.ustidBestaetigungen.anfrageZeitpunkt));
}

function zustandFuer(contact: { ustId: string; name: string; strasse: string; plz: string; ort: string }, eigene: string, bisher: UstIdBestaetigung[]) {
  if (evatrAbgeschaltet()) return { art: "aus" } as const;
  if (!evatrPruefbar(contact.ustId)) return { art: "nicht-pruefbar" } as const;
  if (!isValidGermanUstId(normalizeUstId(eigene))) return { art: "ohne-eigene" } as const;
  return { art: "bereit", faellig: evatrNeuNoetig(contact, bisher) } as const;
}

async function ladeKontakt(contactId: string) {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) throw new ContactError("Kontakt nicht gefunden.");
  return contact;
}

/**
 * Für die Kontaktseite: bisherige Antworten und ob sich bestätigen lässt. Ein unbekannter Kontakt wirft hier nicht, damit
 * die Seite „nicht gefunden“ von getContactDetail zeigt (wie getMandates).
 */
export async function ustIdBestaetigungen(contactId: string): Promise<{ bestaetigungen: UstIdBestaetigung[]; zustand: UstIdBestaetigungsZustand }> {
  const [[contact], company, bestaetigungen] = await Promise.all([
    db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)),
    loadCompany(),
    listUstIdBestaetigungen(contactId),
  ]);
  return { bestaetigungen, zustand: contact ? zustandFuer(contact, company.ustId, bestaetigungen) : { art: "nicht-pruefbar" } };
}

type Abfrage = { ok: true; antwort: EvatrAntwort; text: string; zeitpunkt: Date } | { ok: false; hinweis: string };

const KEINE_ANTWORT = "Keine Antwort vom BZSt (Zeitüberschreitung oder Dienst nicht erreichbar); versuch es später noch einmal";
const UNLESBAR = "Die Antwort des BZSt ließ sich nicht lesen; gespeichert ist nichts, versuch es später noch einmal";

/** Eine Abfrage; jede Antwort in der Form der API kommt zurück, auch Fehler (4xx, 5xx), deren Meldung der Hinweis nennt */
async function frage(anfrage: EvatrAnfrage, via: EvatrVerbindung): Promise<Abfrage> {
  let text: string;
  try {
    const response = await via.fetch(via.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(anfrage),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch {
    // Zeitüberschreitung, kein Netz
    return { ok: false, hinweis: KEINE_ANTWORT };
  }
  const parsed = text.length > MAX_ANTWORT ? null : evatrAntwortSchema.safeParse(parseJson(text));
  if (!parsed?.success) return { ok: false, hinweis: UNLESBAR };
  if (!evatrNachweis(parsed.data.status)) return { ok: false, hinweis: evatrMeldung(parsed.data) };
  // Ohne lesbaren Zeitpunkt des BZSt kein Nachweis; die OpenAPI nennt für das Feld kein Format
  const zeitpunkt = evatrZeitpunkt(parsed.data.anfrageZeitpunkt);
  if (!zeitpunkt) return { ok: false, hinweis: UNLESBAR };
  return { ok: true, antwort: parsed.data, text, zeitpunkt };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function speichere(actor: string, contactId: string, art: EvatrArt, anfrage: EvatrAnfrage, abfrage: Extract<Abfrage, { ok: true }>) {
  const { antwort } = abfrage;
  await withActor(actor, (tx) =>
    tx.insert(schema.ustidBestaetigungen).values({
      contactId,
      art,
      anfragendeUstid: anfrage.anfragendeUstid,
      angefragteUstid: anfrage.angefragteUstid,
      firmenname: anfrage.firmenname ?? null,
      strasse: anfrage.strasse ?? null,
      plz: anfrage.plz ?? null,
      ort: anfrage.ort ?? null,
      status: antwort.status,
      anfrageZeitpunkt: abfrage.zeitpunkt,
      gueltigAb: antwort.gueltigAb ?? null,
      gueltigBis: antwort.gueltigBis ?? null,
      ergFirmenname: antwort.ergFirmenname ?? null,
      ergStrasse: antwort.ergStrasse ?? null,
      ergPlz: antwort.ergPlz ?? null,
      ergOrt: antwort.ergOrt ?? null,
      bzstId: antwort.id ?? null,
      antwort: abfrage.text,
      createdBy: actor,
    }),
  );
}

/**
 * Fragt die USt-IdNr. des Kontakts ab und speichert jede Antwort zur Nummer sofort, damit ein späterer Fehler den Nachweis
 * nicht verliert. Mit nurWennFaellig (nach dem Speichern des Kontakts) fragt es nur, wenn evatrNeuNoetig das sagt, und
 * meldet nichts, wenn sich gar nicht bestätigen lässt.
 */
export async function bestaetigeUstId(
  actor: string,
  contactId: string,
  options: { nurWennFaellig?: boolean } = {},
  via: EvatrVerbindung = verbindung(),
): Promise<UstIdBestaetigungsErgebnis> {
  const [contact, company, bisher] = await Promise.all([ladeKontakt(contactId), loadCompany(), listUstIdBestaetigungen(contactId)]);
  const zustand = zustandFuer(contact, company.ustId, bisher);
  if (zustand.art !== "bereit") {
    if (options.nurWennFaellig) return { neu: 0, hinweis: null };
    throw new ContactError(ZUSTAND_TEXT[zustand.art]);
  }
  if (options.nurWennFaellig && !zustand.faellig) return { neu: 0, hinweis: null };

  const einfach = evatrAnfrage(company.ustId, contact, "einfach");
  const ersteAntwort = await frage(einfach, via);
  if (!ersteAntwort.ok) return { neu: 0, hinweis: ersteAntwort.hinweis };
  await speichere(actor, contactId, "einfach", einfach, ersteAntwort);
  // Name und Anschrift vergleicht das BZSt nur bei gültiger Nummer
  if (!evatrGueltig(ersteAntwort.antwort.status) || !evatrQualifizierbar(contact)) return { neu: 1, hinweis: null };

  const qualifiziert = evatrAnfrage(company.ustId, contact, "qualifiziert");
  const zweiteAntwort = await frage(qualifiziert, via);
  if (!zweiteAntwort.ok) return { neu: 1, hinweis: `Name und Anschrift nicht bestätigt: ${zweiteAntwort.hinweis}` };
  await speichere(actor, contactId, "qualifiziert", qualifiziert, zweiteAntwort);
  return { neu: 2, hinweis: null };
}

/** Letzte Antwort je angefragter Nummer, gleich an welchem Kontakt; für die Vorprüfung der ZM */
export async function letzteBestaetigungen(nummern: readonly string[]): Promise<Map<string, UstIdBestaetigung>> {
  const letzte = new Map<string, UstIdBestaetigung>();
  if (!nummern.length) return letzte;
  const b = schema.ustidBestaetigungen;
  const rows = await db
    .select()
    .from(b)
    .where(inArray(b.angefragteUstid, [...nummern]))
    .orderBy(desc(b.createdAt), desc(b.anfrageZeitpunkt));
  for (const row of rows) if (!letzte.has(row.angefragteUstid)) letzte.set(row.angefragteUstid, row);
  return letzte;
}

/** Ob sich überhaupt bestätigen lässt: eingeschaltet und mit gültiger eigener USt-IdNr. */
export async function evatrMoeglich(): Promise<boolean> {
  return !evatrAbgeschaltet() && isValidGermanUstId(normalizeUstId((await loadCompany()).ustId));
}

/**
 * Einfache Abfrage einer bestimmten Nummer, etwa einer in der Zusammenfassenden Meldung gemeldeten, die von der heutigen am
 * Kontakt abweichen kann. Der Nachweis kommt an den Kontakt der Rechnung.
 */
export async function bestaetigeNummer(
  actor: string,
  contactId: string,
  ustId: string,
  via: EvatrVerbindung = verbindung(),
): Promise<{ hinweis: string | null; gespeichert: boolean }> {
  if (evatrAbgeschaltet()) throw new ContactError(ZUSTAND_TEXT.aus);
  const company = await loadCompany();
  if (!isValidGermanUstId(normalizeUstId(company.ustId))) throw new ContactError(ZUSTAND_TEXT["ohne-eigene"]);
  if (!evatrPruefbar(ustId)) return { hinweis: `${ustId}: ${ZUSTAND_TEXT["nicht-pruefbar"]}`, gespeichert: false };
  const anfrage: EvatrAnfrage = { anfragendeUstid: normalizeUstId(company.ustId), angefragteUstid: normalizeUstId(ustId) };
  const antwort = await frage(anfrage, via);
  if (!antwort.ok) return { hinweis: `${anfrage.angefragteUstid}: ${antwort.hinweis}`, gespeichert: false };
  await speichere(actor, contactId, "einfach", anfrage, antwort);
  return { hinweis: null, gespeichert: true };
}

/**
 * Vor dem Festschreiben einer Rechnung mit Reverse Charge oder innergemeinschaftlicher Lieferung (#1385): Ist die letzte
 * Antwort zur Nummer des Kontakts gültig und höchstens EVATR_FRIST_TAGE alt, gibt es nichts zu sagen; sonst fragt Haben das
 * BZSt neu. Zurück kommt ein Hinweis für die Rückfrage oder null; das Festschreiben sperrt er nie. Abgeschaltet wie vorher.
 */
export async function ustIdVorFestschreiben(
  actor: string,
  contactId: string,
  jetzt = new Date(),
  via: EvatrVerbindung = verbindung(),
): Promise<{ hinweis: string | null }> {
  const contact = await ladeKontakt(contactId);
  const nummer = normalizeUstId(contact.ustId);
  const letzteZurNummer = async () => (await listUstIdBestaetigungen(contactId)).find((b) => b.angefragteUstid === nummer);
  const vorher = await letzteZurNummer();
  if (evatrFrischGueltig(vorher, jetzt) || evatrAbgeschaltet()) return { hinweis: null };
  // Ohne Nummer meldet das Festschreiben selbst, was fehlt (outgoingTaxIssues); den Aufbau prüft es nur bei der Lieferung
  if (!nummer) return { hinweis: null };
  if (!evatrPruefbar(nummer)) return { hinweis: `${nummer}: ${ZUSTAND_TEXT["nicht-pruefbar"]}` };
  let ergebnis: UstIdBestaetigungsErgebnis;
  try {
    ergebnis = await bestaetigeUstId(actor, contactId, {}, via);
  } catch (error) {
    if (error instanceof ContactError) return { hinweis: `${nummer}: ${error.message}` };
    throw error;
  }
  const neu = await letzteZurNummer();
  if (neu && neu.id !== vorher?.id) return { hinweis: evatrGueltig(neu.status) ? null : `Laut BZSt ist ${nummer} nicht gültig: ${evatrMeldung(neu)}.` };
  const zuletzt = vorher ? `Zuletzt am ${formatDate(vorher.anfrageZeitpunkt)}: ${evatrMeldung(vorher)}.` : "Bestätigt ist sie noch nicht.";
  return { hinweis: `${nummer} ließ sich gerade nicht beim BZSt bestätigen: ${ergebnis.hinweis}. ${zuletzt}` };
}
