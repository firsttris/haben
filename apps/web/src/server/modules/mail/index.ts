/*
 * E-Mail: SMTP-Versand, Erinnerungen an Fristen und die wöchentliche Integritätsmail.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  deleteMailSettings,
  escapeHtml,
  lastMails,
  loadMailSettings,
  MailError,
  mailSettingsSchema,
  mailSettingsSummary,
  runDueFristenMails,
  runDuePruefwertMail,
  saveMailSettings,
  send,
  sendTestMail,
  SMTP_PRESETS,
} from "./mail.ts";
