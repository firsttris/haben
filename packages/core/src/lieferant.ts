/*
 * Derselbe Lieferant (#1514): derselbe Kontakt, dieselbe USt-IdNr. oder derselbe Name (ohne Groß- und Kleinschreibung, ohne
 * Leerzeichen am Rand). „Warum?“ der BWA fasst damit viele Belege und Rechnungen zu Gruppen (lieferantGruppen). Die
 * Vorschläge (#295) filtern dieselben Merkmale in SQL (lieferantGleich in apps/web/src/server/modules/belege/vorschlaege.ts)
 * und teilen von hier die Schreibweise der USt-IdNr.
 */

/** Was einen Lieferanten (oder Kunden) erkennt; Name und USt-IdNr. können mehrere sein, etwa am Beleg und am Kontakt */
export interface LieferantMerkmale {
  kontaktId: string | null;
  ustIds: readonly string[];
  namen: readonly string[];
}

/** Die USt-IdNr., wie updateDocument sie speichert: ohne Leerzeichen und groß */
export const ustIdVergleichbar = (ustId: string) => ustId.replace(/\s/g, "").toUpperCase();

const nameVergleichbar = (name: string) => name.trim().toLocaleLowerCase("de");

/** Die vergleichbaren Merkmale außer dem Kontakt, mit Art, damit eine USt-IdNr. nie einem Namen gleicht */
const merkmale = ({ ustIds, namen }: LieferantMerkmale): string[] => [
  ...new Set([
    ...ustIds.map(ustIdVergleichbar).flatMap((u) => (u ? [`ust:${u}`] : [])),
    ...namen.map(nameVergleichbar).flatMap((n) => (n ? [`name:${n}`] : [])),
  ]),
];

/**
 * Ordnet Belege bzw. Rechnungen zu Gruppen desselben Lieferanten, auch über mehrere Schritte (Kontakt, gleiche USt-IdNr.,
 * dann gleicher Name). Gibt je Eintrag einen Schlüssel der Gruppe zurück, null ohne jedes Merkmal. Zwei Kontakte bleiben
 * immer getrennt. Ein Eintrag ohne Kontakt, der selbst zu zwei Kontakten passt, bleibt bei keinem und verbindet keine
 * Kontakte; er steht nur bei Einträgen, die ebenfalls zu keinem Kontakt gehören. Verbinden erst mehrere Einträge ohne
 * Kontakt zwei Kontakte, bleiben sie zusammen für sich: Haben rät keine Zuordnung.
 */
export function lieferantGruppen(eintraege: readonly LieferantMerkmale[]): (string | null)[] {
  const je = eintraege.map(merkmale);
  // Welche Kontakte ein Merkmal tragen, aus ihren eigenen Einträgen
  const kontakteMit = new Map<string, Set<string>>();
  eintraege.forEach(({ kontaktId }, i) => {
    if (kontaktId) for (const x of je[i]!) kontakteMit.set(x, (kontakteMit.get(x) ?? new Set()).add(kontaktId));
  });
  const passtZu = je.map((xs) => new Set(xs.flatMap((x) => [...(kontakteMit.get(x) ?? [])])));
  const mehrdeutig = eintraege.map(({ kontaktId }, i) => !kontaktId && passtZu[i]!.size > 1);
  // Union-Find über die Einträge ohne Kontakt, getrennt nach mehrdeutig und eindeutig
  const eltern = eintraege.map((_, i) => i);
  const wurzel = (i: number): number => {
    let w = i;
    while (eltern[w] !== w) w = eltern[w]!;
    return w;
  };
  const erster = new Map<string, number>();
  eintraege.forEach(({ kontaktId }, i) => {
    if (kontaktId) return;
    for (const x of je[i]!) {
      const key = `${mehrdeutig[i]}|${x}`;
      const j = erster.get(key);
      if (j === undefined) erster.set(key, i);
      else eltern[wurzel(i)] = wurzel(j);
    }
  });
  // Die Kontakte je Gruppe ohne Kontakt; genau einer, und die Gruppe gehört zu ihm
  const kontakteJe = new Map<number, Set<string>>();
  eintraege.forEach(({ kontaktId }, i) => {
    if (kontaktId || mehrdeutig[i]) return;
    const w = wurzel(i);
    for (const k of passtZu[i]!) kontakteJe.set(w, (kontakteJe.get(w) ?? new Set()).add(k));
  });
  const kontaktVon = eintraege.map(({ kontaktId }, i) => {
    const kontakte = kontaktId || mehrdeutig[i] ? undefined : kontakteJe.get(wurzel(i));
    return kontakte?.size === 1 ? [...kontakte][0]! : null;
  });
  // Was bei keinem Kontakt steht, verbindet sich nun auch mit den mehrdeutigen; einen Kontakt bekommt dadurch keiner
  const ohne = new Map<string, number>();
  eintraege.forEach(({ kontaktId }, i) => {
    if (kontaktId || kontaktVon[i]) return;
    for (const x of je[i]!) {
      const j = ohne.get(x);
      if (j === undefined) ohne.set(x, i);
      else eltern[wurzel(i)] = wurzel(j);
    }
  });
  return eintraege.map(({ kontaktId }, i) => {
    if (kontaktId) return `kontakt:${kontaktId}`;
    if (kontaktVon[i]) return `kontakt:${kontaktVon[i]}`;
    return je[i]!.length === 0 ? null : `gruppe:${wurzel(i)}`;
  });
}
