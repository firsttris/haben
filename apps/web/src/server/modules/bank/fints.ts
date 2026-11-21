import { type FintsClient, type FintsZugang, fintsClient, fintsKonten, fintsSynchronisieren, fintsTanVerfahren } from "@haben/import";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { accountForIban } from "./accounts.ts";
import { BankError } from "./bank-error.ts";
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
 * Kontoabruf über FinTS (#654), Verbinden: Zugang prüfen, TAN-Verfahren wählen, Konten über die IBAN zuordnen und
 * gleich den ersten Abruf starten.
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
  if (!gewaehlt?.mediumNoetig || v.client.config.tanMediaName || gewaehlt.medien.length === 0) return speichern(v);
  if (gewaehlt.medien.length === 1) {
    v.client.selectTanMedia(gewaehlt.medien[0]!);
    return speichern(v);
  }
  const vorgang = vorgangMerken(v.actor, "verfahren", async ({ medium }) => {
    if (!medium || !gewaehlt.medien.includes(medium)) throw new BankError("Bitte ein TAN-Medium wählen.");
    v.client.selectTanMedia(medium);
    return speichern(v);
  });
  return { art: "verfahren", vorgang, verfahren: [{ id: gewaehlt.id, name: gewaehlt.name, medien: gewaehlt.medien }] };
}

function hinweiseZuKonten(neu: string[], ohneIban: number, fremd: string[]): string[] {
  const ohne = ohneIban > 0 ? `${ohneIban} Konten ohne IBAN oder ohne Umsatzabruf (z. B. Kreditkarten, Depots) ruft Haben nicht ab.` : null;
  return [neuAngelegt(neu), ohne, fremdwaehrung(fremd)].filter((h): h is string => h !== null);
}

/**
 * Legt die Verbindung an und ordnet die Konten über die IBAN zu (fehlende werden angelegt). Derselbe Zugang neu (Bank
 * und Anmeldename, etwa nach einer neuen PIN) behält seine Verbindung samt ID (#1617): Sie bekommt PIN, Bankdaten,
 * TAN-Verfahren und Konten; Status und „Zuletzt abgerufen“ schreibt erst der Abruf. Bricht er ab, gilt die neue PIN
 * trotzdem; die abgelehnte noch einmal zu schicken, sperrte bei vielen Banken den Zugang.
 * Konten, die bisher eine andere Verbindung abruft, gehen auf diese über; eine Zustimmung bei Enable Banking ohne
 * Konten endet ganz.
 */
async function speichern(v: Verbindung): Promise<FintsSchritt> {
  const { abrufbar, fremdwaehrung, ohneIban } = fintsKonten(v.client);
  if (abrufbar.length === 0) {
    return fehler(
      fremdwaehrung.length > 0
        ? "Die Bank hat nur Konten in Fremdwährung gemeldet; Haben bucht nur in Euro."
        : "Die Bank hat kein Konto mit IBAN und Umsatzabruf gemeldet.",
    );
  }
  const info = v.client.config.bankingInformation;
  const bankName = (info.bpd?.bankName || `Bank ${v.zugang.blz}`).slice(0, 100);
  const neu: string[] = [];
  const { id, accounts, beenden } = await withActor(v.actor, async (tx) => {
    const alle = await tx.select().from(schema.fintsConnections);
    const accounts: BankConnectionAccount[] = [];
    for (const konto of abrufbar) {
      const iban = konto.iban!.replace(/\s/g, "").toUpperCase();
      const [bekannt] = await tx.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, iban));
      const bankAccount = await accountForIban(tx, iban, `${bankName}${konto.product ? ` ${konto.product}` : ""} …${iban.slice(-4)}`.slice(0, 100));
      if (!bekannt) neu.push(bankAccount.name);
      const vorher = alle.flatMap((o) => o.accounts).find((a) => a.bankAccountId === bankAccount.id);
      accounts.push({
        uid: iban,
        iban,
        name: bankAccount.name,
        bankAccountId: bankAccount.id,
        syncedTo: vorher?.syncedTo ?? null,
        ...accountFetchFrom(vorher, v.fetchFrom),
      });
    }
    // Nimmt die Konten auch der eigenen Verbindung; sie bekommt sie gleich mit dem Abrufstand aus accounts zurück
    const beenden = await kontenUebernehmen(tx, new Set(accounts.map((a) => a.bankAccountId)));
    const werte = {
      bankName,
      url: v.zugang.url,
      customerId: v.zugang.kundenId ?? null,
      ciphertext: fintsGeheimnisVerschluesseln({ pin: v.zugang.pin, bankdaten: info }),
      tanMethod: v.client.config.tanMethodId ?? null,
      tanMedium: v.client.config.tanMediaName ?? null,
      accounts,
    };
    const zeile = { id: schema.fintsConnections.id };
    const bisher = alle.find((o) => o.bankCode === v.zugang.blz && o.login === v.zugang.benutzer);
    const [behalten] = bisher ? await tx.update(schema.fintsConnections).set(werte).where(eq(zeile.id, bisher.id)).returning(zeile) : [];
    // Ohne bisherige Verbindung, oder „Trennen“ kam ihr eben zuvor
    const [row] = behalten
      ? [behalten]
      : await tx
          .insert(schema.fintsConnections)
          .values({ ...werte, bankCode: v.zugang.blz, login: v.zugang.benutzer })
          .returning(zeile);
    return { id: row!.id, accounts, beenden };
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
    hinweise: hinweiseZuKonten(neu, ohneIban, fremdwaehrung),
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
