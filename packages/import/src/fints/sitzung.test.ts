import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fintsBankMeldung,
  fintsChallengeText,
  fintsClient,
  fintsKonten,
  fintsSynchronisieren,
  fintsTanVerfahren,
  fintsUmsaetze,
  type FintsZugang,
} from "./sitzung.ts";
import { type FintsTestbank, startFintsTestbank } from "./testbank.ts";

const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.9" };
const IBAN = "DE02120300000000202051";

describe("FinTS-Sitzung gegen die nachgebaute Bank", () => {
  let bank: FintsTestbank;
  let zugang: FintsZugang;

  beforeAll(async () => {
    bank = await startFintsTestbank({
      produktId: PRODUKT.id,
      konten: [
        { iban: IBAN, nummer: "0000202051", name: "Girokonto" },
        { iban: "DE89370400440532013000", nummer: "0532013000", name: "Dollarkonto", waehrung: "USD" },
      ],
      umsaetze: {
        [IBAN]: [
          { tag: "2026-09-30", betrag: "1000,00", name: "Eigenkapital", zweck: "Einlage", ref: "R0" },
          { tag: "2026-10-05", betrag: "100,00", name: "Muster GmbH", iban: "DE89370400440532013000", zweck: "Rechnung RE-2026-0042 vielen Dank", ref: "R1" },
          { tag: "2026-10-20", betrag: "-49,99", name: "Telekom", zweck: "Telefon 10/2026", ref: "R2" },
        ],
      },
    });
    zugang = { url: bank.url, blz: "12030000", benutzer: "max", pin: "12345" };
  });

  afterAll(async () => {
    await bank.schliessen();
  });

  beforeEach(() => {
    Object.assign(bank.zustand, {
      scaBeiAnmeldung: false,
      scaBeiUmsaetzen: false,
      freigegeben: false,
      appTanEintippen: false,
      nichtErreichbar: false,
      mt940Unlesbar: false,
    });
  });

  it("verbindet mit TAN bei der Anmeldung und ruft danach Umsätze ab", async () => {
    const client = fintsClient(PRODUKT, zugang);
    const erste = await fintsSynchronisieren(client);
    expect(erste.art).toBe("ok");
    // Die Produktnummer geht in jeder Anmeldung mit (HKVVB), die PIN nur in der Signatur
    expect(bank.zustand.anfragen[0]).toMatchObject({ produktId: PRODUKT.id, pin: "12345", verfahren: 999 });
    const verfahren = fintsTanVerfahren(client.config.bankingInformation);
    expect(verfahren.map((v) => [v.id, v.name, v.entkoppelt, v.mediumNoetig])).toEqual([
      [921, "pushTAN 2.0", true, false],
      [912, "chipTAN manuell", false, false],
    ]);
    expect(client.config.bankingInformation.systemId).not.toBe("0");

    bank.zustand.scaBeiAnmeldung = true;
    client.selectTanMethod(912);
    const zweite = await fintsSynchronisieren(client);
    expect(zweite).toMatchObject({ art: "tan", anfrage: { text: "Bitte geben Sie die TAN ein.", entkoppelt: false } });
    if (zweite.art !== "tan") throw new Error("TAN erwartet");

    const falsch = await fintsSynchronisieren(client, { referenz: zweite.anfrage.referenz, tan: "999999" });
    expect(falsch).toEqual({ art: "abgelehnt", meldung: "TAN ungültig. (9941)", codes: [9050, 9941] });
    const richtig = await fintsSynchronisieren(client, { referenz: zweite.anfrage.referenz, tan: "123456" });
    expect(richtig.art).toBe("ok");

    const konten = fintsKonten(client);
    expect(konten.abrufbar.map((k) => k.iban)).toEqual([IBAN]);
    expect(konten.fremdwaehrung).toEqual(["USD"]);

    const umsaetze = await fintsUmsaetze(client, konten.abrufbar[0]!, "2026-10-01", "2026-10-31");
    expect(umsaetze.art).toBe("ok");
    if (umsaetze.art !== "ok") return;
    expect(umsaetze.wert.flatMap((s) => s.transactions.map((t) => [t.amount, t.purpose]))).toEqual([
      [100, "Rechnung RE-2026-0042 vielen Dank"],
      [-49.99, "Telefon 10/2026"],
    ]);
    expect(bank.zustand.anfragen.at(-2)).toMatchObject({ iban: IBAN, von: "2026-10-01", bis: "2026-10-31" });
  });

  it("wartet bei pushTAN auf die Freigabe in der App", async () => {
    const client = fintsClient(PRODUKT, zugang);
    await fintsSynchronisieren(client);
    client.selectTanMethod(921);
    expect((await fintsSynchronisieren(client)).art).toBe("ok");
    const konto = fintsKonten(client).abrufbar[0]!;

    bank.zustand.scaBeiUmsaetzen = true;
    const anfrage = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31");
    expect(anfrage).toMatchObject({ art: "tan", anfrage: { entkoppelt: true, text: "Bitte bestätigen Sie den Zugriff in Ihrer Banking-App." } });
    if (anfrage.art !== "tan") return;
    const nochNicht = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31", { referenz: anfrage.anfrage.referenz });
    expect(nochNicht.art).toBe("tan");
    bank.zustand.freigegeben = true;
    const fertig = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31", { referenz: anfrage.anfrage.referenz });
    expect(fertig.art).toBe("ok");
    if (fertig.art === "ok") expect(fertig.wert[0]?.transactions).toHaveLength(2);
    // Das Format der Antwort (HKKAZ: MT940) kommt mit, auch nach der Freigabe: map.ts braucht es für das Jahr des Buchungstags
    expect(fertig.art === "ok" && fertig.wert.map((s) => s.format)).toEqual(["MT940"]);
    bank.zustand.scaBeiUmsaetzen = false;
    const ohneTan = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31");
    expect(ohneTan.art === "ok" && ohneTan.wert.map((s) => s.format)).toEqual(["MT940"]);
  });

  it("fragt bei pushTAN eine TAN ab, wenn die Bank sie eintippen lässt (0030 ohne 3955, wie die Consorsbank)", async () => {
    const client = fintsClient(PRODUKT, zugang);
    await fintsSynchronisieren(client);
    Object.assign(bank.zustand, { scaBeiAnmeldung: true, appTanEintippen: true });
    client.selectTanMethod(921);
    const anmeldung = await fintsSynchronisieren(client);
    expect(anmeldung).toMatchObject({
      art: "tan",
      anfrage: { entkoppelt: false, text: "Bitte generieren Sie eine TAN mit Ihrer Banking App oder Ihrem TAN Generator und geben diese hier ein." },
    });
    if (anmeldung.art !== "tan") return;

    const fertig = await fintsSynchronisieren(client, { referenz: anmeldung.anfrage.referenz, tan: "123456" });
    expect(fertig.art).toBe("ok");
    // Die TAN geht mit Prozess 2 an die Bank, nicht als Statusabfrage (S); das Verfahren bleibt in den BPD entkoppelt
    expect(bank.zustand.anfragen.filter((a) => a.tan === "123456").at(-1)).toMatchObject({ tanProzess: "2", verfahren: 921 });
    expect(client.config.selectedTanMethod?.isDecoupled).toBe(true);
    expect(fintsKonten(client).abrufbar.map((k) => k.iban)).toEqual([IBAN]);
  });

  it("wirft, wenn lib-fints die Umsätze nicht lesen kann, statt keine zu melden", async () => {
    const client = fintsClient(PRODUKT, zugang);
    await fintsSynchronisieren(client);
    client.selectTanMethod(921);
    expect((await fintsSynchronisieren(client)).art).toBe("ok");
    const konto = fintsKonten(client).abrufbar[0]!;
    const unlesbar = /^Die Bank hat die Umsätze von Konto …2051 als MT940 geschickt, Haben kann sie nicht lesen \(lib-fints: Expected CustomerReference token/;

    bank.zustand.mt940Unlesbar = true;
    await expect(fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31")).rejects.toThrow(unlesbar);

    // Ebenso, wenn die Umsätze erst nach der Freigabe kommen
    bank.zustand.scaBeiUmsaetzen = true;
    const anfrage = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31");
    if (anfrage.art !== "tan") throw new Error("TAN erwartet");
    bank.zustand.freigegeben = true;
    await expect(fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31", { referenz: anfrage.anfrage.referenz })).rejects.toThrow(unlesbar);

    // Ohne Umsatz im Zeitraum bleibt nichts Unlesbares: keine Umsätze, kein Fehler
    expect(await fintsUmsaetze(client, konto, "2026-10-21", "2026-10-31")).toMatchObject({ art: "ok", wert: [{ transactions: [] }] });
    bank.zustand.mt940Unlesbar = false;
    const wieder = await fintsUmsaetze(client, konto, "2026-10-01", "2026-10-31");
    expect(wieder.art === "ok" && wieder.wert[0]?.transactions).toHaveLength(2);
  });

  it("arbeitet mit gespeicherten Bankdaten ohne neue Synchronisierung weiter", async () => {
    const erster = fintsClient(PRODUKT, zugang);
    await fintsSynchronisieren(erster);
    erster.selectTanMethod(912);
    await fintsSynchronisieren(erster);
    const gespeichert = JSON.parse(JSON.stringify(erster.config.bankingInformation));

    const vorher = bank.zustand.anfragen.length;
    const zweiter = fintsClient(PRODUKT, { ...zugang, url: "https://wird-nicht-gebraucht.example" }, { bankingInformation: gespeichert, tanVerfahren: 912 });
    const umsaetze = await fintsUmsaetze(zweiter, fintsKonten(zweiter).abrufbar[0]!, "2026-10-01", "2026-10-31");
    expect(umsaetze.art).toBe("ok");
    expect(bank.zustand.anfragen.slice(vorher).map((a) => a.segmente.filter((s) => s.startsWith("HK")))).toEqual([
      ["HKIDN", "HKVVB", "HKTAN"],
      ["HKKAZ", "HKTAN"],
      ["HKEND"],
    ]);
  });

  it("meldet eine falsche PIN mit dem Text der Bank", async () => {
    const antwort = await fintsSynchronisieren(fintsClient(PRODUKT, { ...zugang, pin: "00000" }));
    expect(antwort).toEqual({ art: "abgelehnt", meldung: "PIN ungültig. (9942)", codes: [9800, 9942] });
  });

  it("meldet, wenn die Bank die Produktnummer nicht kennt", async () => {
    const antwort = await fintsSynchronisieren(fintsClient({ ...PRODUKT, id: "UNBEKANNT" }, zugang));
    expect(antwort).toEqual({ art: "abgelehnt", meldung: "Das Kundenprodukt wird nicht unterstützt. (9952)", codes: [9050, 9952] });
  });

  it("schreibt eine Antwort, die lib-fints nicht lesen kann, nicht ins Log", async () => {
    // lib-fints 1.5.3 schreibt sie sonst mit console.error ganz ins Log (httpClient.js, sendMessage), auch ohne debugEnabled:
    // Umsätze, Namen und IBANs der Inhaberin im Log des Servers
    const geheim = "Max Mustermann DE89370400440532013000";
    const server = createServer((_req, res) => res.end(Buffer.from(`HNHBK:1:3+kaputt'HIRMG:2:2+${geheim}'`, "latin1").toString("base64")));
    await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await expect(fintsSynchronisieren(fintsClient(PRODUKT, { ...zugang, url }))).rejects.toThrow();
      expect(log.mock.calls.flat().map(String).join("\n")).not.toContain(geheim);
    } finally {
      log.mockRestore();
      server.close();
    }
  });

  it("wirft, wenn die Bank nicht erreichbar ist", async () => {
    bank.zustand.nichtErreichbar = true;
    await expect(fintsSynchronisieren(fintsClient(PRODUKT, zugang))).rejects.toThrow(/503/);
    bank.zustand.nichtErreichbar = false;
  });
});

describe("Texte der Bank", () => {
  it("nimmt Fehler vor Warnungen und hat einen Text, wenn die Bank keinen nennt", () => {
    expect(
      fintsBankMeldung([
        { code: 10, text: "Nachricht entgegengenommen." },
        { code: 3076, text: "Keine SCA nötig." },
        { code: 9050, text: "Teilweise fehlerhaft." },
        { code: 9210, text: "Zeitraum zu lang." },
      ]),
    ).toBe("Zeitraum zu lang. (9210)");
    expect(fintsBankMeldung([{ code: 9800, text: "Dialog abgebrochen." }])).toBe("Dialog abgebrochen. (9800)");
    expect(fintsBankMeldung([{ code: 3956, text: "Ausstehend." }])).toBe("Ausstehend. (3956)");
    expect(fintsBankMeldung([])).toBe("Die Bank hat den Auftrag abgelehnt.");
  });

  it("macht aus der Challenge schlichten Text", () => {
    expect(fintsChallengeText("Bitte <b>TAN</b> eingeben.<br>Auftrag: <ul><li>Umsätze</li><li>Konto 4711</li></ul>")).toBe(
      "Bitte TAN eingeben.\nAuftrag: Umsätze\nKonto 4711",
    );
    expect(fintsChallengeText(undefined)).toBe("");
  });
});
