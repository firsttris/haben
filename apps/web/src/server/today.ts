const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

/** Heutiges Datum in Deutschland als YYYY-MM-DD */
export function today(now = new Date()): string {
  return berlin.format(now);
}
