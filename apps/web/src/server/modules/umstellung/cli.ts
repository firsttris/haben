import { readAppVersion } from "../../db/app-version.ts";
import { closeDatabase } from "../../db/index.ts";
import { today } from "../../today.ts";
import { umstellungPruefen } from "./pruefung.ts";

/*
 * Beim Start nach den Migrationen (deploy/entrypoint.sh, deploy/dev/start.sh): Prüfung beim Update auf das Journal als
 * einzige Quelle (#1116, pruefung.ts). Bei einer Abweichung endet das Skript mit Code 1, der Container startet nicht und
 * nennt Jahr und Abweichung. HABEN_ABWEICHUNG_UEBERNEHMEN=2026 (mehrere Jahre mit Komma) übernimmt die Abweichungen dieser
 * Jahre ausdrücklich; sie stehen dann im Änderungsprotokoll und in der Integritätsprüfung.
 */

const uebernehmen = (process.env.HABEN_ABWEICHUNG_UEBERNEHMEN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isInteger(n));

let code = 0;
try {
  const ergebnis = await umstellungPruefen(today(), uebernehmen, readAppVersion());
  if (ergebnis.status === "abweichung") {
    const jahre = [...new Set(ergebnis.befunde.map((b) => b.jahr))].join(",");
    console.error(
      [
        "Haben startet nicht: Voranmeldung und EÜR rechnen ab dieser Version nur noch aus dem Journal, und für Jahre vor dem",
        "bisherigen Stichjahr käme dort etwas anderes heraus als bisher. Es wurde nichts geändert.",
        "",
        ...ergebnis.befunde.map((b) => `- ${b.text}`),
        "",
        "Entweder auf der bisherigen Version bleiben, bis das Jahr erklärt ist, oder die Abweichung ausdrücklich übernehmen:",
        `HABEN_ABWEICHUNG_UEBERNEHMEN=${jahre} setzen und neu starten. Gesendete Voranmeldungen bleiben dann, wie sie gesendet`,
        "sind; alles Offene rechnet aus dem Journal. Siehe https://haben.app/einrichtung.html#update-auf-das-journal",
      ].join("\n"),
    );
    code = 1;
  } else if (ergebnis.status === "gespeichert") {
    console.log(
      ergebnis.stand.ergebnis === "bestanden"
        ? "Umstellung auf das Journal geprüft: alle Jahre wie bisher"
        : `Umstellung auf das Journal: Abweichungen für ${[...new Set(ergebnis.stand.befunde.map((b) => b.jahr))].join(", ")} übernommen`,
    );
  }
} finally {
  await closeDatabase();
}
process.exit(code);
