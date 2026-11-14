import { beforeEach, describe, expect, it, vi } from "vitest";

// Die Module selbst testen ihre Tests; hier zählt nur, wer auf wen wartet
const jobs = vi.hoisted(() => ({
  runDueFileCheck: vi.fn(),
  runDuePruefwertMail: vi.fn(),
  runDueBankSyncs: vi.fn(),
  runDueInboxFetch: vi.fn(),
}));

vi.mock("./modules/auswertungen/index.ts", () => ({ runDueFileCheck: jobs.runDueFileCheck }));
vi.mock("./modules/bank/index.ts", () => ({ runDueBankSyncs: jobs.runDueBankSyncs }));
vi.mock("./modules/elster/index.ts", () => ({ elsterClient: vi.fn(), elsterMode: () => "simuliert" }));
vi.mock("./env.ts", () => ({ env: () => ({}) }));
vi.mock("./modules/belege/index.ts", () => ({
  applyPublishedRates: vi.fn(async () => 0),
  runDueDauerbelege: vi.fn(async () => ({ created: 0, errors: [] })),
  runDueInboxFetch: jobs.runDueInboxFetch,
}));
vi.mock("./modules/stammdaten/index.ts", () => ({ runDueExchangeRates: vi.fn(async () => null) }));
vi.mock("./modules/mail/index.ts", () => ({ runDueFristenMails: vi.fn(async () => null), runDuePruefwertMail: jobs.runDuePruefwertMail }));
vi.mock("./modules/finanzamt/index.ts", () => ({ runDuePostfachFetch: vi.fn(async () => null) }));
vi.mock("./modules/rechnungen/index.ts", () => ({
  applyPublishedRatesToDrafts: vi.fn(async () => 0),
  runDueBaseRate: vi.fn(async () => null),
  runDueRecurring: vi.fn(async () => ({ created: 0, finalized: 0, mailed: 0, errors: [] })),
}));
vi.mock("./modules/stores/index.ts", () => ({ runDueStoreSyncs: vi.fn(async () => ({ synced: 0, added: 0, errors: [] })) }));

/** Eine Vollprüfung, die erst endet, wenn der Test es sagt; so lange wie bei einem großen Bestand auf einem NAS */
function langeVollpruefung() {
  let beenden = () => {};
  jobs.runDueFileCheck.mockImplementation(
    () =>
      new Promise((resolve) => {
        beenden = () => resolve({ at: new Date(), files: 1, problemCount: 0, problems: [] });
      }),
  );
  return () => beenden();
}

describe("Scheduler", () => {
  let scheduler: typeof import("./scheduler.ts");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    jobs.runDuePruefwertMail.mockResolvedValue(null);
    jobs.runDueBankSyncs.mockResolvedValue({ synced: 0, added: 0, errors: [] });
    jobs.runDueInboxFetch.mockResolvedValue(null);
    scheduler = await import("./scheduler.ts");
  });

  it("hält Kontoabruf und Postfach des nächsten Laufs nicht auf, solange die Vollprüfung der Dateien läuft", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    // Eine Stunde später, die Vollprüfung liest noch
    await scheduler.runScheduledJobs();
    expect(jobs.runDueBankSyncs).toHaveBeenCalledTimes(2);
    expect(jobs.runDueInboxFetch).toHaveBeenCalledTimes(2);
    beenden();
  });

  it("startet keine zweite Vollprüfung, solange eine läuft", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    await scheduler.runScheduledJobs();
    expect(jobs.runDueFileCheck).toHaveBeenCalledOnce();
    beenden();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });

  it("sendet die Prüfwert-Mail erst nach der Vollprüfung, damit sie deren Stand nennt", async () => {
    const beenden = langeVollpruefung();
    // Nicht abwarten: Vor der Änderung endete dieser Lauf erst mit der Vollprüfung
    void scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDueFileCheck).toHaveBeenCalledOnce());
    expect(jobs.runDuePruefwertMail).not.toHaveBeenCalled();
    beenden();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });

  it("sendet die Prüfwert-Mail auch, wenn die Vollprüfung scheitert", async () => {
    jobs.runDueFileCheck.mockRejectedValue(new Error("Volume nicht eingehängt"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await scheduler.runScheduledJobs();
    await vi.waitFor(() => expect(jobs.runDuePruefwertMail).toHaveBeenCalledOnce());
  });
});
