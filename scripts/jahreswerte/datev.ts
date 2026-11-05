/*
 * DATEV-Kontenrahmen SKR03 (Art.-Nr. 11174) und SKR04 (Art.-Nr. 11175). Die Produktseiten im DATEV-Shop nennen in
 * der Merkmalliste „Stand“ die Ausgabe (am 05.11.2026: „Januar 2026“). Haben ordnet die Konten nach der Ausgabe 2026
 * zu (packages/core/src/hgb.ts, posting.ts, ebilanz.ts); erscheint eine neue, ist die Zuordnung zu prüfen.
 */
import { abrufen, befund, beschreibe, type Ergebnis, type Holen, LEER, text, warnung, zusammen } from "./abruf.ts";

export interface Kontenrahmen {
  name: "SKR03" | "SKR04";
  artikel: string;
  url: string;
}

export const KONTENRAHMEN: readonly Kontenrahmen[] = [
  { name: "SKR03", artikel: "11174", url: "https://www.datev.de/web/de/shop/produkt-details/kontenrahmen-datev-skr-03-11174" },
  { name: "SKR04", artikel: "11175", url: "https://www.datev.de/web/de/shop/produkt-details/kontenrahmen-datev-skr-04-11175" },
];

/** Die Ausgabe, nach der Haben die Konten zuordnet; nach einer Aktualisierung hier nachziehen */
export const HABEN_KONTENRAHMEN_STAND = "Januar 2026";

/** „Stand“ aus der Merkmalliste der Produktseite, z. B. „Januar 2026“ */
export function standAusSeite(html: string): string | null {
  const m = /row--label">\s*Stand\s*<\/span>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/.exec(html);
  return m?.[1]?.replace(/\s+/g, " ") ?? null;
}

export async function pruefeKontenrahmen(holen: Holen, erwartet = HABEN_KONTENRAHMEN_STAND): Promise<Ergebnis> {
  return zusammen(await Promise.all(KONTENRAHMEN.map((k) => pruefeEinen(k, erwartet, holen))));
}

async function pruefeEinen(k: Kontenrahmen, erwartet: string, holen: Holen): Promise<Ergebnis> {
  // Der Shop leitet ältere Adressen auf diese weiter; hier dürfen Weiterleitungen gefolgt werden
  const a = await abrufen(holen, k.url, { redirect: "follow" });
  if (a.art === "fehler" || a.status !== 200) return warnung(`${k.name}: ${k.url} nicht erreichbar (${beschreibe(a)})`);
  const stand = standAusSeite(text(a));
  if (!stand) return warnung(`${k.name}: „Stand“ auf ${k.url} nicht gefunden`);
  if (stand === erwartet) return LEER;
  return befund({
    schluessel: `datev-${k.name.toLowerCase()}`,
    titel: `DATEV-Kontenrahmen ${k.name}: neue Ausgabe (${stand})`,
    text: [
      `Der DATEV-Shop nennt für den Kontenrahmen ${k.name} (Art.-Nr. ${k.artikel}) den Stand „${stand}“: ${k.url}`,
      "",
      `Haben ordnet die Konten nach der Ausgabe „${erwartet}“ zu: Bilanz- und GuV-Posten in \`packages/core/src/hgb.ts\`, Konten der Buchungen in \`packages/core/src/posting.ts\`, E-Bilanz in \`packages/core/src/ebilanz.ts\` und \`bilanzvermerke.ts\`.`,
      "",
      `Zu tun: die neue Ausgabe (PDF beim DATEV-Shop) mit der bisherigen vergleichen – neue, gestrichene oder anders zugeordnete Konten –, die Zuordnung und die Quellenangaben („DATEV-Kontenrahmen 2026“) nachziehen und \`HABEN_KONTENRAHMEN_STAND\` in \`scripts/jahreswerte/datev.ts\` anheben, auch wenn sich für Haben nichts ändert. Testfälle für SKR03 und SKR04.`,
    ].join("\n"),
  });
}
