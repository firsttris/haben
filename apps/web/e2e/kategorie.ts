import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@haben/core";
import { expect, type Locator } from "@playwright/test";

/** Der Name, den das Suchfeld für den Schlüssel zeigt */
export const kategorieName = (key: ExpenseCategory): string => EXPENSE_CATEGORIES[key].label;

/** Kategorie im Suchfeld wählen: Name eintippen und den Treffer anklicken (das Feld ist kein <select> mehr) */
export async function waehleKategorie(feld: Locator, key: ExpenseCategory): Promise<void> {
  const name = kategorieName(key);
  await feld.click();
  await feld.fill(name);
  // Der Eintrag nennt neben dem Namen auch die Gruppe, daher nicht über den ganzen Namen der Zeile
  await feld
    .locator("xpath=..")
    .getByRole("option")
    .filter({ has: feld.page().getByText(name, { exact: true }) })
    .click();
  await expect(feld).toHaveValue(name);
}
