import { germanDay } from "@haben/core";

/** Heutiges Datum in Deutschland als YYYY-MM-DD */
export function today(now = new Date()): string {
  return germanDay(now);
}
