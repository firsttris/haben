import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { invitationHash } from "../../anmeldung.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { ssoOnly } from "../../sso-policy.ts";

/*
 * Einladungen für die Steuerberatung (Roadmap Platz 10, Stufe 1). Der Inhaber erzeugt einen Link, die Eingeladene legt
 * damit ihr Konto an. Einlösen prüft Better Auth über server/anmeldung.ts.
 */

/** Drei Tage: genug für eine Kanzlei, kurz genug, dass ein vergessener Link nicht lange offen liegt */
export const EINLADUNG_GUELTIG_STUNDEN = 72;

export class ZugangError extends UserError {}

/** Einladen, Sperren, Freigeben und Entfernen gibt es nur im Standardmodus; im SSO-Modus entscheidet der Anbieter */
export function requireLocalManagement(): void {
  if (ssoOnly()) throw new ZugangError("Im SSO-Modus werden Zugänge beim OIDC-Anbieter verwaltet, nicht in Haben.");
}

export const invitationInputSchema = z.object({
  label: z.string().trim().min(1, "Bezeichnung fehlt").max(80, "Die Bezeichnung darf höchstens 80 Zeichen lang sein."),
});

export type InvitationStatus = "offen" | "eingeloest" | "zurueckgezogen" | "abgelaufen";

function statusOf(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InvitationStatus {
  if (row.acceptedAt) return "eingeloest";
  if (row.revokedAt) return "zurueckgezogen";
  return row.expiresAt <= now ? "abgelaufen" : "offen";
}

/**
 * Legt eine Einladung an. Das Token kommt nur in dieser Antwort vor; gespeichert ist sein SHA-256, der Link lässt sich
 * später nicht wieder anzeigen.
 */
export async function createInvitation(actor: string, input: z.input<typeof invitationInputSchema>, now = new Date()) {
  requireLocalManagement();
  const { label } = invitationInputSchema.parse(input);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + EINLADUNG_GUELTIG_STUNDEN * 3_600_000);
  const [row] = await withActor(actor, (tx) =>
    tx
      .insert(schema.invitations)
      .values({ tokenHash: invitationHash(token), role: "steuerberatung", label, createdBy: actor, expiresAt })
      .returning({ id: schema.invitations.id }),
  );
  return { id: row!.id, token, expiresAt };
}

/** Alle Einladungen, neueste zuerst, mit ihrem Stand; ohne Hash */
export async function listInvitations(now = new Date()) {
  const rows = await db
    .select({
      id: schema.invitations.id,
      label: schema.invitations.label,
      role: schema.invitations.role,
      createdAt: schema.invitations.createdAt,
      expiresAt: schema.invitations.expiresAt,
      acceptedAt: schema.invitations.acceptedAt,
      acceptedEmail: schema.invitations.acceptedEmail,
      revokedAt: schema.invitations.revokedAt,
    })
    .from(schema.invitations)
    .orderBy(desc(schema.invitations.createdAt));
  return rows.map((row) => ({ ...row, status: statusOf(row, now) }));
}

/** Zieht eine noch nicht eingelöste Einladung zurück; der Link gilt danach nicht mehr */
export async function revokeInvitation(actor: string, id: string): Promise<void> {
  requireLocalManagement();
  const rows = await withActor(actor, (tx) =>
    tx
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.invitations.id, id), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
      .returning({ id: schema.invitations.id }),
  );
  if (rows.length === 0) throw new ZugangError("Die Einladung ist schon eingelöst oder zurückgezogen.");
}
