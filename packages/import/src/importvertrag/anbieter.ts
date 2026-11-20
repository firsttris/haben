/* Ohne Abhängigkeiten, damit auch die Oberfläche es laden kann (Einstieg @haben/import/anbieter). */

/**
 * Anbieter mit eigener Anbindung in Haben: Ihre Quellen entstehen beim Verbinden, nie über den REST-Import (#306, Schritt
 * 4). Eine neue Anbindung in Haben gehört hier dazu, sonst könnte ein Dienst von außen in ihre Quelle liefern; welche Konten
 * sie bindet, sagt `gebundeneKonten` (apps/web, modules/bank/abruf-bindung.ts), das tsc für jeden Eintrag verlangt.
 */
export const INTERNAL_PROVIDERS = ["enablebanking", "etsy", "paypal", "stripe"] as const;

export const isInternalProvider = (provider: string): boolean => (INTERNAL_PROVIDERS as readonly string[]).includes(provider);
