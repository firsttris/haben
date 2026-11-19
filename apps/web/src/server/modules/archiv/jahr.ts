import { sql } from "drizzle-orm";

/** Grenzen eines Archivjahrs: erster und letzter Tag für Datumsspalten */
export const yearStart = (year: number) => `${year}-01-01`;
export const yearEnd = (year: number) => `${year}-12-31`;
/** Beginn eines Jahres in deutscher Zeit, für Zeitstempel-Spalten */
export const berlinStart = (year: number) => sql`(${`${year}-01-01 00:00:00`}::timestamp at time zone 'Europe/Berlin')`;
