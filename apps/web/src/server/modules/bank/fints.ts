import { type FintsClient, type FintsKonto, type FintsZugang, fintsClient, fintsKonten, fintsSynchronisieren, fintsTanVerfahren } from "@haben/import";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { accountForIban, BankError } from "./bank.ts";
import { accountFetchFrom, zustimmungenBeenden } from "./bank-sync.ts";
import { kontenAbrufen } from "./fints-abruf.ts";
import { fintsGeheimnisVerschluesseln } from "./fints-geheim.ts";
import { fintsProduktOderFehler } from "./fints-produkt.ts";
import { type FintsSchritt, mitTan, vorgangMerken } from "./fints-vorgang.ts";
import { fremdwaehrung, kontenUebernehmen, neuAngelegt } from "./konto-uebernahme.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { BankConnectionAccount } from "../../db/schema.ts";
import { today as todayInGermany } from "../../today.ts";

/*
 * Kontoabruf über FinTS (#654), Verbinden: Zugang prüfen, TAN-Verfahren wählen, Konten wählen, über die IBAN zuordnen
 * und gleich den ersten Abruf starten.
 */

/** Nur https; http allein zur eigenen Maschine, auf der etwa ein Test die Bank nachbaut */
function fintsAdresseErlaubt(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(hostname));
  } catch {
    return false;
  }
}

export const fintsVerbindenSchema = z.object({
  blz: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "Die Bankleitzahl hat acht Ziffern."),
  url: z.string().trim().max(500).refine(fintsAdresseErlaubt, "Die FinTS-Adresse der Bank beginnt mit https://."),
  benutzer: z.string().trim().min(1, "Der Anmeldename fehlt.").max(100),
  kundenId: z.string().trim().max(100).optional(),
  pin: z.string().min(1, "Die PIN fehlt.").max(100),
  /** Erster Abruf neuer Konten ab diesem Tag; fehlt = ab Jahresbeginn */
  fetchFrom: z.iso.date().nullish(),
});

interface Verbindung {
  actor: string;
  client: FintsClient;
  zugang: FintsZugang;
  fetchFrom: string | null;
  today: string;
}

const fehler = async (meldung: string): Promise<FintsSchritt> => ({ art: "fertig", ok: false, meldung, hinweise: [], neu: 0 });

function ausfall(error: unknown): never {
  if (error instanceof BankError) throw error;
  throw new BankError(`Die Bank ist nicht erreichbar oder antwortet unerwartet: ${error instanceof Error ? error.message : String(error)}`);
}

/** Synchronisiert und geht mit dann weiter; eine TAN fragt der Browser ab */
async function synchronisieren(v: Verbindung, dann: () => Promise<FintsSchritt>): Promise<FintsSchritt> {
  let antwort;
  try {
    antwort = await fintsSynchronisieren(v.client);
  } catch (error) {
    ausfall(error);
  }
  return mitTan(v.actor, antwort, { weiter: (w) => fintsSynchronisieren(v.client, w), fertig: dann, abgelehnt: fehler, ausfall: async (e) => ausfall(e) });
}

/** Erster Schritt: Zugang prüfen; die erste Synchronisierung nennt die erlaubten TAN-Verfahren */
export async function fintsVerbinden(actor: string, input: z.input<typeof fintsVerbindenSchema>, today = todayInGermany()): Promise<FintsSchritt> {
  const produkt = fintsProduktOderFehler();
  const data = fintsVerbindenSchema.parse(input);
  if (data.fetchFrom && data.fetchFrom > today) throw new BankError("Der Abruf kann nicht in der Zukunft beginnen.");
  const zugang: FintsZugang = { url: data.url, blz: data.blz, benutzer: data.benutzer, kundenId: data.kundenId || null, pin: data.pin };
  const v: Verbindung = { actor, client: fintsClient(produkt, zugang), zugang, fetchFrom: data.fetchFrom ?? null, today };
  return synchronisieren(v, () => verfahrenWaehlen(v));
}

