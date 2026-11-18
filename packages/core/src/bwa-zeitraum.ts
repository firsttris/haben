/*
 * Zeiträume der BWA (#1380): Monat, Quartal, Jahr oder frei von–bis, daneben kumuliert seit Beginn des Geschäftsjahres und
 * wahlweise ein Vergleichszeitraum. Das Geschäftsjahr ist in Haben das Kalenderjahr. Alle Daten als ISO-Datum, beide
 * Grenzen eingeschlossen.
 */

export interface Zeitraum {
  von: string;
  bis: string;
}

export type ZeitraumArt = "monat" | "quartal" | "jahr" | "frei";
export type Vergleich = "vorjahr" | "vorperiode" | "keiner";

const pad = (n: number) => String(n).padStart(2, "0");
const tageImMonat = (jahr: number, monat: number) => new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
const teile = (datum: string) => datum.split("-").map(Number) as [number, number, number];
const iso = (jahr: number, monat: number, tag: number) => `${jahr}-${pad(monat)}-${pad(tag)}`;

/** Die Monate `von` bis `bis` (1–12) eines Jahres */
const monate = (jahr: number, von: number, bis: number): Zeitraum => ({ von: iso(jahr, von, 1), bis: iso(jahr, bis, tageImMonat(jahr, bis)) });

/** Monat `nummer` (1–12), Quartal `nummer` (1–4) oder das ganze Jahr */
export function bwaZeitraum(art: Exclude<ZeitraumArt, "frei">, jahr: number, nummer = 1): Zeitraum {
  if (art === "monat") return monate(jahr, nummer, nummer);
  if (art === "quartal") return monate(jahr, nummer * 3 - 2, nummer * 3);
  return monate(jahr, 1, 12);
}

/** Ob der Zeitraum aus ganzen Monaten besteht (erster bis letzter Tag) */
function ganzeMonate({ von, bis }: Zeitraum): boolean {
  const [, , vonTag] = teile(von);
  const [bisJahr, bisMonat, bisTag] = teile(bis);
  return vonTag === 1 && bisTag === tageImMonat(bisJahr, bisMonat);
}

/** Datum um `jahre` verschoben; den 29. Februar gibt es im Zieljahr vielleicht nicht, dann der 28. */
function verschoben(datum: string, jahre: number): string {
  const [jahr, monat, tag] = teile(datum);
  return iso(jahr + jahre, monat, Math.min(tag, tageImMonat(jahr + jahre, monat)));
}

/**
 * Derselbe Zeitraum im Vorjahr: dieselben Kalendertage. Ganze Monate bleiben ganze Monate, damit der Februar eines
 * Schaltjahres mit dem ganzen Februar des Vorjahres verglichen wird und umgekehrt.
 */
export function vorjahreszeitraum(z: Zeitraum): Zeitraum {
  if (ganzeMonate(z)) {
    const [vonJahr, vonMonat] = teile(z.von);
    const [bisJahr, bisMonat] = teile(z.bis);
    return { von: iso(vonJahr - 1, vonMonat, 1), bis: iso(bisJahr - 1, bisMonat, tageImMonat(bisJahr - 1, bisMonat)) };
  }
  return { von: verschoben(z.von, -1), bis: verschoben(z.bis, -1) };
}

const tagesnummer = (datum: string) => Date.parse(`${datum}T00:00:00Z`) / 86_400_000;
const ausTagesnummer = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * Der Zeitraum direkt davor: bei ganzen Monaten gleich viele Monate (der Monat, das Quartal, das Jahr davor), sonst gleich
 * viele Tage.
 */
export function vorperiode(z: Zeitraum): Zeitraum {
  if (ganzeMonate(z)) {
    const [vonJahr, vonMonat] = teile(z.von);
    const [bisJahr, bisMonat] = teile(z.bis);
    const anzahl = (bisJahr - vonJahr) * 12 + bisMonat - vonMonat + 1;
    const start = vonJahr * 12 + vonMonat - 1 - anzahl;
    const ende = start + anzahl - 1;
    const endeJahr = Math.floor(ende / 12);
    return { von: iso(Math.floor(start / 12), (start % 12) + 1, 1), bis: iso(endeJahr, (ende % 12) + 1, tageImMonat(endeJahr, (ende % 12) + 1)) };
  }
  const tage = tagesnummer(z.bis) - tagesnummer(z.von) + 1;
  return { von: ausTagesnummer(tagesnummer(z.von) - tage), bis: ausTagesnummer(tagesnummer(z.von) - 1) };
}

/** Kumuliert: vom Beginn des Geschäftsjahres (1. Januar) bis zum Ende des Zeitraums */
export function kumuliert(z: Zeitraum): Zeitraum {
  return { von: `${z.bis.slice(0, 4)}-01-01`, bis: z.bis };
}

/** Der Vergleichszeitraum oder null ohne Vergleich */
export function vergleichszeitraum(z: Zeitraum, vergleich: Vergleich): Zeitraum | null {
  if (vergleich === "vorjahr") return vorjahreszeitraum(z);
  if (vergleich === "vorperiode") return vorperiode(z);
  return null;
}

/** Ob `datum` im Zeitraum liegt */
export const imZeitraum = (z: Zeitraum, datum: string): boolean => datum >= z.von && datum <= z.bis;

/** Die Kalenderjahre, die ein Zeitraum berührt */
export function jahreVon(z: Zeitraum): number[] {
  const von = Number(z.von.slice(0, 4));
  const bis = Number(z.bis.slice(0, 4));
  return Array.from({ length: bis - von + 1 }, (_, i) => von + i);
}
