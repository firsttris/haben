import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { openInvitation } from "../anmeldung.ts";
import { env } from "../env.ts";
import { exportYears } from "../modules/archiv/index.ts";
import {
  changesSinceLastVisit,
  createInvitation,
  EINLADUNG_GUELTIG_STUNDEN,
  invitationInputSchema,
  listAccounts,
  listInvitations,
  lockAccount,
  removeAccount,
  revokeInvitation,
  unlockAccount,
} from "../modules/zugang/index.ts";
import { authMiddleware, readMiddleware } from "../middleware.ts";

/** Einstellungen → Sicherheit: Konten mit Rolle und letzter Anmeldung, Einladungen */
export const getZugaenge = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const [accounts, invitations] = await Promise.all([listAccounts(), listInvitations()]);
    return { accounts, invitations, gueltigStunden: EINLADUNG_GUELTIG_STUNDEN };
  });

/** Neue Einladung für die Steuerberatung; der Link kommt nur in dieser Antwort vor */
export const createInvitationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(invitationInputSchema)
  .handler(async ({ data, context }) => {
    const { token, expiresAt } = await createInvitation(context.user.id, data);
    return { url: `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/einladung/${token}`, expiresAt };
  });

export const revokeInvitationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await revokeInvitation(context.user.id, data);
    return { ok: true };
  });

const accountAction = z.object({ userId: z.string().min(1).max(100), action: z.enum(["sperren", "entsperren", "entfernen"]) });

/** Zugang der Steuerberatung sperren, wieder freigeben oder entfernen */
export const changeAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(accountAction)
  .handler(async ({ data, context }) => {
    const run = { sperren: lockAccount, entsperren: unlockAccount, entfernen: removeAccount }[data.action];
    await run(context.user.id, data.userId);
    return { ok: true };
  });

/** Öffentlich für die Seite /einladung/<token>: ob der Link noch gilt, ohne etwas zu verändern */
export const checkInvitation = createServerFn({ method: "GET" })
  .validator(z.string().max(200))
  .handler(async ({ data }) => {
    const invitation = await openInvitation(data);
    return invitation ? { valid: true as const, label: invitation.label, expiresAt: invitation.expiresAt } : { valid: false as const };
  });

/** Startseite der Steuerberatung: was sich seit dem letzten Besuch geändert hat, und die Jahre für die Exporte */
export const getSteuerberatungStart = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(async ({ context }) => {
    const [aenderungen, years] = await Promise.all([changesSinceLastVisit(context.user.id), exportYears()]);
    return { aenderungen, years, role: context.user.role };
  });
