import { createServerFn } from "@tanstack/react-start";
import { deleteMailSettings, lastMails, mailSettingsSchema, mailSettingsSummary, MailError, saveMailSettings, sendTestMail, SMTP_PRESETS } from "../mail.ts";
import { authMiddleware } from "../middleware.ts";

const rethrow = (error: unknown): never => {
  if (error instanceof MailError) throw new Error(error.message, { cause: error });
  throw error;
};

export const getMailSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ settings: await mailSettingsSummary(), presets: SMTP_PRESETS, last: await lastMails() }));

export const saveMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(mailSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveMailSettings(context.user.id, data).catch(rethrow);
    return { ok: true };
  });

export const sendMailTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => sendTestMail(context.user.id).catch(rethrow));

export const removeMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteMailSettings(context.user.id);
    return { ok: true };
  });
