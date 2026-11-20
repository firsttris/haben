import { type BankingInformation, type ClientResponse, FinTSClient } from "lib-fints";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fintsClient, fintsSynchronisieren } from "./sitzung.ts";

const URL = "https://banking-rl7.s-fints-pt-rl.de/fints30";
const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.11" };

function bankdaten(): BankingInformation {
  return {
    systemId: "TEST-SYSTEM",
    bankMessages: [],
    bpd: {
      version: 1,
      countryCode: 280,
      bankId: "37050198",
      bankName: "Testbank",
      url: URL,
      maxTransactionsPerMessage: 1,
      supportedLanguages: [],
      supportedHbciVersions: [300],
      availableTanMethodIds: [923],
      allowedTransactions: [],
      supportedTanMethods: [
        { id: 923, name: "pushTAN 2.0", version: 7, isDecoupled: true, activeTanMediaCount: 1, activeTanMedia: [], tanMediaRequirement: 2 },
      ],
    },
  };
}

function client(gespeichert = true): FinTSClient {
  return fintsClient(
    PRODUKT,
    { url: URL, blz: "37050198", benutzer: "testperson", pin: "test-pin", kundenId: "test-kunde" },
    gespeichert ? { bankingInformation: bankdaten(), tanVerfahren: 923 } : undefined,
  );
}

function response(codes: number[] = [9050, 9955, 3920]): ClientResponse {
  return {
    dialogId: "TEST-DIALOG",
    success: false,
    requiresTan: false,
    bankingInformationUpdated: false,
    bankAnswers: codes.map((code) => ({
      code,
      text: code === 9955 ? "Die Gerätebezeichnung ist unbekannt." : "Testantwort",
      params: code === 3920 ? ["923"] : [],
    })),
  };
}

const OK: ClientResponse = { ...response([]), success: true };

afterEach(() => vi.restoreAllMocks());

