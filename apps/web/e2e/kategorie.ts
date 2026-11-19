import { EINNAHME_KATEGORIEN, EXPENSE_CATEGORIES, type EinnahmeKategorie, type ExpenseCategory } from "@haben/core";
import { expect, type Locator } from "@playwright/test";

type Kategorie = ExpenseCategory | EinnahmeKategorie;

const maskiert = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, (zeichen) => `\\${zeichen}`);
const istEinnahme = (key: Kategorie): key is EinnahmeKategorie => Object.hasOwn(EINNAHME_KATEGORIEN, key);

/** Der Name der Kategorie, ohne die Nummer des Kontos */
const name = (key: Kategorie): string => (istEinnahme(key) ? EINNAHME_KATEGORIEN[key].label : EXPENSE_CATEGORIES[key].label);

/**
 * Was das Suchfeld für den Schlüssel zeigt: bei Ausgaben die Nummer des Kontos und der Name, „4920 · Telefon“ in SKR03
 * (#1438); Einnahmen und Anlagegut ohne Nummer: das Erlöskonto hängt am Steuersatz, das Anlagekonto an der Art
 */
export const kategorieName = (key: Kategorie): RegExp =>
  new RegExp(istEinnahme(key) || key === "anlage" ? `^${maskiert(name(key))}$` : `^[0-9]{4} · ${maskiert(name(key))}$`);

/** Kategorie im Suchfeld wählen: Name eintippen und den Treffer anklicken (das Feld ist kein <select> mehr) */
export async function waehleKategorie(feld: Locator, key: Kategorie): Promise<void> {
  await feld.click();
  await feld.fill(name(key));
  // Der Eintrag nennt neben der Bezeichnung auch die Gruppe, daher nicht über den ganzen Text der Zeile
  await feld
    .locator("xpath=..")
    .getByRole("option")
    .filter({ has: feld.page().getByText(kategorieName(key)) })
    .click();
  await expect(feld).toHaveValue(kategorieName(key));
}
