import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import pkg from "../../../../../../package.json" with { type: "json" };
import { databaseAccessInfo, db, schema, type DatabaseAccessInfo } from "../../db/index.ts";
import { env } from "../../env.ts";
import { ssoOnly } from "../../sso-policy.ts";
import { chainHead } from "../auswertungen/index.ts";
import { backupOverview, listAppVersions, type AppVersionEntry, type BackupOverview } from "../betrieb/index.ts";
import { loadMailSettings } from "../mail/index.ts";
import { listAccounts, listSsoAccounts } from "../zugang/index.ts";

/**
 * Was Haben über die eigene Instanz weiß, für die Verfahrensdokumentation (#860). Nur Namen, Rollen, Zeitpunkte und
 * Schalter: Keine Abfrage liest eine Spalte `ciphertext`, einen Token-Hash oder ein Zertifikat.
 */

export interface Zugang {
  name: string;
  email: string;
  role: string | null;
  createdAt: Date | null;
  lockedAt: Date | null;
  lastLoginAt: Date | null;
}

export interface InstanzStand {
  version: string;
  company: {
    name: string;
    rechtsform: (typeof schema.company.$inferSelect)["rechtsform"];
    strasse: string;
    plz: string;
    ort: string;
    kontenrahmen: (typeof schema.company.$inferSelect)["kontenrahmen"];
    versteuerung: (typeof schema.company.$inferSelect)["versteuerung"];
    kleinunternehmer: boolean;
    invoiceNumberFormat: string;
    quoteNumberFormat: string;
    invoiceCounterRunning: boolean;
    quoteCounterRunning: boolean;
    invoiceCounterPerCustomer: boolean;
    quoteCounterPerCustomer: boolean;
    customerNumberFormat: string;
    datevBeraterNr: string;
    datevMandantNr: string;
    mcpEnabled: boolean;
  } | null;
  sso: boolean;
  zugaenge: Zugang[];
  tokens: { name: string; scopes: string[]; expiresAt: Date }[];
  datenbank: DatabaseAccessInfo;
  backup: BackupOverview;
  versionen: AppVersionEntry[];
  pruefwert: { seq: number; hash: string } | null;
  pruefwertMail: string | null;
  postfach: { username: string; host: string; folder: string } | null;
  /** Ablage festgeschriebener Rechnungen im Archiv: nur der Ursprung der Adresse, Pfad und Anfrage können Kennungen tragen */
  ablage: { origin: string; since: Date } | null;
  elster: { validUntil: string | null } | null;
  voranmeldungenGesendet: number;
  bankkonten: { name: string; purpose: string }[];
  bankabruf: { aspspName: string; status: string; validUntil: Date | null; lastSyncAt: Date | null }[];
  /** Kontoabruf über FinTS (#654) */
  fintsabruf: { bankName: string; status: string; lastSyncAt: Date | null }[];
}

async function company(): Promise<InstanzStand["company"]> {
  const c = schema.company;
  const [row] = await db
    .select({
      name: c.name,
      rechtsform: c.rechtsform,
      strasse: c.strasse,
      plz: c.plz,
      ort: c.ort,
      kontenrahmen: c.kontenrahmen,
      versteuerung: c.versteuerung,
      kleinunternehmer: c.kleinunternehmer,
      invoiceNumberFormat: c.invoiceNumberFormat,
      quoteNumberFormat: c.quoteNumberFormat,
      invoiceCounterRunning: c.invoiceCounterRunning,
      quoteCounterRunning: c.quoteCounterRunning,
      invoiceCounterPerCustomer: c.invoiceCounterPerCustomer,
      quoteCounterPerCustomer: c.quoteCounterPerCustomer,
      customerNumberFormat: c.customerNumberFormat,
      datevBeraterNr: c.datevBeraterNr,
      datevMandantNr: c.datevMandantNr,
      mcpEnabled: c.mcpEnabled,
    })
    .from(c)
    .where(eq(c.id, 1));
  return row ?? null;
}

