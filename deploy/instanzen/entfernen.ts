/**
 * entfernen <name> (#1068, Folge zu #1027/#1013): nimmt die Proxy-Seite einer gelöschten Instanz weg, spiegelbildlich zu
 * proxyStarten bei neu. `docker compose down -v` und das Löschen des Verzeichnisses macht vorher der Mensch; das
 * Werkzeug löscht nie Daten. Den Caddy baut es nie neu auf: Ein Neuaufbau unterbräche alle anderen Instanzen, und die
 * Netze zählen zum Config-Hash seines Dienstes.
 */
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compose, docker } from "./ausfuehren.ts";
import { gehoertDazu, instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { pruefeName } from "./pruefen.ts";
import { netzeDatei, netzeDerInstanzen, netzFuer, netzname, proxyDir } from "./proxy.ts";
import { dienste, lauf } from "./zustand.ts";

const AUFRUF = "Aufruf: bun deploy/instanzen/haben-instanzen.ts entfernen <name>";
const RELOAD = "docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile";

/** Bricht ab, solange es die Instanz noch gibt: ihre Daten gehen vor, das Werkzeug löscht keine */
async function pruefeGeloescht(k: Kontext, name: string): Promise<void> {
  const erst =
    "Das Werkzeug löscht keine Daten. Vorher den Jahresexport jedes Jahres und ein Backup an einen zweiten Ort: Bücher 10 und Buchungsbelege 8 Jahre aufbewahren (§ 147 Abs. 3 AO; docs/installation.md, „Mehrere Instanzen“). Dann in ihrem Verzeichnis `docker compose down -v` (löscht Datenbank, Belege und das Backup im Volume) und das Verzeichnis löschen.";
  const instanz = (await instanzen(k.basis)).find((i) => i.name === name);
  if (instanz) abbrechen(`Die Instanz ${name} gibt es noch (${instanz.dir}); nichts geändert. ${erst}`);
  // Auch ein Rest ohne .env und compose.yml zählt: Ein Verzeichnis, das noch da ist, löscht der Mensch zuerst
  const dir = join(k.basis, name);
  if (existsSync(dir)) abbrechen(`Das Verzeichnis ${name} gibt es noch (${dir}); nichts geändert. ${erst}`);
  const projekte = await docker(k, ["compose", "ls", "-a", "-q"]);
  if (projekte.code !== 0) abbrechen("docker antwortet nicht (läuft der Daemon, darfst du ihn nutzen?); nichts geändert.");
  const bekannt = projekte.stdout.split("\n").find((p) => gehoertDazu(name, p.trim()));
  if (bekannt) abbrechen(`Docker kennt noch das Compose-Projekt ${bekannt.trim()}; nichts geändert. ${erst}`);
}

/** Bricht ab und nennt die Schritte, die der Mensch nachholt; Datei und Override sind dann schon geändert */
function nachholen(k: Kontext, meldung: string, schritte: string[]): never {
  abbrechen(`${meldung}; siehe: cd ${proxyDir(k)} && docker compose logs caddy. Zum Nachholen, der Reihe nach:\n${schritte.map((s) => `  ${s}`).join("\n")}`);
}

export async function proxyEntfernen(k: Kontext, name: string): Promise<void> {
  const dir = proxyDir(k);
  const datei = join(dir, "sites", `${name}.caddy`);
  if (!existsSync(datei))
    abbrechen(
      `Kein Eintrag ${name}.caddy im gemeinsamen Caddy (${datei}); nichts geändert. Mit --eigener-proxy angelegte Instanzen haben keinen: ihren Block und ihr Netz nimmst du aus der Konfiguration deines Proxys (docs/installation.md, „Mehrere Instanzen“).`,
    );
  await pruefeGeloescht(k, name);
  const caddy = lauf(await dienste(k, dir), "caddy");
  if (caddy === "fehler" || caddy === "neustart")
    abbrechen(
      `Der Zustand des gemeinsamen Caddy ist unklar (${caddy === "neustart" ? "er startet ständig neu" : "docker compose meldet einen Fehler"}); nichts geändert. Siehe: cd ${dir} && docker compose logs caddy`,
    );
  const laeuft = caddy === "laeuft";

  // Ein eigenes Netz hat die Instanz, wenn die Netzliste des Caddy es nennt; im alten gemeinsamen Netz haben-proxy nicht
  const netz = netzFuer(name);
  const override = join(dir, "compose.override.yml");
  const eigenesNetz = existsSync(override) && (await readFile(override, "utf8")).split("\n").some((z) => netzname(z) === netz);

  await rm(datei);
  k.aus(`proxy/sites/${name}.caddy entfernt.`);
  const verbleibend = await netzeDerInstanzen(k);
  if (verbleibend.length === 0) {
    await rm(override, { force: true });
    k.aus("proxy/compose.override.yml gelöscht: keine Instanz hat mehr ein eigenes Netz.");
  } else {
    await writeFile(override, netzeDatei(verbleibend));
    k.aus(`proxy/compose.override.yml neu geschrieben: ${verbleibend.join(", ")}.`);
  }

  const loesen = `docker network disconnect ${netz} $(cd ${dir} && docker compose ps -a -q caddy)`;
  const netzWeg = `docker network rm ${netz}`;
  if (laeuft) {
    if ((await compose(k, dir, ["exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"])).code !== 0)
      nachholen(
        k,
        "Der gemeinsame Caddy hat sites/ nicht neu eingelesen und behält die bisherige Konfiguration",
        eigenesNetz ? [`cd ${dir} && ${RELOAD}`, loesen, netzWeg] : [`cd ${dir} && ${RELOAD}`],
      );
    k.aus("Der Caddy hat sites/ neu eingelesen (caddy reload).");
  }
  if (eigenesNetz) {
    const netze = await docker(k, ["network", "ls", "--format", "{{.Name}}"]);
    if (netze.code !== 0) nachholen(k, `docker antwortet nicht; das Netz ${netz} ist noch da`, [loesen, netzWeg]);
    // Ein fehlendes Netz ist kein Fehler: Es ist schon weg
    if (netze.stdout.split("\n").some((n) => n.trim() === netz)) {
      // Auch ein gestoppter Container behält das Netz in seiner Konfiguration: Ohne disconnect scheiterte danach
      // `docker start` (failed to set up container networking). Nur `up -d` käme ohne aus, weil es ihn neu aufbaut
      const ps = await compose(k, dir, ["ps", "-a", "-q", "caddy"]);
      if (ps.code !== 0) nachholen(k, `docker antwortet nicht; das Netz ${netz} ist noch da`, [loesen, netzWeg]);
      const id = ps.stdout.trim();
      if (id === "" && laeuft) nachholen(k, `Der gemeinsame Caddy ließ sich nicht aus dem Netz ${netz} lösen`, [loesen, netzWeg]);
      if (id !== "" && (await docker(k, ["network", "disconnect", netz, id])).code !== 0)
        nachholen(k, `Der gemeinsame Caddy ließ sich nicht aus dem Netz ${netz} lösen`, [loesen, netzWeg]);
      if ((await docker(k, ["network", "rm", netz])).code !== 0) nachholen(k, `Das Netz ${netz} ließ sich nicht entfernen`, [netzWeg]);
      k.aus(id !== "" ? `Netz ${netz} vom Caddy gelöst und entfernt.` : `Netz ${netz} entfernt.`);
    }
  }
  if (!laeuft) return k.aus("Fertig. Der Caddy lief nicht und bleibt gestoppt; sein nächster Start (start, restart oder up -d) liest sites/ ein.");
  k.aus("Fertig. Der Caddy-Container blieb unverändert.");
  // Nur wenn sich die Netzliste in compose.override.yml geändert hat, weicht der Container von den Dateien ab
  if (eigenesNetz)
    k.aus(
      `Hinweis: Ein späteres schlichtes \`docker compose up -d\` in ${dir} baut den Caddy einmal neu auf (die Netze zählen zum Config-Hash); alle Instanzen sind dann kurz nicht erreichbar.`,
    );
}

/** entfernen <name>: genau ein Name, geprüft wie bei neu */
export async function entfernen(k: Kontext, namen: string[]): Promise<void> {
  if (namen.length !== 1) abbrechen(AUFRUF);
  const name = namen[0] ?? "";
  pruefeName(name);
  await proxyEntfernen(k, name);
}
