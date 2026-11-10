import { MAIL_TEMPLATE_KEYS, type MailTemplates } from "@haben/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { MailError } from "./errors.ts";
import { readCertificate } from "./graph/certificate.ts";

/** Bekannte Anbieter zum Vorbelegen; Gmail und GMX brauchen ein App-Passwort bzw. freigeschaltetes SMTP */
export const SMTP_PRESETS = {
  gmail: { label: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  gmx: { label: "GMX", host: "mail.gmx.net", port: 465, secure: true },
  webde: { label: "web.de", host: "smtp.web.de", port: 587, secure: false },
  posteo: { label: "Posteo", host: "posteo.de", port: 465, secure: true },
  mailbox: { label: "mailbox.org", host: "smtp.mailbox.org", port: 465, secure: true },
} as const;

const email = z.string().trim().email("Keine gültige E-Mail-Adresse");
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Was beide Versandwege teilen: Absender, Erinnerungen, Vorlagen */
const common = {
  fromAddress: email,
  /** leer: der Firmenname */
  fromName: z.string().trim().max(200).default(""),
  reminderTo: email,
  remindersEnabled: z.boolean(),
  reminderDays: z.array(z.number().int().min(0).max(60)).max(5),
  /** Vorlagen je Art und Sprache („abschlag:en“); leere werden nicht gespeichert, dann gilt die allgemeine bzw. der Standardtext */
  templates: z
    .record(
      z.string().refine((key) => MAIL_TEMPLATE_KEYS.includes(key), "Unbekannte Vorlage"),
      z.object({ subject: z.string().trim().max(300).default(""), body: z.string().trim().max(5000).default("") }),
    )
    .default({})
    .transform((templates): MailTemplates => Object.fromEntries(Object.entries(templates).filter(([, t]) => t.subject || t.body))),
  pruefwertMail: z.boolean().default(true),
};

const smtpSchema = z.object({
  transport: z.literal("smtp"),
  host: z
    .string()
    .trim()
    .min(1, "Server fehlt")
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, "Nur der Servername, z. B. smtp.gmail.com"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1, "Benutzername fehlt").max(320),
  /** leer: das gespeicherte Passwort behalten */
  password: z.string().max(500).optional(),
  ...common,
});

const graphSchema = z.object({
  transport: z.literal("graph"),
  /** Verzeichnis-ID (GUID) oder Domäne des Tenants, z. B. firma.onmicrosoft.com */
  graphTenantId: z
    .string()
    .trim()
    .refine((v) => guid.test(v) || /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v), "Tenant-ID fehlt oder ist ungültig (GUID oder Domäne)"),
  graphClientId: z.string().trim().regex(guid, "Die Anwendungs-ID (Client-ID) ist eine GUID"),
  graphAuth: z.enum(["secret", "certificate"]),
  /** Postfach, aus dem gesendet wird (UPN oder Objekt-ID), wenn es von der Absenderadresse abweicht */
  graphMailbox: z.string().trim().max(320).default(""),
  /** Client Secret; leer: das gespeicherte behalten */
  clientSecret: z.string().max(500).optional(),
  /** Zertifikat und privater Schlüssel (PEM); beide leer: die gespeicherten behalten */
  certificatePem: z.string().max(20_000).optional(),
  privateKeyPem: z.string().max(20_000).optional(),
  ...common,
});

/** Eingaben ohne `transport` gelten als SMTP, wie vor dem zweiten Versandweg */
export const mailSettingsSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !("transport" in value) ? { ...value, transport: "smtp" } : value),
  z.discriminatedUnion("transport", [smtpSchema, graphSchema]),
);

export type MailSettingsInput = (Omit<z.input<typeof smtpSchema>, "transport"> & { transport?: "smtp" }) | z.input<typeof graphSchema>;

export async function loadMailSettings() {
  const [row] = await db.select().from(schema.mailSettings).where(eq(schema.mailSettings.id, 1));
  return row ?? null;
}

/** Was die Oberfläche sehen darf: alles außer dem Geheimnis; `hasSecret` sagt nur, dass eines gespeichert ist */
export async function mailSettingsSummary() {
  const row = await loadMailSettings();
  if (!row) return null;
  const { ciphertext, ...rest } = row;
  return { ...rest, hasSecret: ciphertext !== null, reminderDays: [...rest.reminderDays].sort((a, b) => b - a) };
}

const NO_SMTP = { host: null, port: null, secure: null, username: null } as const;
const NO_GRAPH = { graphTenantId: null, graphClientId: null, graphAuth: null, graphThumbprint: null, graphMailbox: null } as const;

/** Die Spalten des gewählten Versandwegs samt Geheimnis; ein leeres Geheimnis behält das gespeicherte, wenn es zum selben Weg gehört */
function credentials(data: z.output<typeof mailSettingsSchema>, existing: Awaited<ReturnType<typeof loadMailSettings>>) {
  if (data.transport === "smtp") {
    const keep = existing?.transport === "smtp" ? existing.ciphertext : null;
    if (!data.password && !keep) throw new MailError("Das Passwort fehlt.");
    return {
      ...NO_GRAPH,
      transport: "smtp" as const,
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.username,
      ciphertext: data.password ? encrypt(new TextEncoder().encode(data.password)) : keep,
    };
  }
  const base = {
    ...NO_SMTP,
    transport: "graph" as const,
    graphTenantId: data.graphTenantId,
    graphClientId: data.graphClientId,
    graphAuth: data.graphAuth,
    graphMailbox: data.graphMailbox || null,
  };
  const kept = existing?.transport === "graph" && existing.graphAuth === data.graphAuth;
  if (data.graphAuth === "secret") {
    if (!data.clientSecret && !(kept && existing.ciphertext)) throw new MailError("Das Client Secret fehlt.");
    return {
      ...base,
      graphThumbprint: null,
      ciphertext: data.clientSecret ? encrypt(new TextEncoder().encode(data.clientSecret.trim())) : existing!.ciphertext,
    };
  }
  const { certificatePem, privateKeyPem } = data;
  if (!certificatePem?.trim() && !privateKeyPem?.trim()) {
    if (!(kept && existing.ciphertext && existing.graphThumbprint)) throw new MailError("Zertifikat und privater Schlüssel fehlen.");
    return { ...base, graphThumbprint: existing.graphThumbprint, ciphertext: existing.ciphertext };
  }
  if (!certificatePem?.trim() || !privateKeyPem?.trim()) throw new MailError("Zertifikat und privater Schlüssel gehören zusammen: Beide Dateien angeben.");
  const certificate = readCertificate(certificatePem, privateKeyPem);
  return { ...base, graphThumbprint: certificate.thumbprint, ciphertext: encrypt(new TextEncoder().encode(certificate.privateKeyPem)) };
}

export async function saveMailSettings(actor: string, input: MailSettingsInput): Promise<void> {
  const data = mailSettingsSchema.parse(input);
  const existing = await loadMailSettings();
  const values = {
    fromAddress: data.fromAddress,
    fromName: data.fromName,
    reminderTo: data.reminderTo,
    remindersEnabled: data.remindersEnabled,
    reminderDays: [...new Set(data.reminderDays)].sort((a, b) => b - a),
    templates: data.templates,
    pruefwertMail: data.pruefwertMail,
    ...credentials(data, existing),
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.mailSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.mailSettings.id, set: values }),
  );
}

export async function deleteMailSettings(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.mailSettings).where(eq(schema.mailSettings.id, 1)));
}