async function zugaenge(): Promise<Zugang[]> {
  if (ssoOnly()) {
    const accounts = await listSsoAccounts(env().OIDC_ISSUER!);
    return accounts.map((a) => ({ name: a.name, email: a.email, role: a.role, createdAt: null, lockedAt: null, lastLoginAt: a.lastLoginAt }));
  }
  const accounts = await listAccounts();
  return accounts.map((a) => ({ name: a.name, email: a.email, role: a.role, createdAt: a.createdAt, lockedAt: a.lockedAt, lastLoginAt: a.lastLoginAt }));
}

/** Nur gültige Tokens: Name, Rechte und Ablauf, nie Hash oder Anfang des Tokens */
async function tokens(now: Date) {
  const t = schema.mcpTokens;
  const rows = await db
    .select({ name: t.name, scopes: t.scopes, expiresAt: t.expiresAt })
    .from(t)
    .where(and(isNull(t.revokedAt), isNull(t.disabledAt)))
    .orderBy(t.createdAt);
  return rows.filter((r) => r.expiresAt > now);
}

async function postfach() {
  const i = schema.inboxSettings;
  const [row] = await db
    .select({ username: i.username, host: i.host, folder: i.folder })
    .from(i)
    .where(and(eq(i.id, 1), eq(i.enabled, true)));
  return row ?? null;
}

async function ablage() {
  const a = schema.archiveTarget;
  const [row] = await db
    .select({ url: a.url, since: a.since })
    .from(a)
    .where(and(eq(a.id, 1), eq(a.enabled, true)));
  return row ? { origin: new URL(row.url).origin, since: row.since } : null;
}

async function elster() {
  const e = schema.elsterCertificates;
  const [row] = await db.select({ validUntil: e.validUntil }).from(e).where(eq(e.active, true)).orderBy(desc(e.uploadedAt)).limit(1);
  return row ?? null;
}

async function voranmeldungenGesendet(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.vatReturns).where(eq(schema.vatReturns.status, "sent"));
  return row?.n ?? 0;
}

async function bankkonten() {
  const a = schema.bankAccounts;
  return db.select({ name: a.name, purpose: a.purpose }).from(a).where(isNull(a.excludedAt)).orderBy(a.createdAt);
}

async function bankabruf() {
  const c = schema.bankConnections;
  return db
    .select({ aspspName: c.aspspName, status: c.status, validUntil: c.validUntil, lastSyncAt: c.lastSyncAt })
    .from(c)
    .where(ne(c.status, "wartet"))
    .orderBy(c.createdAt);
}

async function fintsabruf() {
  const c = schema.fintsConnections;
  return db.select({ bankName: c.bankName, status: c.status, lastSyncAt: c.lastSyncAt }).from(c).orderBy(c.createdAt);
}

export async function readInstanzStand(now = new Date()): Promise<InstanzStand> {
  const [firma, accounts, apiTokens, datenbank, backup, versionen, head, mail, inbox, archiv, cert, gesendet, konten, abruf, fints] = await Promise.all([
    company(),
    zugaenge(),
    tokens(now),
    databaseAccessInfo(),
    backupOverview(now),
    listAppVersions(),
    chainHead(),
    loadMailSettings(),
    postfach(),
    ablage(),
    elster(),
    voranmeldungenGesendet(),
    bankkonten(),
    bankabruf(),
    fintsabruf(),
  ]);
  return {
    version: pkg.version,
    company: firma,
    sso: ssoOnly(),
    zugaenge: accounts,
    tokens: apiTokens,
    datenbank,
    backup,
    versionen,
    pruefwert: head && { seq: head.seq, hash: head.hash },
    pruefwertMail: mail?.pruefwertMail ? mail.reminderTo : null,
    postfach: inbox,
    ablage: archiv,
    elster: cert,
    voranmeldungenGesendet: gesendet,
    bankkonten: konten,
    bankabruf: abruf,
    fintsabruf: fints,
  };
}
