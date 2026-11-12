/*
 * Sozialversicherungsrechengrößen-Verordnung des nächsten Jahres. gesetze-im-internet.de legt jede Jahresverordnung
 * unter /svbezgrv_<Jahr>/ ab (2024, 2025, 2026 so vorhanden); das Inhaltsverzeichnis trägt den Titel
 * „SVBezGrV <Jahr> - nichtamtliches Inhaltsverzeichnis“. Ein Jahr, das es noch nicht gibt, antwortet mit 404
 * (svbezgrv_2027 am 05.11.2026). Die Verordnung erscheint zuerst im Bundesgesetzblatt (meist im November),
 * gesetze-im-internet.de folgt einige Tage später.
 */
import { abrufen, befund, beschreibe, type Ergebnis, type Holen, LEER, SKILL_JAHRESWERTE, text, warnung, zusammen } from "./abruf.ts";

export const svUrl = (jahr: number) => `https://www.gesetze-im-internet.de/svbezgrv_${jahr}/`;

const DOKU_SV = `${SKILL_JAHRESWERTE}#sozialversicherung`;

export interface SvStand {
  heute: Date;
  /** Jahre mit Werten in `SV_JAHRE` (packages/core/src/sozialversicherung/index.ts) */
  hinterlegt: readonly number[];
}

/** Laufendes und nächstes Jahr, soweit Haben sie noch nicht hat */
export async function pruefeSozialversicherung(stand: SvStand, holen: Holen): Promise<Ergebnis> {
  const jahr = stand.heute.getFullYear();
  const offen = [jahr, jahr + 1].filter((j) => !stand.hinterlegt.includes(j));
  return zusammen(await Promise.all(offen.map((j) => pruefeJahr(j, holen))));
}

async function pruefeJahr(jahr: number, holen: Holen): Promise<Ergebnis> {
  const a = await abrufen(holen, svUrl(jahr));
  if (a.art === "antwort" && a.status === 404) return LEER;
  if (a.art === "fehler" || a.status !== 200) return warnung(`Sozialversicherung ${jahr}: ${svUrl(jahr)} nicht erreichbar (${beschreibe(a)})`);
  if (!new RegExp(`<title>\\s*SVBezGrV ${jahr}\\b`).test(text(a)))
    return warnung(`Sozialversicherung ${jahr}: ${svUrl(jahr)} ist nicht die erwartete Verordnung`);
  return befund({
    schluessel: `sv-${jahr}`,
    titel: `Sozialversicherungsrechengrößen ${jahr} sind veröffentlicht`,
    text: [
      `Die Sozialversicherungsrechengrößen-Verordnung ${jahr} steht auf gesetze-im-internet.de: ${svUrl(jahr)}`,
      "",
      `Haben hat für ${jahr} noch keine Werte (\`SV_JAHRE\` in \`packages/core/src/sozialversicherung/index.ts\`) und rechnet die Sozialversicherung ${jahr} deshalb nicht.`,
      "",
      `Zu tun: die Werte des Jahres mit Quelle sammeln – neben den Beitragsbemessungsgrenzen aus der Verordnung auch Beitragssätze, durchschnittlicher Zusatzbeitrag, Geringfügigkeitsgrenze, Faktor F und die Werte der Minijob-Zentrale –, \`SV_${jahr}\` in \`werte.ts\` anlegen und Beispielrechnungen als Tests aufnehmen. Schritte in [Skill jahreswerte, „Sozialversicherung“](${DOKU_SV}).`,
    ].join("\n"),
  });
}
