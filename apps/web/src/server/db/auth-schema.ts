import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
     * Rolle des Zugangs. Vorgabe ist die mit den wenigsten Rechten: Inhaber wird nur das erste Konto der Einrichtung
     * (Hook in server/auth.ts), jedes weitere kommt mit der Rolle seiner Einladung.
     */
    role: text("role", { enum: ROLLEN }).notNull().default("steuerberatung"),
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
  (t) => [index("account_user_id_idx").on(t.userId)],
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
