/*
 * Gesetzeswächter: Normen, auf die Haben sich stützt, mit dem SHA-256 ihres Textes auf gesetze-im-internet.de
 * (normen.json). Eine Einzelnorm steht dort als /<gesetz>/__<paragraph>.html: Überschrift (div.jnheader), Text
 * (div.jnhtml mit div.jurAbsatz) und Fußnoten (div.jnfussnote), danach die Fußzeile (div#fusszeile). Gehasht wird der
 * Text von der Überschrift bis vor die Fußzeile, ohne Tags, mit aufgelösten Entities und zusammengefassten
 * Leerzeichen; Navigation („zurück“, „weiter“), Logos und Fußzeile bleiben außen vor.
 */
import { abrufen, begrenzt, befund, beschreibe, DOKU_JAHRESWERTE, type Ergebnis, type Holen, LEER, sha256, text, warnung, zusammen } from "./abruf.ts";

export interface Norm {
  /** Kennung im Issue, z. B. `ustg-18` */
  id: string;
  /** Zitierweise, z. B. „§ 18 UStG“ */
  norm: string;
  url: string;
  /** Wofür Haben die Norm braucht */
  zweck: string;
  /** Stellen in Haben, die von ihr abhängen */
  stellen: string[];
  /** SHA-256 des normalisierten Textes; leer bei einer neu aufgenommenen Norm */
  sha256: string;
}

const PARALLEL = 4;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sect: "§",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  euro: "€",
  ndash: "–",
  mdash: "—",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
};

function entities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? ganz;
    const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return String.fromCodePoint(code);
  });
}

/** Der Normtext ohne Navigation und Fußzeile, oder null, wenn die Seite keine Einzelnorm ist */
export function normText(html: string): string | null {
  const start = html.indexOf('<div class="jnheader">');
  const ende = html.indexOf('<div id="fusszeile">', start);
  if (start < 0 || ende < 0) return null;
  const ohneTags = html
    .slice(start, ende)
    .replace(/<a\s[^>]*>\s*Nichtamtliches Inhaltsverzeichnis\s*<\/a>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return entities(ohneTags).replace(/\s+/g, " ").trim();
}

export interface NormStand {
  norm: Norm;
  /** Aktueller SHA-256, null wenn die Seite nicht auswertbar war */
  sha256: string | null;
}

/** Ruft jede Norm ab; das Ergebnis enthält die aktuellen Hashes, damit `--normen-schreiben` sie übernehmen kann */
export async function pruefeNormen(normen: readonly Norm[], holen: Holen): Promise<{ ergebnis: Ergebnis; stand: NormStand[] }> {
  const stand = await begrenzt(normen, PARALLEL, async (norm) => ({ norm, ...(await aktuell(norm, holen)) }));
  return { ergebnis: zusammen(stand.map(bewerte)), stand: stand.map(({ norm, sha256 }) => ({ norm, sha256 })) };
}

type Aktuell = { sha256: string | null; problem: string | null; verschwunden?: boolean };

async function aktuell(norm: Norm, holen: Holen): Promise<Aktuell> {
  const a = await abrufen(holen, norm.url);
  // 404 ist eine eindeutige Antwort (Norm aufgehoben, Gesetz unter neuer Adresse), kein Ausfall wie 503
  if (a.art === "antwort" && a.status === 404) return { sha256: null, problem: null, verschwunden: true };
  if (a.art === "fehler" || a.status !== 200) return { sha256: null, problem: `nicht erreichbar (${beschreibe(a)})` };
  const t = normText(text(a));
  if (!t) return { sha256: null, problem: "keine Einzelnorm erkannt" };
  return { sha256: await sha256(new TextEncoder().encode(t)), problem: null };
}

function bewerte({ norm, sha256, problem, verschwunden }: NormStand & Aktuell): Ergebnis {
  if (verschwunden) return befund(nichtMehrDa(norm));
  if (!sha256) return warnung(`${norm.norm}: ${norm.url} ${problem}`);
  if (!norm.sha256) return warnung(`${norm.norm}: noch kein Hash in normen.json (aktuell ${sha256}); mit --normen-schreiben übernehmen`);
  if (norm.sha256 === sha256) return LEER;
  return befund({
    schluessel: `norm-${norm.id}`,
    titel: `${norm.norm} geändert – prüfen, ob Haben betroffen ist`,
    text: [
      `Der Text von ${norm.norm} auf gesetze-im-internet.de hat sich geändert: ${norm.url}`,
      "",
      `Haben braucht die Norm für: ${norm.zweck}`,
      "",
      "Stellen in Haben:",
      ...norm.stellen.map((s) => `- \`${s}\``),
      "",
      `Zu tun: die Änderung lesen (Fußnoten und „Textnachweis“ der Seite nennen das ändernde Gesetz und ab wann es gilt) und prüfen, ob die Stellen oben betroffen sind. Danach – auch wenn Haben unverändert bleibt – den Hash in \`scripts/jahreswerte/normen.json\` aktualisieren (\`bun scripts/jahreswerte/pruefen.ts --trocken --normen-schreiben\`). Bisher \`${norm.sha256}\`, jetzt \`${sha256}\`. Siehe [docs/entwicklung.md](${DOKU_JAHRESWERTE}).`,
    ].join("\n"),
  });
}

const nichtMehrDa = (norm: Norm) => ({
  schluessel: `norm-${norm.id}`,
  titel: `${norm.norm} ist nicht mehr abrufbar – prüfen, ob Haben betroffen ist`,
  text: [
    `${norm.url} antwortet mit 404: Die Norm ist aufgehoben, umnummeriert oder das Gesetz steht unter einer neuen Adresse.`,
    "",
    `Haben braucht die Norm für: ${norm.zweck}`,
    "",
    "Stellen in Haben:",
    ...norm.stellen.map((s) => `- \`${s}\``),
    "",
    `Zu tun: im Inhaltsverzeichnis des Gesetzes oder im Bundesgesetzblatt nachsehen, was aus der Norm geworden ist, die Stellen oben prüfen und in \`scripts/jahreswerte/normen.json\` die neue Adresse eintragen (Hash leeren und mit \`--normen-schreiben\` neu setzen) oder die Norm streichen. Siehe [docs/entwicklung.md](${DOKU_JAHRESWERTE}).`,
  ].join("\n"),
});

/** normen.json mit den aktuellen Hashes; Normen, die nicht abrufbar waren, behalten ihren bisherigen */
export const mitAktuellenHashes = (stand: readonly NormStand[]): Norm[] => stand.map(({ norm, sha256 }) => ({ ...norm, sha256: sha256 ?? norm.sha256 }));
