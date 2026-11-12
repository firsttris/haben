import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS } from "./regel.ts";

/*
 * befehl.ts gegen ein nachgebautes GitHub: Issue #7 mit Karte in „Geplant“, Zuweisungen und Kommentare im Speicher.
 * Jeder Lauf liest wie im Workflow ein eigenes Ereignis aus GITHUB_EVENT_PATH.
 */

const NUMMER = 7;

function nachgebautesGithub() {
  const stand = { zugewiesen: [] as string[], kommentare: [] as string[] };
  const antwort = (daten: unknown) => new Response(JSON.stringify(daten), { status: 200, headers: { "content-type": "application/json" } });
  const fetch = async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(eingabe));
    const was = `${init.method ?? "GET"} ${url.pathname}`;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (was === "POST /graphql") {
      const query: string = body.query;
      if (query.includes("projectV2(number")) {
        const options = STATUS.map((name) => ({ id: `option-${name}`, name }));
        return antwort({ data: { user: { projectV2: { id: "projekt", field: { id: "status", options } } } } });
      }
      if (query.includes("issueOrPullRequest")) {
        const projectItems = { nodes: [{ id: "karte", project: { id: "projekt" }, fieldValueByName: { name: "Geplant" } }] };
        return antwort({ data: { repository: { issueOrPullRequest: { __typename: "Issue", id: "issue", state: "OPEN", projectItems } } } });
      }
      if (query.includes("updateProjectV2ItemFieldValue")) return antwort({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "karte" } } } });
    }
    const issue = `/repos/o/r/issues/${NUMMER}`;
    const assignees = () => stand.zugewiesen.map((login) => ({ login }));
    if (was === `GET ${issue}`) return antwort({ number: NUMMER, state: "open", assignees: assignees() });
    if (was === `POST ${issue}/assignees`) {
      for (const login of body.assignees) if (!stand.zugewiesen.includes(login)) stand.zugewiesen.push(login);
      return antwort({ number: NUMMER, assignees: assignees() });
    }
    if (was === `POST ${issue}/comments`) {
      stand.kommentare.push(body.body);
      return antwort({ id: stand.kommentare.length });
    }
    throw new Error(`Unerwartete Anfrage: ${was}`);
  };
  return { stand, fetch };
}

describe("befehl.ts", () => {
  let ordner: string;
  let github: ReturnType<typeof nachgebautesGithub>;

  beforeEach(() => {
    ordner = mkdtempSync(join(tmpdir(), "board-befehl-"));
    github = nachgebautesGithub();
    vi.stubGlobal("fetch", github.fetch);
    vi.stubEnv("GITHUB_TOKEN", "github-token");
    vi.stubEnv("PROJECT_TOKEN", "project-token");
    vi.stubEnv("GITHUB_REPOSITORY", "o/r");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(ordner, { recursive: true, force: true });
  });

  /** Ein Lauf des Workflows mit dem Ereignis, das GitHub beim Kommentieren festgehalten hat */
  async function lauf(person: string, zugewiesenImEreignis: string[]) {
    const pfad = join(ordner, `${person}.json`);
    const ereignis = {
      action: "created",
      issue: { number: NUMMER, assignees: zugewiesenImEreignis.map((login) => ({ login })) },
      comment: { body: "/übernehmen", user: { login: person, type: "User" } },
    };
    writeFileSync(pfad, JSON.stringify(ereignis));
    vi.stubEnv("GITHUB_EVENT_PATH", pfad);
    vi.resetModules();
    await import("./befehl.ts");
  }

  it("weist bei zwei `/übernehmen` kurz nacheinander nur die erste Person zu", async () => {
    // Beide Ereignisse entstehen, bevor der erste Lauf zuweist; die Concurrency-Gruppe hält nur den zweiten Lauf an
    await lauf("alice", []);
    await lauf("bob", []);

    expect(github.stand.zugewiesen).toEqual(["alice"]);
    expect(github.stand.kommentare.at(-1)).toContain("@bob das Issue ist schon vergeben an @alice");
  });
});
