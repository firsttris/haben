/*
 * Körperschaft- und Gewerbesteuer einer GmbH oder UG: Angaben je Jahr (Hebesatz, Verlustvorträge; zur Erklärung
 * Anteilseigner, Einlagekonto, Verträge, Gründung), Berechnung und Buchung der Steuerrückstellungen. Ausschüttung und
 * Erklärung lesen die Angaben von hier.
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export {
  bookSteuerrueckstellungen,
  kapgErklaerungAngaben,
  kapgAngabenSchema,
  kapgErklaerungSchema,
  kapgSteuernJahr,
  KoerperschaftError,
  saveKapgAngaben,
  saveKapgErklaerungAngaben,
  storedAngaben as gespeicherteKapgAngaben,
  type KapgErklaerungAngaben,
} from "./koerperschaft.ts";
