import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pruefeLohnsteuer, papUrl } from "./lohnsteuer.ts";
import { antwort, nachgestellt, netzwerkfehler } from "./nachgestellt.ts";

const pap = (jahr: number, stand = "2026-10-20 09:00") =>
  `﻿<PAP name="Lohnsteuer${jahr}" version="1.0" versionNummer="1.0">\n<VARIABLES>\n<!-- Stand: ${stand} -->\n</VARIABLES></PAP>`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const xml = (s: string) => antwort(200, s, { "content-type": "application/xml" });
// So antwortet der BMF-Steuerrechner auf ein Jahr, das es nicht gibt (2027 am 05.11.2026, 2024)
const fehlt303 = antwort(303, "", { location: "/error_path/404.html?al_req_id=abc" });
const fehlt302 = antwort(302, "", { location: "https://www.bmf-steuerrechner.de/error/fehler.xhtml?allgemeinerFehler=extern.interface.pseudocode.notfound" });

const NOV_2026 = new Date(2026, 10, 5);
const stand = (papSha256: Record<number, string>, tarifJahre = [2024, 2025, 2026]) => ({
  heute: NOV_2026,
  papSha256: (j: number) => papSha256[j] ?? null,
  tarifJahre,
});

describe("Lohnsteuer-PAP", () => {
  it("meldet nichts, solange das nächste Jahr fehlt und das laufende unverändert ist", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: xml(pap(2026)), [papUrl(2027)]: fehlt303 });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen);
    expect(e).toEqual({ befunde: [], warnungen: [] });
    expect(holen.aufrufe.map((a) => a.url)).toEqual([papUrl(2026), papUrl(2027)]);
    expect(holen.aufrufe[0]?.init?.redirect).toBe("manual");
  });

  it("wertet auch die Weiterleitung auf „notfound“ als fehlend", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: xml(pap(2026)), [papUrl(2027)]: fehlt302 });
    expect(await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen)).toEqual({ befunde: [], warnungen: [] });
  });

  it("meldet den PAP des nächsten Jahres und den fehlenden Tarif, sobald das XML da ist", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: xml(pap(2026)), [papUrl(2027)]: xml(pap(2027, "2026-11-12 10:00")) });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen);
    expect(e.warnungen).toEqual([]);
    expect(e.befunde.map((b) => b.schluessel)).toEqual(["pap-2027", "est-tarif-2027"]);
    const [neu, tarif] = e.befunde;
    expect(neu?.titel).toBe("Lohnsteuer-PAP 2027 ist erschienen");
    expect(neu?.text).toContain(papUrl(2027));
    expect(neu?.text).toContain("Stand laut XML: 2026-11-12 10:00");
    expect(neu?.text).toContain(sha(pap(2027, "2026-11-12 10:00")));
    expect(neu?.text).toContain("skills/jahreswerte/SKILL.md#lohnsteuer-pap");
    expect(tarif?.text).toContain("packages/core/src/income-tax.ts");
  });

  it("meldet keinen Tarif, wenn TARIFE das Jahr schon hat", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: xml(pap(2026)), [papUrl(2027)]: xml(pap(2027)) });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }, [2026, 2027]), holen);
    expect(e.befunde.map((b) => b.schluessel)).toEqual(["pap-2027"]);
  });

  it("meldet einen geänderten PAP des laufenden Jahres mit altem und neuem Hash", async () => {
    const neu = pap(2026, "2026-05-02 08:00");
    const holen = nachgestellt({ [papUrl(2026)]: xml(neu), [papUrl(2027)]: fehlt303 });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen);
    expect(e.befunde.map((b) => b.schluessel)).toEqual(["pap-2026-geaendert"]);
    expect(e.befunde[0]?.text).toContain(sha(pap(2026)));
    expect(e.befunde[0]?.text).toContain(sha(neu));
  });

  it("prüft im Dezember ein schon hinterlegtes nächstes Jahr auf Änderungen", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: xml(pap(2026)), [papUrl(2027)]: xml(pap(2027, "neu")) });
    const e = await pruefeLohnsteuer({ ...stand({ 2026: sha(pap(2026)), 2027: sha(pap(2027)) }, [2026, 2027]), heute: new Date(2026, 11, 1) }, holen);
    expect(e.befunde.map((b) => b.schluessel)).toEqual(["pap-2027-geaendert"]);
  });

  it("macht aus einer Quelle, die nicht antwortet, eine Warnung", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: antwort(503, "Service Unavailable"), [papUrl(2027)]: netzwerkfehler });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen);
    expect(e.befunde).toEqual([]);
    expect(e.warnungen).toEqual([
      `PAP 2026: ${papUrl(2026)} nicht auswertbar (HTTP 503)`,
      `PAP 2027: ${papUrl(2027)} nicht auswertbar (Connection reset by peer)`,
    ]);
  });

  it("nimmt eine Wartungsseite mit 200 nicht als PAP", async () => {
    const holen = nachgestellt({ [papUrl(2026)]: antwort(200, "<html>Wartung</html>"), [papUrl(2027)]: fehlt303 });
    const e = await pruefeLohnsteuer(stand({ 2026: sha(pap(2026)) }), holen);
    expect(e.befunde).toEqual([]);
    expect(e.warnungen).toEqual([`PAP 2026: ${papUrl(2026)} nicht auswertbar (Antwort ist kein PAP-XML)`]);
  });

  it("vergleicht den echten PAP 2026 aus dem Repository mit dem hinterlegten Hash", async () => {
    const { readFileSync } = await import("node:fs");
    const { lohnsteuerPapQuelle } = await import("../../packages/core/src/lohnsteuer/index.ts");
    const datei = readFileSync(new URL("../../packages/core/src/lohnsteuer/Lohnsteuer2026.xml", import.meta.url));
    const holen = nachgestellt({
      [papUrl(2026)]: { status: 200, bytes: new Uint8Array(datei), headers: { "content-type": "application/xml" } },
      [papUrl(2027)]: fehlt303,
    });
    const e = await pruefeLohnsteuer({ heute: NOV_2026, papSha256: (j) => lohnsteuerPapQuelle(j)?.sha256 ?? null, tarifJahre: [2026] }, holen);
    expect(e).toEqual({ befunde: [], warnungen: [] });
  });
});
