import { describe, expect, it } from "vitest";
import { antwort, nachgestellt, netzwerkfehler } from "./nachgestellt.ts";
import { pruefeSozialversicherung, svUrl } from "./sozialversicherung.ts";

// Kopf des Inhaltsverzeichnisses auf gesetze-im-internet.de (ISO-8859-1, Umlaute als Entities oder Bytes)
const verzeichnis = (jahr: number) =>
  `<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />\n<title>SVBezGrV ${jahr} - nichtamtliches Inhaltsverzeichnis</title></head><body></body></html>`;
const html = (s: string) => antwort(200, s, { "content-type": "text/html" });
const stand = { heute: new Date(2026, 10, 5), hinterlegt: [2026] };

describe("Sozialversicherungsrechengrößen", () => {
  it("meldet nichts, solange die Verordnung des nächsten Jahres fehlt (404)", async () => {
    const holen = nachgestellt({ [svUrl(2027)]: antwort(404, "Not Found") });
    expect(await pruefeSozialversicherung(stand, holen)).toEqual({ befunde: [], warnungen: [] });
    // 2026 ist hinterlegt und wird nicht abgefragt
    expect(holen.aufrufe.map((a) => a.url)).toEqual([svUrl(2027)]);
  });

  it("meldet die Verordnung des nächsten Jahres, sobald sie erscheint", async () => {
    const e = await pruefeSozialversicherung(stand, nachgestellt({ [svUrl(2027)]: html(verzeichnis(2027)) }));
    expect(e.warnungen).toEqual([]);
    expect(e.befunde).toHaveLength(1);
    expect(e.befunde[0]?.schluessel).toBe("sv-2027");
    expect(e.befunde[0]?.text).toContain("https://www.gesetze-im-internet.de/svbezgrv_2027/");
    expect(e.befunde[0]?.text).toContain("SV_2027");
  });

  it("meldet nichts mehr, wenn das Jahr hinterlegt ist", async () => {
    const holen = nachgestellt({ [svUrl(2027)]: html(verzeichnis(2027)) });
    expect(await pruefeSozialversicherung({ ...stand, hinterlegt: [2026, 2027] }, holen)).toEqual({ befunde: [], warnungen: [] });
    expect(holen.aufrufe).toEqual([]);
  });

  it("nimmt eine andere Seite unter der Adresse nicht als Verordnung", async () => {
    const e = await pruefeSozialversicherung(stand, nachgestellt({ [svUrl(2027)]: html(verzeichnis(2026)) }));
    expect(e.befunde).toEqual([]);
    expect(e.warnungen).toEqual([`Sozialversicherung 2027: ${svUrl(2027)} ist nicht die erwartete Verordnung`]);
  });

  it("macht aus einer Quelle, die nicht antwortet, eine Warnung", async () => {
    const e503 = await pruefeSozialversicherung(stand, nachgestellt({ [svUrl(2027)]: antwort(503) }));
    expect(e503).toEqual({ befunde: [], warnungen: [`Sozialversicherung 2027: ${svUrl(2027)} nicht erreichbar (HTTP 503)`] });
    const reset = await pruefeSozialversicherung(stand, nachgestellt({ [svUrl(2027)]: netzwerkfehler }));
    expect(reset.warnungen).toEqual([`Sozialversicherung 2027: ${svUrl(2027)} nicht erreichbar (Connection reset by peer)`]);
  });
});
