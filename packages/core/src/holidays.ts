import { addDays } from "./invoice.ts";
import type { Bundesland } from "./steuernummer.ts";

/** Ostersonntag nach der Gaußschen Osterformel (Anonymer Gregorianischer Algorithmus) */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Gesetzliche Feiertage, die im ganzen Bundesland gelten. Feiertage nur einzelner Gemeinden
 * (Fronleichnam in Teilen Sachsens und Thüringens, Mariä Himmelfahrt in Bayern, Augsburger
 * Friedensfest) fehlen bewusst.
 */
export function publicHolidays(year: number, bundesland: Bundesland | null): Map<string, string> {
  const easter = easterSunday(year);
  const fixed = (mmdd: string) => `${year}-${mmdd}`;
  const days = new Map<string, string>([
    [fixed("01-01"), "Neujahr"],
    [addDays(easter, -2), "Karfreitag"],
    [addDays(easter, 1), "Ostermontag"],
    [fixed("05-01"), "Tag der Arbeit"],
    [addDays(easter, 39), "Christi Himmelfahrt"],
    [addDays(easter, 50), "Pfingstmontag"],
    [fixed("10-03"), "Tag der Deutschen Einheit"],
    [fixed("12-25"), "1. Weihnachtstag"],
    [fixed("12-26"), "2. Weihnachtstag"],
  ]);
  if (!bundesland) return days;
  const add = (states: Bundesland[], date: string, name: string) => {
    if (states.includes(bundesland)) days.set(date, name);
  };
  add(["BW", "BY", "ST"], fixed("01-06"), "Heilige Drei Könige");
  add(["BE", "MV"], fixed("03-08"), "Internationaler Frauentag");
  add(["BW", "BY", "HE", "NW", "RP", "SL"], addDays(easter, 60), "Fronleichnam");
  add(["SL"], fixed("08-15"), "Mariä Himmelfahrt");
  add(["TH"], fixed("09-20"), "Weltkindertag");
  add(["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"], fixed("10-31"), "Reformationstag");
  add(["BW", "BY", "NW", "RP", "SL"], fixed("11-01"), "Allerheiligen");
  // Buß- und Bettag: Mittwoch vor dem 23. November
  const nov23 = new Date(Date.UTC(year, 10, 23));
  const back = ((nov23.getUTCDay() - 3 + 7) % 7) || 7;
  add(["SN"], addDays(fixed("11-23"), -back), "Buß- und Bettag");
  return days;
}

/** Samstag, Sonntag oder Feiertag im Bundesland */
export function isNonWorkingDay(isoDate: string, bundesland: Bundesland | null): boolean {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  return publicHolidays(Number(isoDate.slice(0, 4)), bundesland).has(isoDate);
}

/**
 * Fälligkeit: Rechnungsdatum plus Zahlungsziel. Fällt das Ende auf ein Wochenende oder einen
 * Feiertag, gilt der nächste Werktag (§ 193 BGB).
 */
export function invoiceDueDate(issueDate: string, paymentTermDays: number, bundesland: Bundesland | null): string {
  let date = addDays(issueDate, paymentTermDays);
  if (paymentTermDays === 0) return date;
  while (isNonWorkingDay(date, bundesland)) date = addDays(date, 1);
  return date;
}