async function verfahrenWaehlen(v: Verbindung): Promise<FintsSchritt> {
  const verfahren = fintsTanVerfahren(v.client.config.bankingInformation);
  if (verfahren.length === 0) return fehler("Die Bank nennt für diesen Zugang kein TAN-Verfahren. Ist der Zugang für FinTS (HBCI mit PIN/TAN) freigeschaltet?");
  if (verfahren.length === 1) return mitVerfahren(v, verfahren[0]!.id);
  const vorgang = vorgangMerken(v.actor, "verfahren", ({ verfahren: id }) => mitVerfahren(v, id!));
  return { art: "verfahren", vorgang, verfahren: verfahren.map(({ id, name }) => ({ id, name, medien: [] })) };
}

/** Zweite Synchronisierung mit dem gewählten Verfahren: Erst sie bringt die Konten (UPD), oft nach einer TAN */
async function mitVerfahren(v: Verbindung, id: number): Promise<FintsSchritt> {
  if (!fintsTanVerfahren(v.client.config.bankingInformation).some((m) => m.id === id)) throw new BankError("Dieses TAN-Verfahren bietet die Bank nicht an.");
  v.client.selectTanMethod(id);
  return synchronisieren(v, () => mediumWaehlen(v));
}

/** Verlangt das Verfahren ein TAN-Medium (etwa eines von zwei Handys), wählt die Person es, wenn es mehrere gibt */
async function mediumWaehlen(v: Verbindung): Promise<FintsSchritt> {
  const gewaehlt = fintsTanVerfahren(v.client.config.bankingInformation).find((m) => m.id === v.client.config.tanMethodId);
  if (!gewaehlt?.mediumNoetig || v.client.config.tanMediaName || gewaehlt.medien.length === 0) return kontenWaehlen(v);
  if (gewaehlt.medien.length === 1) {
    v.client.selectTanMedia(gewaehlt.medien[0]!);
    return kontenWaehlen(v);
  }
  const vorgang = vorgangMerken(v.actor, "verfahren", async ({ medium }) => {
    if (!medium || !gewaehlt.medien.includes(medium)) throw new BankError("Bitte ein TAN-Medium wählen.");
    v.client.selectTanMedia(medium);
    return kontenWaehlen(v);
  });
  return { art: "verfahren", vorgang, verfahren: [{ id: gewaehlt.id, name: gewaehlt.name, medien: gewaehlt.medien }] };
}

const ibanVon = (konto: FintsKonto) => konto.iban!.replace(/\s/g, "").toUpperCase();

/** Derselbe Zugang: gleiche Bankleitzahl und gleicher Anmeldename */
const derselbeZugang = (v: Verbindung) => and(eq(schema.fintsConnections.bankCode, v.zugang.blz), eq(schema.fintsConnections.login, v.zugang.benutzer));

/**
 * Vorgewählt sind alle Konten; verbindet die Person einen Zugang neu („Zugang ändern“), die, die er bisher abruft. Ein
 * Konto, das unter Bank als „Gehört nicht zu dieser Firma“ ausgeschlossen ist (#462), nie.
 */
async function vorwahl(v: Verbindung, ibans: string[]): Promise<Set<string>> {
  const [bisher] = await db.select({ accounts: schema.fintsConnections.accounts }).from(schema.fintsConnections).where(derselbeZugang(v));
  const ausgeschlossen = await db
    .select({ iban: schema.bankAccounts.iban })
    .from(schema.bankAccounts)
    .where(and(inArray(schema.bankAccounts.iban, ibans), isNotNull(schema.bankAccounts.excludedAt)));
  const nein = new Set(ausgeschlossen.map((a) => a.iban));
  return new Set(ibans.filter((iban) => (bisher ? bisher.accounts.some((a) => a.iban === iban) : true) && !nein.has(iban)));
}

/**
 * Die Person wählt, welche Konten Haben übernimmt: Nur die gewählten legt Haben an und ruft sie ab. Die übrigen bekommen
 * kein Konto in Haben und keine Umsätze. Mit nur einem Konto gibt es nichts zu wählen.
 */
