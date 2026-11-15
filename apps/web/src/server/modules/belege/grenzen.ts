/*
 * Grenzen für Belege an einer Stelle, in einem Modul ohne eigene Importe. Sie stehen bewusst nicht in
 * documents.ts: der Ring documents -> bank/index -> bank/bank -> belege/index -> inbox -> documents lässt
 * inbox.ts schon laden, während documents.ts noch nicht fertig ausgewertet ist. Eine Grenze, die dort oben
 * gelesen wird, liegt dann in der temporalen Totzone, und der Einstieg über documents.ts bricht mit
 * „Cannot access MAX_DOCUMENT_SIZE before initialization“ ab (#1063).
 */

/** Größere Dateien nimmt Haben nicht an; dieselbe Grenze gilt für Upload, E-Mail und REST-API */
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

/** Größere Mails lädt Haben nicht; drei Anhänge an der Belegobergrenze passen trotz Base64 hinein */
export const MAX_MAIL_SIZE = 3 * MAX_DOCUMENT_SIZE;
