import { describe, expect, it } from "vitest";
import type { Befund } from "./abruf.ts";
import { type GitHub, type Issue, issuesAbgleichen, issueText, issueTitel, LABEL, plane } from "./issues.ts";

const REPO = "firsttris/haben";
const pap: Befund = { schluessel: "pap-2027", titel: "Lohnsteuer-PAP 2027 ist erschienen", text: "Quelle: …" };
const eric: Befund = { schluessel: "eric", titel: "ERiC 45.1.5.0 ist verfügbar (Haben: 43.4.6.0)", text: "neu" };

/** Nachgestellte GitHub-API: hält Label und Issues im Speicher und protokolliert jeden schreibenden Aufruf */
function githubImSpeicher(start: { issues?: (Issue & { pull_request?: object })[]; label?: boolean } = {}) {
  const issues = [...(start.issues ?? [])];
  let label = start.label ?? true;
  const schreibend: { methode: string; pfad: string; daten: unknown }[] = [];
  const gh: GitHub = async (methode, pfad, daten) => {
    if (methode !== "GET") schreibend.push({ methode, pfad, daten });
    if (methode === "GET" && pfad === `/repos/${REPO}/labels/${LABEL}`)
      return label ? { status: 200, daten: { name: LABEL } } : { status: 404, daten: { message: "Not Found" } };
    if (methode === "POST" && pfad === `/repos/${REPO}/labels`) {
      label = true;
      return { status: 201, daten: daten };
    }
    if (methode === "GET" && pfad.startsWith(`/repos/${REPO}/issues?state=open&labels=${LABEL}`)) {
      const seite = Number(/[?&]page=(\d+)/.exec(pfad)?.[1]);
      return { status: 200, daten: issues.slice((seite - 1) * 100, seite * 100) };
    }
    if (methode === "POST" && pfad === `/repos/${REPO}/issues`) {
      const d = daten as { title: string; body: string };
      issues.push({ number: issues.length + 1, title: d.title, body: d.body });
      return { status: 201, daten: {} };
    }
    if (pfad.startsWith(`/repos/${REPO}/issues/`)) return { status: methode === "PATCH" ? 200 : 201, daten: {} };
    return { status: 500, daten: { message: `nicht nachgestellt: ${methode} ${pfad}` } };
  };
  return { gh, issues, schreibend };
}

describe("Issues", () => {
  it("legt Label und je Befund ein Issue mit Kennung im Titel an", async () => {
    const api = githubImSpeicher({ label: false });
    const aktionen = await issuesAbgleichen(api.gh, REPO, [pap, eric]);
    expect(aktionen.map((a) => a.art)).toEqual(["anlegen", "anlegen"]);
    expect(api.schreibend.map((s) => `${s.methode} ${s.pfad}`)).toEqual([
      `POST /repos/${REPO}/labels`,
      `POST /repos/${REPO}/issues`,
      `POST /repos/${REPO}/issues`,
    ]);
    expect(api.schreibend[1]?.daten).toEqual({
      title: "Lohnsteuer-PAP 2027 ist erschienen [jahreswerte:pap-2027]",
      body: issueText(pap),
      labels: ["jahreswerte"],
    });
  });

  it("legt beim nächsten Lauf kein Duplikat an", async () => {
    const api = githubImSpeicher();
    await issuesAbgleichen(api.gh, REPO, [pap]);
    const zweiter = await issuesAbgleichen(api.gh, REPO, [pap]);
    expect(zweiter).toEqual([{ art: "unveraendert", nummer: 1, befund: pap }]);
    expect(api.issues).toHaveLength(1);
    expect(api.schreibend).toHaveLength(1);
  });

  it("kommentiert ein offenes Issue, wenn sich der Befund geändert hat, und zieht Titel und Text nach", async () => {
    const api = githubImSpeicher({ issues: [{ number: 7, title: issueTitel(eric), body: issueText(eric) }] });
    const neuer = { ...eric, titel: "ERiC 45.2.0.0 ist verfügbar (Haben: 43.4.6.0)", text: "noch neuer" };
    expect(await issuesAbgleichen(api.gh, REPO, [neuer])).toEqual([{ art: "aktualisieren", nummer: 7, befund: neuer }]);
    expect(api.schreibend).toEqual([
      { methode: "POST", pfad: `/repos/${REPO}/issues/7/comments`, daten: { body: "Der Befund hat sich geändert:\n\nnoch neuer" } },
      { methode: "PATCH", pfad: `/repos/${REPO}/issues/7`, daten: { title: issueTitel(neuer), body: issueText(neuer) } },
    ]);
  });

  it("findet Issues auf späteren Seiten und übergeht Pull Requests mit gleicher Kennung", async () => {
    const fremde = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `anderes ${i}`, body: "" }));
    const pr = { number: 200, title: issueTitel(eric), body: issueText(eric), pull_request: {} };
    const api = githubImSpeicher({ issues: [...fremde, pr, { number: 101, title: issueTitel(pap), body: issueText(pap) }] });
    const aktionen = await issuesAbgleichen(api.gh, REPO, [pap, eric]);
    expect(aktionen.map((a) => a.art)).toEqual(["unveraendert", "anlegen"]);
  });

  it("ruft die API ohne Befunde gar nicht auf", async () => {
    const gh: GitHub = async () => {
      throw new Error("nicht erwartet");
    };
    expect(await issuesAbgleichen(gh, REPO, [])).toEqual([]);
  });

  it("bricht bei einem Fehler der API ab", async () => {
    const gh: GitHub = async (methode) =>
      methode === "GET" ? { status: 200, daten: [] } : { status: 403, daten: { message: "Resource not accessible by integration" } };
    await expect(issuesAbgleichen(gh, REPO, [pap])).rejects.toThrow("Issue anlegen fehlgeschlagen (HTTP 403)");
  });

  it("plant nach der Kennung, nicht nach dem übrigen Titel", () => {
    const offen: Issue[] = [{ number: 3, title: "Von Hand umbenannt [jahreswerte:pap-2027]", body: issueText(pap) }];
    expect(plane([pap], offen)).toEqual([{ art: "unveraendert", nummer: 3, befund: pap }]);
    expect(plane([{ ...pap, schluessel: "pap-2027-geaendert" }], offen)[0]?.art).toBe("anlegen");
  });
});