async function kontenWaehlen(v: Verbindung): Promise<FintsSchritt> {
  const konten = fintsKonten(v.client);
  if (konten.abrufbar.length === 0) {
    return fehler(
      konten.fremdwaehrung.length > 0
        ? "Die Bank hat nur Konten in Fremdwährung gemeldet; Haben bucht nur in Euro."
        : "Die Bank hat kein Konto mit IBAN und Umsatzabruf gemeldet.",
    );
  }
  if (konten.abrufbar.length === 1) return speichern(v, konten, konten.abrufbar);
  const gewaehlt = await vorwahl(v, konten.abrufbar.map(ibanVon));
  const vorgang = vorgangMerken(v.actor, "konten", async ({ konten: ibans = [] }) => {
    const auswahl = new Set(ibans.map((iban) => iban.replace(/\s/g, "").toUpperCase()));
    if ([...auswahl].some((iban) => !konten.abrufbar.some((k) => ibanVon(k) === iban)))
      throw new BankError("Dieses Konto hat die Bank nicht zum Abruf gemeldet.");
    return speichern(
      v,
      konten,
      konten.abrufbar.filter((k) => auswahl.has(ibanVon(k))),
    );
  });
  return {
    art: "konten",
    vorgang,
    konten: konten.abrufbar.map((k) => ({ iban: ibanVon(k), name: k.product || "Konto", gewaehlt: gewaehlt.has(ibanVon(k)) })),
  };
}

function hinweiseZuKonten(neu: string[], abgewaehlt: string[], ohneIban: number, fremd: string[]): string[] {
  const nichtMehr =
    abgewaehlt.length > 0
      ? `Nicht mehr abgerufen: ${abgewaehlt.join(", ")}. Die Umsätze bleiben; gehört ein Konto nicht zu dieser Firma, schließt du es unter Bank mit „Gehört nicht zu dieser Firma“ aus.`
      : null;
  const ohne = ohneIban > 0 ? `${ohneIban} Konten ohne IBAN oder ohne Umsatzabruf (z. B. Kreditkarten, Depots) ruft Haben nicht ab.` : null;
  return [neuAngelegt(neu), nichtMehr, ohne, fremdwaehrung(fremd)].filter((h): h is string => h !== null);
}

/**
 * Legt die Verbindung mit den gewählten Konten an und ordnet sie über die IBAN zu (fehlende werden angelegt). Ein neuer
 * Zugang derselben Bank mit demselben Anmeldenamen (etwa nach einer neuen PIN) löst den alten ab und übernimmt dessen
 * Abrufstand; ein Konto, das die Person dabei abwählt, behält seine Umsätze und wird nicht mehr abgerufen. Konten, die
 * bisher eine andere Verbindung abruft, gehen auf diese über; eine Zustimmung bei Enable Banking ohne Konten endet ganz.
 */
