import { createServerFn } from "@tanstack/react-start";
import { deleteMailSettings, lastMails, mailSettingsSchema, mailSettingsSummary, saveMailSettings, sendTestMail, SMTP_PRESETS } from "../mail.ts";
import { DEFAULT_DUNNING_BODY, DEFAULT_DUNNING_SUBJECT, DEFAULT_INVOICE_BODY, DEFAULT_INVOICE_SUBJECT } from "../invoice-mail.ts";
import { authMiddleware } from "../middleware.ts";

export const getMailSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    settings: await mailSettingsSummary(),
    presets: SMTP_PRESETS,
    last: await lastMails(),
    defaults: { invoiceSubject: DEFAULT_INVOICE_SUBJECT, invoiceBody: DEFAULT_INVOICE_BODY, dunningSubject: DEFAULT_DUNNING_SUBJECT, dunningBody: DEFAULT_DUNNING_BODY },
  }));

export const saveMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(mailSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveMailSettings(context.user.id, data);
    return { ok: true };
  });

export const sendMailTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => sendTestMail(context.user.id));

export const removeMail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteMailSettings(context.user.id);
    return { ok: true };
  });
