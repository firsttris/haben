import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ROLLEN } from "../../lib/rollen.ts";

// Tabellen für Better Auth (Kern + Passkey-Plugin)

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Lokale Rolle des Zugangs (Standardmodus). Vorgabe ist die mit den wenigsten Rechten: Inhaber wird nur das erste
     * Konto der Einrichtung (Hook in server/auth.ts), jedes weitere kommt mit der Rolle seiner Einladung. Konten, die nur
     * per SSO entstehen, legt der Hook ausdrücklich ohne lokale Rolle an; ihre Rolle steht in sso_roles.
     */
    role: text("role", { enum: ROLLEN }).default("steuerberatung"),
    /** Gesperrt vom Inhaber: keine neue Sitzung, laufende sind gelöscht */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  // Genau ein Inhaber, auch bei zwei gleichzeitigen Einrichtungen
  (t) => [uniqueIndex("user_inhaber_single").on(t.role).where(sql`${t.role} = 'inhaber'`), check("user_role", sql`${t.role} in ('inhaber', 'steuerberatung')`)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    oidcIssuer: text("oidc_issuer"),
    /** SSO-Modus: beim Callback bestätigte Rolle, Zeitpunkt der Prüfung und feste Frist; Refresh verlängert sie nicht */
    ssoRole: text("sso_role", { enum: ROLLEN }),
    ssoCheckedAt: timestamp("sso_checked_at", { withTimezone: true }),
    ssoExpiresAt: timestamp("sso_expires_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    uniqueIndex("account_oidc_identity_unique").on(t.providerId, t.accountId).where(sql`${t.providerId} = 'oidc'`),
  ],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId), index("passkey_credential_id_idx").on(t.credentialID)],
);

/**
 * Einladungen für weitere Zugänge (Steuerberatung). Der Link enthält ein zufälliges Token, gespeichert ist nur sein
 * SHA-256; einmal einlösbar und nur bis expires_at. Audit-Log per Trigger.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: ROLLEN }).notNull(),
    /** Vom Inhaber vergeben, z. B. „Kanzlei Muster“ */
    label: text("label").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedEmail: text("accepted_email"),
    /** Konto, das mit der Einladung entstanden ist; ohne Fremdschlüssel, die Einladung bleibt nach dem Entfernen im Protokoll */
    userId: text("user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  // Über eine Einladung entsteht nie ein zweiter Inhaber
  (t) => [check("invitations_role", sql`${t.role} = 'steuerberatung'`)],
);

/** Jede Anmeldung mit Rolle und Art (Passwort, Passkey, nach der Einladung), nur anhängen, Audit-Log per Trigger */
export const userLogins = pgTable(
  "user_logins",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Ohne Fremdschlüssel: das Protokoll bleibt, wenn der Zugang entfernt wird */
    userId: text("user_id").notNull(),
    role: text("role", { enum: ROLLEN }).notNull(),
    method: text("method").notNull(),
  },
  (t) => [index("user_logins_user").on(t.userId, t.at)],
);

/** Passwortwechsel, nur anhängen. Ohne Fremdschlüssel bleibt der Nachweis nach dem Entfernen des Kontos erhalten. */
export const passwordChanges = pgTable("password_changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SSO-Modus: Issuer, für den der erste Inhaber-Callback Haben eingerichtet hat. Nur anhängen, Audit-Log per Trigger */
export const ssoIssuers = pgTable("sso_issuers", {
  issuer: text("issuer").primaryKey(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull().defaultNow(),
  /** Konto des ersten Inhabers; ohne Fremdschlüssel, der Eintrag bleibt im Protokoll */
  initializedBy: text("initialized_by").notNull(),
});

/**
 * Zuletzt vom OIDC-Anbieter bestätigte Rolle je Konto und Issuer, getrennt von der lokalen Rolle in „user“. Leer, wenn die
 * letzte vollständig geprüfte Anmeldung wegen der Gruppen abgewiesen wurde. Audit-Log per Trigger.
 */
export const ssoRoles = pgTable(
  "sso_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    role: text("role", { enum: ROLLEN }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.issuer] }), check("sso_roles_role", sql`${t.role} in ('inhaber', 'steuerberatung')`)],
);

/** Ausdrückliche Übernahmen bestehender Konten durch den Betreiber (Kommandozeile), nur anhängen, Audit-Log per Trigger */
export const ssoTakeovers = pgTable("sso_takeovers", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  userId: text("user_id").notNull(),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  /** Bisheriges Subject, wenn die Übernahme eine Identität ersetzt hat */
  replacedSubject: text("replaced_subject"),
});

/** Nachweis einer expliziten Offline-Vorbereitung des lokalen Inhabers, nur anhängen. */
export const localOwnerRecoveries = pgTable("local_owner_recoveries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  userId: text("user_id").notNull(),
  transactionId: text("transaction_id").notNull(),
});
