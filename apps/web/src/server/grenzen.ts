/*
 * Grenzen für hochgeladene Dateien an einer Stelle, ohne eigene Importe. Sie liegen in der Infrastruktur, weil auch
 * Module unter belege sie brauchen (Anhänge an Rechnungen, Vermerke der Umsatzsteuer), und nicht in documents.ts:
 * Hing ein Modul im Ring, las es die Grenze dort, bevor documents.ts ausgewertet war, und der Einstieg über
 * documents.ts brach mit „Cannot access MAX_DOCUMENT_SIZE before initialization“ ab (#1063).
 */

/** Größere Dateien nimmt Haben nicht an; dieselbe Grenze gilt für Upload, E-Mail und REST-API */
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

/** Größere Mails lädt Haben nicht; drei Anhänge an der Belegobergrenze passen trotz Base64 hinein */
export const MAX_MAIL_SIZE = 3 * MAX_DOCUMENT_SIZE;
