/**
 * update: alle Instanzen der Reihe nach sichern, Images laden, neu starten und warten, bis die App gesund ist.
 * Stopp beim ersten Fehler; die folgenden Instanzen bleiben, wie sie sind.
 */
import { compose } from "./ausfuehren.ts";
import { instanzen } from "./instanzen.ts";
import { abbrechen, type Kontext } from "./kontext.ts";
import { dienste, lauf, wartenAufApp } from "./zustand.ts";

export async function update(k: Kontext): Promise<void> {
  const uebersprungen: string[] = [];
  for (const { name, dir } of await instanzen(k.basis)) {
    k.aus(`== ${name}`);
    const nicht = `${name} und die folgenden Instanzen sind nicht aktualisiert.`;
    switch (lauf(await dienste(k, dir), "app")) {
      case "fehler":
        abbrechen(`${name}: docker compose meldet einen Fehler (cd ${dir} && docker compose ps); ${nicht}`);
        break;
      case "neustart":
        abbrechen(`${name}: Die App startet ständig neu; siehe: cd ${dir} && docker compose logs app. ${nicht}`);
        break;
      case "gestoppt":
        k.aus("gestoppt, übersprungen");
        uebersprungen.push(name);
        continue;
      case "laeuft":
        break;
    }
    if ((await compose(k, dir, ["exec", "-T", "backup", "backup.sh"], true)).code !== 0)
      abbrechen(`${name}: Sicherung vor dem Update fehlgeschlagen; ${nicht}`);
    if ((await compose(k, dir, ["pull"], true)).code !== 0) abbrechen(`${name}: Images konnten nicht geladen werden; ${nicht}`);
    if ((await compose(k, dir, ["up", "-d"], true)).code !== 0) abbrechen(`${name}: Start fehlgeschlagen; die folgenden Instanzen sind nicht aktualisiert.`);
    if (!(await wartenAufApp(k, dir)))
      abbrechen(
        `${name}: Die App ist nach dem Update nicht gesund (etwa eine fehlgeschlagene Migration); siehe: cd ${dir} && docker compose logs app. Die folgenden Instanzen sind nicht aktualisiert.`,
      );
    k.aus("aktualisiert");
  }
  if (uebersprungen.length > 0) k.aus(`Nicht aktualisiert, weil gestoppt: ${uebersprungen.join(" ")}`);
}
