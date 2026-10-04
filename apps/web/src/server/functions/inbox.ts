import { createServerFn } from "@tanstack/react-start";
import { deleteInboxSettings, fetchInbox, InboxError, inboxSettingsSchema, inboxSummary, saveInboxSettings } from "../inbox.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof InboxError) throw new Error(error.message);
  throw error;
}

export const getInbox = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => inboxSummary());

export const saveInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(inboxSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveInboxSettings(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const removeInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteInboxSettings(context.user.id);
    return { ok: true };
  });

/** Jetzt abrufen; die KI-Auslesung läuft im Hintergrund weiter */
export const fetchInboxNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => fetchInbox(context.user.id, (work) => void work.catch(() => {})).catch(asUserError));
