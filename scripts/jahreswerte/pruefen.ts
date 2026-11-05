/*
 * Jahreswerte prüfen: beobachtet amtliche Quellen und meldet, was Haben aktualisieren muss – wie Renovate für
 * Abhängigkeiten, aber für Lohnsteuer-PAP, Einkommensteuertarif, Sozialversicherungswerte, ERiC, DATEV-Kontenrahmen
 * und die Normen, auf die Haben sich stützt. Läuft wöchentlich in .github/workflows/jahreswerte.yml.
 *
 *   bun scripts/jahreswerte/pruefen.ts                    Befunde als Issues (GITHUB_TOKEN, GITHUB_REPOSITORY)
 *   bun scripts/jahreswerte/pruefen.ts --trocken          nur ausgeben, keine Issues
 *   bun scripts/jahreswerte/pruefen.ts --normen-schreiben aktuelle Hashes nach normen.json übernehmen
 *
 * Eine Quelle, die nicht antwortet, ist eine Warnung; der Lauf schlägt deshalb nicht fehl.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EST_TARIF_JAHRE } from "../../packages/core/src/income-tax.ts";
import { lohnsteuerPapQuelle } from "../../packages/core/src/lohnsteuer/index.ts";
import { SOZIALVERSICHERUNG_JAHRE } from "../../packages/core/src/sozialversicherung/index.ts";
import { DEFAULT_ERIC_VERSION } from "../../packages/elster/src/install.ts";
import { type Ergebnis, type Holen, mitWiederholung, zusammen } from "./abruf.ts";
import { pruefeKontenrahmen } from "./datev.ts";
import { pruefeEric } from "./eric.ts";
import { beschreibeAktion, githubApi, issuesAbgleichen, issueTitel } from "./issues.ts";
import { pruefeLohnsteuer } from "./lohnsteuer.ts";
import { mitAktuellenHashes, type Norm, type NormStand, pruefeNormen } from "./normen.ts";
import { pruefeSozialversicherung } from "./sozialversicherung.ts";

const NORMEN_DATEI = join(import.meta.dirname, "normen.json");

/** Alle Prüfungen mit dem Stand des Repos; `holen` von außen */
export async function pruefeAlles(heute: Date, normen: readonly Norm[], holen: Holen): Promise<{ ergebnis: Ergebnis; normen: NormStand[] }> {
  const [lohnsteuer, sv, eric, datev, gesetze] = await Promise.all([
    pruefeLohnsteuer({ heute, papSha256: (j) => lohnsteuerPapQuelle(j)?.sha256 ?? null, tarifJahre: EST_TARIF_JAHRE }, holen),
    pruefeSozialversicherung({ heute, hinterlegt: SOZIALVERSICHERUNG_JAHRE }, holen),
    pruefeEric(DEFAULT_ERIC_VERSION, holen),
    pruefeKontenrahmen(holen),
    pruefeNormen(normen, holen),
  ]);
  return { ergebnis: zusammen([lohnsteuer, sv, eric, datev, gesetze.ergebnis]), normen: gesetze.stand };
}

function ausgeben({ befunde, warnungen }: Ergebnis): void {
  const imWorkflow = process.env.GITHUB_ACTIONS === "true";
  for (const w of warnungen) console.log(imWorkflow ? `::warning::${w}` : `Warnung: ${w}`);
  console.log(`\n${befunde.length} Befund(e), ${warnungen.length} Warnung(en)`);
  for (const b of befunde) console.log(`\n## ${issueTitel(b)}\n\n${b.text}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const trocken = argv.includes("--trocken");
  const normen = (JSON.parse(readFileSync(NORMEN_DATEI, "utf8")) as { normen: Norm[] }).normen;
  const { ergebnis, normen: stand } = await pruefeAlles(new Date(), normen, mitWiederholung(fetch));
  ausgeben(ergebnis);

  if (argv.includes("--normen-schreiben")) {
    writeFileSync(NORMEN_DATEI, `${JSON.stringify({ normen: mitAktuellenHashes(stand) }, null, 2)}\n`);
    console.log(`\nHashes nach ${NORMEN_DATEI} geschrieben`);
  }
  if (trocken) return;

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN und GITHUB_REPOSITORY fehlen; ohne Issues: --trocken");
  for (const a of await issuesAbgleichen(githubApi(token), repo, ergebnis.befunde)) console.log(`${issueTitel(a.befund)}: ${beschreibeAktion(a)}`);
}

if (import.meta.main) await main(process.argv.slice(2));
