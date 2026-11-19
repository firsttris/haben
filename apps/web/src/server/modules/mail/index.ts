/*
 * E-Mail: Versand mit Protokoll und Einstellungen; Fristen-Erinnerung und Prüfwert-Mail liegen bei finanzamt und auswertungen.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  baseUrl,
  berlinHour,
  deleteMailSettings,
  escapeHtml,
  lastMails,
  loadMailSettings,
  MailError,
  mailSettingsSchema,
  MAIL_ACTOR,
  mailSettingsSummary,
  mailCommonSchema,
  putMailTemplates,
  saveMailSettings,
  send,
  sendTestMail,
  SMTP_PRESETS,
} from "./mail.ts";
