import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { currentTokenOwners, requireTokenOwner, takeoverProblem, tokenEvent } from "../../token-responsibility.ts";
import { loadCompany } from "../stammdaten/index.ts";

/* Kalender-Abo: Kalender-Apps können sich nicht anmelden, deshalb ein geheimer Link. Gespeichert ist nur der Hash. */

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Erzeugt einen neuen Abo-Link; ein alter wird damit ungültig. Das Token gibt es nur dieses eine Mal. */
export async function createCalendarToken(actor: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await loadCompany();
  await withActor(actor, async (tx) => {
    await requireTokenOwner(tx, actor);
    await tx
      .update(schema.company)
      .set({
        calendarTokenHash: hashToken(token),
        calendarTokenCreatedBy: actor,
        calendarTokenResponsibleId: actor,
        calendarTokenDisabledAt: null,
        calendarTokenDisabledReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.company.id, 1));
    await tokenEvent(tx, actor, "kalender", "1", "angelegt", actor);
  });
  return token;
}

/** Widerruft den Abo-Link mit Ereignis in token_events; ohne Link ändert sich nichts und es entsteht kein zweites Ereignis. */
export async function revokeCalendarToken(actor: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [revoked] = await tx
      .update(schema.company)
      .set({ calendarTokenHash: null, updatedAt: new Date() })
      .where(and(eq(schema.company.id, 1), isNotNull(schema.company.calendarTokenHash)))
      .returning({ responsibleId: schema.company.calendarTokenResponsibleId });
    if (revoked) await tokenEvent(tx, actor, "kalender", "1", "widerrufen", revoked.responsibleId);
  });
}

const calendarOwnerConfirmed = async (responsibleId: string | null) => !!responsibleId && (await currentTokenOwners(db)).has(responsibleId);

export async function calendarTokenActive(): Promise<boolean> {
  const company = await loadCompany();
  return Boolean(company.calendarTokenHash && !company.calendarTokenDisabledAt && (await calendarOwnerConfirmed(company.calendarTokenResponsibleId)));
}

export async function checkCalendarToken(token: string): Promise<boolean> {
  const company = await loadCompany();
  if (company.calendarTokenDisabledAt) return false;
  const stored = company.calendarTokenHash;
  if (!stored || !token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b) && calendarOwnerConfirmed(company.calendarTokenResponsibleId);
}

/** Metadaten für die Verwaltung, niemals Hash oder Token. */
export async function calendarTokenStatus(actor?: string) {
  const company = await loadCompany();
  const owners = await currentTokenOwners(db);
  const responsibleId = company.calendarTokenResponsibleId;
  const ownerConfirmed = !!responsibleId && owners.has(responsibleId);
  const unusable = !!company.calendarTokenDisabledAt || !ownerConfirmed;
  const [responsible] = company.calendarTokenResponsibleId
    ? await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, company.calendarTokenResponsibleId))
    : [];
  return {
    responsibleName: responsible?.name ?? null,
    exists: !!company.calendarTokenHash,
    responsibleId: company.calendarTokenResponsibleId,
    createdBy: company.calendarTokenCreatedBy,
    disabledAt: company.calendarTokenDisabledAt,
    disabledReason: company.calendarTokenDisabledReason,
    ownerConfirmed,
    canTakeOver:
      !!company.calendarTokenHash &&
      unusable &&
      !!actor &&
      owners.has(actor) &&
      !takeoverProblem(owners, actor, responsibleId, !!company.calendarTokenDisabledAt),
  };
}

export async function reactivateCalendarToken(actor: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await requireTokenOwner(tx, actor);
    const [company] = await tx.select().from(schema.company).where(eq(schema.company.id, 1)).for("update");
    if (!company?.calendarTokenHash) throw new UserError("Es gibt kein Kalender-Abo, das sich übernehmen ließe.");
    const problem = takeoverProblem(await currentTokenOwners(tx), actor, company.calendarTokenResponsibleId, !!company.calendarTokenDisabledAt);
    if (problem) throw new UserError(problem);
    await tx
      .update(schema.company)
      .set({ calendarTokenResponsibleId: actor, calendarTokenDisabledAt: null, calendarTokenDisabledReason: null })
      .where(eq(schema.company.id, 1));
    await tokenEvent(tx, actor, "kalender", "1", "reaktiviert", actor, company.calendarTokenResponsibleId);
  });
}
