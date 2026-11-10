import { ASSET_ACCOUNTS } from "./afa.ts";
import { DARLEHEN_KONTEN } from "./darlehen.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { PAUSCHALE_KONTEN } from "./pauschalen.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type Kontenrahmen } from "./posting.ts";
import { SACHENTNAHME_FRUEHERE_KONTEN, SACHENTNAHME_KONTEN } from "./manual.ts";
import { PRIVATE_USE_ACCOUNTS } from "./private-use.ts";
import { STEUER_KONTEN } from "./steuerzahlung.ts";

/*
 * Konten nach einem Wechsel des Kontenrahmens (SKR03 ↔ SKR04) übertragen. Eine Gegenbuchung, die die Zeilen einer Buchung
 * aus dem alten Kontenrahmen umdreht (Storno einer Bareinnahme, Aufheben einer Ausbuchung), bucht sie mit den Konten
 * derselben Bedeutung im neuen Rahmen. Die Zuordnung entsteht aus den Konten, die Haben selbst bebucht: jede Rolle (etwa
 * „Forderungen“, „Umsatzsteuer 19 %“, Kategorie „Software“) hat in beiden Kontenrahmen ein Konto. Ein Konto, das keine
 * oder mehr als eine Entsprechung hat, lässt sich nicht übertragen.
 */

type Paar = [string, string];

/** Konten gleicher Rolle in SKR03 und SKR04, aus zwei gleich aufgebauten Objekten */
function paare(a: unknown, b: unknown, out: Paar[]) {
  if (typeof a === "string" && typeof b === "string") {
    out.push([a, b]);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of Object.keys(a)) if (key in b) paare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], out);
  }
}

function allePaare(): Paar[] {
  const out: Paar[] = [];
  for (const konten of [ACCOUNTS, ASSET_ACCOUNTS, DARLEHEN_KONTEN, LOHN_KONTEN, STEUER_KONTEN, PRIVATE_USE_ACCOUNTS, SACHENTNAHME_KONTEN])
    paare(konten.SKR03, konten.SKR04, out);
  for (const kategorie of Object.values(EXPENSE_CATEGORIES)) out.push([kategorie.SKR03, kategorie.SKR04]);
  for (const art of Object.values(PAUSCHALE_KONTEN)) out.push([art.SKR03.konto, art.SKR04.konto]);
  return out;
}

let zuordnung: Record<Kontenrahmen, Map<string, string | null>> | undefined;

/** SKR03 → SKR04 und umgekehrt; null, wo ein Konto mehrere Entsprechungen hat */
function tabelle(): Record<Kontenrahmen, Map<string, string | null>> {
  if (zuordnung) return zuordnung;
  const nach04 = new Map<string, string | null>();
  const nach03 = new Map<string, string | null>();
  const eintragen = (map: Map<string, string | null>, von: string, nach: string) => {
    if (!map.has(von)) map.set(von, nach);
    else if (map.get(von) !== nach) map.set(von, null);
  };
  for (const [skr03, skr04] of allePaare()) {
    eintragen(nach04, skr03, skr04);
    eintragen(nach03, skr04, skr03);
  }
  // Frühere Konten der Sachentnahme nur in eine Richtung, auf das heutige Konto des Satzes
  for (const [von, nach] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const)
    for (const [konto, satz] of Object.entries(SACHENTNAHME_FRUEHERE_KONTEN[von]))
      eintragen(von === "SKR03" ? nach04 : nach03, konto, SACHENTNAHME_KONTEN[nach][satz]);
  zuordnung = { SKR03: nach04, SKR04: nach03 };
  return zuordnung;
}

/** Das Konto gleicher Rolle im anderen Kontenrahmen, oder null, wenn es keine eindeutige Entsprechung gibt */
export function kontoImKontenrahmen(von: Kontenrahmen, nach: Kontenrahmen, konto: string): string | null {
  if (von === nach) return konto;
  return tabelle()[von].get(konto) ?? null;
}

/** Zeilen mit den Konten des anderen Kontenrahmens, oder null, wenn ein Konto sich nicht eindeutig übertragen lässt */
export function zeilenImKontenrahmen<Z extends { account: string }>(von: Kontenrahmen, nach: Kontenrahmen, zeilen: readonly Z[]): Z[] | null {
  const result: Z[] = [];
  for (const zeile of zeilen) {
    const konto = kontoImKontenrahmen(von, nach, zeile.account);
    if (konto === null) return null;
    result.push({ ...zeile, account: konto });
  }
  return result;
}