describe("Sparkasse KölnBonn: unbekanntes pushTAN-Medium", () => {
  it("wiederholt die Synchronisierung einmal mit Alle Geräte", async () => {
    const c = client();
    const sync = vi
      .spyOn(c, "synchronize")
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => {
        expect(c.config.tanMethodId).toBe(923);
        expect(c.config.tanMediaName).toBe("Alle Geräte");
        return OK;
      });
    expect((await fintsSynchronisieren(c)).art).toBe("ok");
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("holt fehlende BPD anonym und übernimmt nur die erlaubten Verfahren des angemeldeten Zugangs", async () => {
    const c = client(false);
    const sync = vi.spyOn(c, "synchronize").mockResolvedValueOnce(response()).mockResolvedValueOnce(OK);
    const discovery = vi.spyOn(FinTSClient.prototype, "synchronize").mockImplementation(async function (this: FinTSClient) {
      expect(this.config.userId).toBeUndefined();
      expect(this.config.pin).toBeUndefined();
      expect(this.config.customerId).toBeUndefined();
      expect(this.config.bankingUrl).toBe(URL);
      expect(this.config.productId).toBe(PRODUKT.id);
      this.config.bankingInformation = bankdaten();
      this.config.bankingInformation.bpd!.availableTanMethodIds = [912, 923];
      return OK;
    });
    expect((await fintsSynchronisieren(c)).art).toBe("ok");
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(c.config.bankingInformation.systemId).toBe("0");
    expect(c.config.bankingInformation.bpd?.availableTanMethodIds).toEqual([923]);
    expect(c.config.tanMediaName).toBe("Alle Geräte");
  });

  it("erhält die TAN-Anfrage und setzt danach denselben Dialog fort", async () => {
    const c = client();
    const challenge = {
      ...OK,
      requiresTan: true,
      tanReference: "TEST-REF",
      tanChallenge: "Bitte freigeben",
      bankAnswers: [{ code: 3955, text: "Freigabe in der App" }],
    };
    const sync = vi.spyOn(c, "synchronize").mockResolvedValueOnce(response()).mockResolvedValueOnce(challenge);
    const weiter = vi.spyOn(c, "synchronizeWithTan").mockResolvedValue(OK);
    expect(await fintsSynchronisieren(c)).toMatchObject({ art: "tan", anfrage: { referenz: "TEST-REF", entkoppelt: true } });
    expect((await fintsSynchronisieren(c, { referenz: "TEST-REF" })).art).toBe("ok");
    expect(weiter).toHaveBeenCalledWith("TEST-REF", undefined);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it.each([9931, 9942, 9010, 3931, 3938])("wiederholt nicht bei zusätzlichem PIN-, Sperr- oder anderem Fehler %i", async (code) => {
    const c = client();
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(response([9050, 9955, code]));
    await fintsSynchronisieren(c);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(c.config.tanMediaName).toBeUndefined();
  });

  it.each([
    [
      "andere BLZ",
      (c: FinTSClient) => {
        c.config.bankingInformation.bpd!.bankId = "12030000";
      },
    ],
    [
      "anderer Host",
      (c: FinTSClient) => {
        c.config.bankingInformation.bpd!.url = "https://andere-bank.example/fints";
      },
    ],
    [
      "anderes Verfahren",
      (c: FinTSClient) => {
        c.config.tanMethodId = 912;
      },
    ],
    [
      "bereits gewähltes Medium",
      (c: FinTSClient) => {
        c.config.tanMediaName = "Mein Handy";
      },
    ],
    [
      "Medium nicht zwingend",
      (c: FinTSClient) => {
        c.config.bankingInformation.bpd!.supportedTanMethods[0]!.tanMediaRequirement = 0;
      },
    ],
    [
      "Verfahren nicht erlaubt",
      (c: FinTSClient) => {
        c.config.bankingInformation.bpd!.availableTanMethodIds = [912];
      },
    ],
  ])("ändert nichts für %s", async (_name, aendern) => {
    const c = client();
    aendern(c);
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(response());
    await fintsSynchronisieren(c);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("beendet den Fallback nach einem erneut abgelehnten Versuch", async () => {
    const c = client();
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(response());
    expect((await fintsSynchronisieren(c)).art).toBe("abgelehnt");
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("respektiert eine aktuelle 3920, die das gespeicherte Verfahren nicht mehr erlaubt", async () => {
    const c = client();
    const abgelehnt = response();
    abgelehnt.bankAnswers.find((a) => a.code === 3920)!.params = ["912"];
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(abgelehnt);
    expect((await fintsSynchronisieren(c)).art).toBe("abgelehnt");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(c.config.tanMediaName).toBeUndefined();
  });

  it.each(["ohne Erlaubnis", "abgelehnt", "nicht erreichbar"])("sendet nach erfolgloser BPD-Ermittlung keine weitere PIN: %s", async (fall) => {
    const c = client(false);
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(response(fall === "ohne Erlaubnis" ? [9955] : undefined));
    const discovery = vi.spyOn(FinTSClient.prototype, "synchronize").mockImplementation(async () => {
      if (fall === "nicht erreichbar") throw new Error("Test-Ausfall");
      return response();
    });
    expect((await fintsSynchronisieren(c)).art).toBe("abgelehnt");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(discovery).toHaveBeenCalledTimes(fall === "ohne Erlaubnis" ? 0 : 1);
  });

  it.each(["erfolgreich", "TAN nötig", "anderer Fehler"])("wiederholt keine Antwort: %s", async (fall) => {
    const c = client();
    const antwort = fall === "erfolgreich" ? OK : fall === "TAN nötig" ? { ...OK, requiresTan: true } : response([9800]);
    const sync = vi.spyOn(c, "synchronize").mockResolvedValue(antwort);
    await fintsSynchronisieren(c);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(c.config.tanMediaName).toBeUndefined();
  });
});