async function speichern(v: Verbindung, { fremdwaehrung, ohneIban }: ReturnType<typeof fintsKonten>, gewaehlt: FintsKonto[]): Promise<FintsSchritt> {
  const info = v.client.config.bankingInformation;
  const bankName = (info.bpd?.bankName || `Bank ${v.zugang.blz}`).slice(0, 100);
  const neu: string[] = [];
  const { id, accounts, beenden, abgewaehlt } = await withActor(v.actor, async (tx) => {
    const andere = await tx.select().from(schema.fintsConnections);
    const accounts: BankConnectionAccount[] = [];
    for (const konto of gewaehlt) {
      const iban = ibanVon(konto);
      const [bekannt] = await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, iban));
      const bankAccount = await accountForIban(tx, iban, `${bankName}${konto.product ? ` ${konto.product}` : ""} …${iban.slice(-4)}`.slice(0, 100));
      if (!bekannt) neu.push(bankAccount.name);
      const vorher = andere.flatMap((o) => o.accounts).find((a) => a.bankAccountId === bankAccount.id);
      accounts.push({
        uid: iban,
        iban,
        name: bankAccount.name,
        bankAccountId: bankAccount.id,
        syncedTo: vorher?.syncedTo ?? null,
        ...accountFetchFrom(vorher, v.fetchFrom),
      });
    }
    // Derselbe Zugang neu (etwa nach einer neuen PIN) löst den alten ab; dessen Abrufstand steht schon in accounts
    const [bisher] = await tx.delete(schema.fintsConnections).where(derselbeZugang(v)).returning({ accounts: schema.fintsConnections.accounts });
    const weg = (bisher?.accounts ?? []).map((a) => a.bankAccountId).filter((bid) => !accounts.some((a) => a.bankAccountId === bid));
    const abgewaehlt =
      weg.length === 0
        ? []
        : await tx
            .select({ name: schema.bankAccounts.name })
            .from(schema.bankAccounts)
            .where(and(inArray(schema.bankAccounts.id, weg), isNull(schema.bankAccounts.excludedAt)));
    const beenden = await kontenUebernehmen(tx, new Set(accounts.map((a) => a.bankAccountId)));
    const [row] = await tx
      .insert(schema.fintsConnections)
      .values({
        bankName,
        bankCode: v.zugang.blz,
        url: v.zugang.url,
        login: v.zugang.benutzer,
        customerId: v.zugang.kundenId ?? null,
        ciphertext: fintsGeheimnisVerschluesseln({ pin: v.zugang.pin, bankdaten: info }),
        tanMethod: v.client.config.tanMethodId ?? null,
        tanMedium: v.client.config.tanMediaName ?? null,
        accounts,
      })
      .returning({ id: schema.fintsConnections.id });
    return { id: row!.id, accounts, beenden, abgewaehlt: abgewaehlt.map((a) => a.name) };
  });
  await zustimmungenBeenden(beenden);
  return kontenAbrufen({
    actor: v.actor,
    id,
    client: v.client,
    pin: v.zugang.pin,
    today: v.today,
    interaktiv: true,
    bankName,
    accounts,
    einleitung: `${bankName} verbunden`,
    hinweise: hinweiseZuKonten(neu, abgewaehlt, ohneIban, fremdwaehrung),
  });
}

/** Verbindungen für die Bankseite, ohne PIN und Bankdaten */
export async function listFintsConnections() {
  const rows = await db
    .select({
      id: schema.fintsConnections.id,
      bankName: schema.fintsConnections.bankName,
      bankCode: schema.fintsConnections.bankCode,
      url: schema.fintsConnections.url,
      login: schema.fintsConnections.login,
      customerId: schema.fintsConnections.customerId,
      status: schema.fintsConnections.status,
      accounts: schema.fintsConnections.accounts,
      lastSyncAt: schema.fintsConnections.lastSyncAt,
      lastError: schema.fintsConnections.lastError,
      createdAt: schema.fintsConnections.createdAt,
    })
    .from(schema.fintsConnections)
    .orderBy(desc(schema.fintsConnections.createdAt));
  const known = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name, excludedAt: schema.bankAccounts.excludedAt })
    .from(schema.bankAccounts);
  const names = new Map(known.map((a) => [a.id, a.name]));
  const excluded = new Set(known.filter((a) => a.excludedAt).map((a) => a.id));
  return rows.map((r) => ({
    ...r,
    accounts: r.accounts.map((a) => ({ ...a, name: names.get(a.bankAccountId) ?? a.name, excluded: excluded.has(a.bankAccountId) })),
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Trennt eine FinTS-Verbindung: PIN und Bankdaten werden gelöscht, die Umsätze bleiben */
export async function removeFintsConnection(actor: string, id: string): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx.delete(schema.fintsConnections).where(eq(schema.fintsConnections.id, id)).returning({ id: schema.fintsConnections.id }),
  );
  if (!row) throw new BankError("Verbindung nicht gefunden.");
}
