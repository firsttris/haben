import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKE_ERINNERUNG } from "./uebernahme.ts";

/*
 * erinnerung.ts gegen ein nachgebautes GitHub: Issue #7 ist anna zugewiesen, die kein Collaborator ist. Die
 * Kommentare liefert GitHub in Seiten zu 100, die nächste Seite steht im Header `Link`.
 */

const NUMMER = 7;
const API = "https://api.github.com";
const tag = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 12));

type Kommentar = { user: { login: string; type: string }; created_at: string; body: string };

const kommentar = (login: string, am: Date, body = "Gute Idee"): Kommentar => ({
  user: { login, type: login.endsWith("[bot]") ? "Bot" : "User" },
  created_at: am.toISOString(),
  body,
});

function nachgebautesGithub(seiten: Kommentar[][]) {
  const geaendert: string[] = [];
  const antwort = (daten: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(daten), { status: 200, headers: { "content-type": "application/json", ...headers } });
  const fetch = async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(eingabe));
    const was = `${init.method ?? "GET"} ${url.pathname}`;
    if (was === "GET /repos/o/r/pulls") return antwort([]);
    if (was === "GET /repos/o/r/issues") return antwort(url.searchParams.get("page") === "1" ? [{ number: NUMMER, assignees: [{ login: "anna" }] }] : []);
    if (was === "GET /repos/o/r/collaborators/anna") return new Response(null, { status: 404 });
    if (was === `GET /repos/o/r/issues/${NUMMER}/events`) {
      return antwort([{ event: "assigned", created_at: tag(0).toISOString(), assignee: { login: "anna" } }]);
    }
    // GitHub schreibt die Links mit der Id des Repositorys statt seines Namens
    if (was === `GET /repos/o/r/issues/${NUMMER}/comments` || was === `GET /repositories/1/issues/${NUMMER}/comments`) {
      const seite = Number(url.searchParams.get("page") ?? "1");
      const naechste = new URL(`${API}/repositories/1/issues/${NUMMER}/comments`);
      naechste.search = url.search;
      naechste.searchParams.set("page", String(seite + 1));
      return antwort(seiten[seite - 1] ?? [], seite < seiten.length ? { link: `<${naechste}>; rel="next"` } : {});
    }
    if (init.method === "DELETE" || init.method === "POST") {
      geaendert.push(was);
      return antwort({});
    }
    throw new Error(`Unerwartete Anfrage: ${was}`);
  };
  return { geaendert, fetch };
}

describe("erinnerung.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("GITHUB_TOKEN", "github-token");
    vi.stubEnv("PROJECT_TOKEN", "");
    vi.stubEnv("GITHUB_REPOSITORY", "o/r");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sieht ein Lebenszeichen auf der zweiten Seite der Kommentare und gibt nicht frei", async () => {
    // Seite 1: 99 Kommentare anderer und die Erinnerung an Tag 14; Seite 2: anna antwortet an Tag 16
    const andere = Array.from({ length: 99 }, (_, i) => kommentar("bert", new Date(tag(1).getTime() + i * 60_000)));
    const erinnerung = kommentar("github-actions[bot]", tag(14), `${MARKE_ERINNERUNG}\n@anna bist du noch dran?`);
    const github = nachgebautesGithub([[...andere, erinnerung], [kommentar("anna", tag(16), "Bin dran!")]]);
    vi.stubGlobal("fetch", github.fetch);
    // Acht Tage nach der Erinnerung: ohne annas Antwort wäre die Freigabe fällig
    vi.setSystemTime(tag(22));

    vi.resetModules();
    await import("./erinnerung.ts");

    expect(github.geaendert).toEqual([]);
  });
});
