/**
 * Prüft die Adresse einer eigenen Seite (#199), bevor Haben sie im Rahmen zeigt.
 *
 * - Nur http und https: `javascript:` oder `data:` liefen sonst im Rahmen mit.
 * - Keine Zugangsdaten in der Adresse: sie stünden im Menü, im Seitenquelltext und im Änderungsprotokoll.
 * - Nicht die Herkunft von Haben selbst: Eine Seite derselben Herkunft dürfte trotz `sandbox` das Attribut entfernen
 *   (allow-scripts mit allow-same-origin) und hätte die volle Sitzung, könnte also festschreiben und an ELSTER senden.
 *   Ein anderer Port oder eine Subdomain ist eine andere Herkunft und erlaubt.
 */

/** Ergebnis als Wert: die bereinigte Adresse oder die Meldung für den Nutzer */
export type PageUrlResult = { ok: true; url: string } | { ok: false; message: string };

export function checkPageUrl(raw: string, habenUrl: string): PageUrlResult {
  const url = URL.parse(raw.trim());
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return { ok: false, message: "Bitte eine vollständige Adresse mit https:// oder http:// angeben." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Die Adresse darf keinen Benutzernamen und kein Passwort enthalten." };
  }
  if (url.origin === new URL(habenUrl).origin) {
    return { ok: false, message: "Die Seite muss unter einer anderen Adresse laufen als Haben, etwa einer eigenen Subdomain oder einem anderen Port." };
  }
  return { ok: true, url: url.href };
}
