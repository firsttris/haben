import { describe, expect, it } from "vitest";
import { ohneBelegText, ruecknahmeHinweis, ruecknahmeText } from "./dateistand-texte.ts";

/*
 * Die Sätze über einer Buchung ohne Datei (#1235, #1318, #1322). Sie hängen am Grund und beim fehlenden Beleglink und bei
 * der Quelle ohne Beleg daran, ob sich bestätigen lässt: WISO und die Lexoffice-Sicherung setzen das Merkmal ohne
 * Beleg-GUID, dort darf kein Satz über eine GUID stehen.
 */
describe("Text über einer Buchung ohne Datei", () => {
  it("lädt nur beim fehlenden Beleglink zum Bestätigen ein", () => {
    const text = ohneBelegText("kein_beleglink", "Accountable", true);
    expect(text).toContain("kommt ohne Einzelbeleg");
    expect(text).toContain("hält es hier fest");
  });

  it("nennt bei vorhandener Beleg-GUID den wahren Grund und kein Bestätigen", () => {
    const text = ohneBelegText("datei_fehlt_im_export", "Accountable", false);
    expect(text).toContain("Beleg-GUID");
    expect(text).toContain("fehlt nur im Export");
    expect(text).not.toContain("kommt ohne Einzelbeleg");
  });

  it("lädt eine Buchung ohne Beleg aus der Sicherung zum Bestätigen ein (#1318)", () => {
    const text = ohneBelegText("quelle_ohne_beleg", "Lexware Office", true);
    expect(text).toContain("Buchung ohne Beleg");
    expect(text).toContain("hält es hier fest");
    expect(text).not.toContain("GUID");
  });

  it("nennt bei „Dokument Vorhanden“ den anderen Beleg derselben Rechnung", () => {
    const text = ohneBelegText("dokument_vorhanden", "Accountable", false);
    expect(text).toBe(
      "Accountable führt zu dieser Rechnung ein Dokument; es hängt an einer anderen Zeile derselben Rechnung. Bestätigen lässt sich das hier nicht.",
    );
    expect(text).not.toContain("Beleg-GUID");
  });

  it("behauptet für fremde Quellen ohne GUID nichts über einen Einzelbeleg", () => {
    for (const quelle of ["WISO", "Lexware Office"]) {
      const text = ohneBelegText("quelle_ohne_beleg", quelle, false);
      expect(text).toBe(`Zu dieser Buchung hat ${quelle} keine Datei geliefert. Bestätigen lässt sich das hier nicht.`);
      expect(text).not.toContain("GUID");
    }
  });

  it("bleibt beim fehlenden Beleglink auch dann ehrlich, wenn nicht bestätigt werden darf", () => {
    const text = ohneBelegText("kein_beleglink", "Accountable", false);
    expect(text).not.toContain("hält es hier fest");
    expect(text).toBe("Zu dieser Buchung hat Accountable keine Datei geliefert. Bestätigen lässt sich das hier nicht.");
  });
});

/*
 * Was in der Rückfrage „Bestätigung zurücknehmen?“ steht, hängt an der Quelle (#1317): Im Accountable-Stapel zählt der
 * Abgleich den zurückgenommenen Stand weiter nicht als fehlende Datei (#1235), bei sevDesk fällt er dorthin zurück.
 */
describe("Rückfrage „Bestätigung zurücknehmen?“", () => {
  it("verspricht im Accountable-Stapel nur das Offenwerden, nicht das Zählen im Abgleich", () => {
    const text = ruecknahmeText(true);
    expect(text).toContain("wieder als offen, wie vor der Bestätigung");
    expect(text).not.toContain("Abgleich");
    expect(ruecknahmeHinweis(true)).toBe(`Bestätigung zurückgenommen. ${text}`);
  });

  it("nennt bei sevDesk weiter den Abgleich", () => {
    const text = ruecknahmeText(false);
    expect(text).toContain("der Abgleich zählt ihn wieder zu den Belegen ohne Datei");
    expect(text).not.toContain("wie vor der Bestätigung");
    expect(ruecknahmeHinweis(false)).toBe(`Bestätigung zurückgenommen. ${text}`);
  });
});
