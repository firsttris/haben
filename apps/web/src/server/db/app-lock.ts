/**
 * Advisory Lock, den die laufende Anwendung geteilt hält (plugins/setup-code.ts). Die SSO-Übernahme auf der
 * Kommandozeile braucht ihn exklusiv und arbeitet deshalb nur bei gestoppter Anwendung.
 */
export const APP_RUNNING_LOCK = 0x686162656e01;
