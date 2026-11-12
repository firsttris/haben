import type { Status } from "./regel.ts";

/*
 * Zugriff auf GitHub für das Board: GraphQL für das Project (Token PROJECT_TOKEN, klassisches Token mit Scope
 * `project`, weil GITHUB_TOKEN ein Project eines persönlichen Accounts nicht erreicht) und REST für Issues.
 */

export const PROJECT = { owner: "firsttris", number: 2 };

const API = "https://api.github.com";

async function anfrage<T>(token: string, pfad: string, init: RequestInit = {}): Promise<T> {
  const antwort = await fetch(`${API}${pfad}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "haben-board",
    },
  });
  if (!antwort.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${pfad}: ${antwort.status} ${await antwort.text()}`);
  return (await antwort.json()) as T;
}

export async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const antwort = await anfrage<{ data: T; errors?: { message: string }[] }>(token, "/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (antwort.errors?.length) throw new Error(`GraphQL: ${antwort.errors.map((fehler) => fehler.message).join("; ")}`);
  return antwort.data;
}

export type Projekt = { id: string; statusFeld: string; optionen: Map<string, string> };

/** Project, Status-Feld und seine Optionen; fehlt eine Spalte, ist das Board anders benannt als in regel.ts */
export async function projekt(token: string, status: readonly Status[]): Promise<Projekt> {
  const daten = await graphql<{
    user: { projectV2: { id: string; field: { id: string; options: { id: string; name: string }[] } | null } };
  }>(
    token,
    `query($owner: String!, $number: Int!) {
      user(login: $owner) { projectV2(number: $number) { id
        field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } }`,
    PROJECT,
  );
  const { id, field } = daten.user.projectV2;
  if (!field) throw new Error("Das Project hat kein Feld „Status“.");
  const optionen = new Map(field.options.map((option) => [option.name, option.id]));
  const fehlend = status.filter((name) => !optionen.has(name));
  if (fehlend.length > 0) throw new Error(`Im Feld „Status“ fehlen die Spalten: ${fehlend.join(", ")}`);
  return { id, statusFeld: field.id, optionen };
}

export type Karte = { issueId: string; offen: boolean; istPr: boolean; itemId: string | null; status: string | null };

/** Issue mit seiner Karte in diesem Project, falls es eine gibt */
export async function karte(token: string, repo: string, nummer: number, projektId: string): Promise<Karte> {
  const [owner, name] = repo.split("/");
  const daten = await graphql<{
    repository: {
      issueOrPullRequest: {
        __typename: string;
        id: string;
        state: string;
        projectItems?: { nodes: { id: string; project: { id: string }; fieldValueByName: { name: string } | null }[] };
      } | null;
    };
  }>(
    token,
    `query($owner: String!, $name: String!, $nummer: Int!) {
      repository(owner: $owner, name: $name) { issueOrPullRequest(number: $nummer) {
        __typename
        ... on Issue { id state projectItems(first: 20) { nodes { id project { id }
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }
        ... on PullRequest { id state } } } }`,
    { owner, name, nummer },
  );
  const issue = daten.repository.issueOrPullRequest;
  if (!issue) throw new Error(`#${nummer} gibt es in ${repo} nicht.`);
  const item = issue.projectItems?.nodes.find((knoten) => knoten.project.id === projektId);
  return {
    issueId: issue.id,
    offen: issue.state === "OPEN",
    istPr: issue.__typename === "PullRequest",
    itemId: item?.id ?? null,
    status: item?.fieldValueByName?.name ?? null,
  };
}

export async function hinzufuegen(token: string, projektId: string, issueId: string): Promise<string> {
  const daten = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    token,
    `mutation($projekt: ID!, $inhalt: ID!) {
      addProjectV2ItemById(input: { projectId: $projekt, contentId: $inhalt }) { item { id } } }`,
    { projekt: projektId, inhalt: issueId },
  );
  return daten.addProjectV2ItemById.item.id;
}

export async function statusSetzen(token: string, projekt: Projekt, itemId: string, status: Status): Promise<void> {
  await graphql(
    token,
    `mutation($projekt: ID!, $item: ID!, $feld: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: { projectId: $projekt, itemId: $item, fieldId: $feld,
        value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }`,
    { projekt: projekt.id, item: itemId, feld: projekt.statusFeld, option: projekt.optionen.get(status) },
  );
}

export async function statusLesen(token: string, itemId: string): Promise<string | null> {
  const daten = await graphql<{
    node: { fieldValueByName: { name: string } | null } | null;
  }>(
    token,
    `query($item: ID!) { node(id: $item) { ... on ProjectV2Item {
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }`,
    { item: itemId },
  );
  return daten.node?.fieldValueByName?.name ?? null;
}

/** REST für Issues mit GITHUB_TOKEN: Kommentar schreiben und als erledigt schließen */
export async function issueLesen(token: string, repo: string, nummer: number) {
  return anfrage<{ state: string; pull_request?: unknown }>(token, `/repos/${repo}/issues/${nummer}`);
}

export async function kommentieren(token: string, repo: string, nummer: number, text: string): Promise<void> {
  await anfrage(token, `/repos/${repo}/issues/${nummer}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
}

export async function schliessen(token: string, repo: string, nummer: number): Promise<void> {
  await anfrage(token, `/repos/${repo}/issues/${nummer}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
}

/* Übernehmen und Freigeben (scripts/board/befehl.ts, erinnerung.ts), REST mit GITHUB_TOKEN */

type Person = { login: string; type?: string };

/** Zuweisungen, wie sie jetzt sind; die im Ereignis sind beim Lauf womöglich schon überholt */
export async function zugewiesenLesen(token: string, repo: string, nummer: number): Promise<string[]> {
  const issue = await anfrage<{ assignees: Person[] }>(token, `/repos/${repo}/issues/${nummer}`);
  return issue.assignees.map((p) => p.login);
}

export async function zuweisen(token: string, repo: string, nummer: number, person: string): Promise<string[]> {
  const issue = await anfrage<{ assignees: Person[] }>(token, `/repos/${repo}/issues/${nummer}/assignees`, {
    method: "POST",
    body: JSON.stringify({ assignees: [person] }),
  });
  return issue.assignees.map((p) => p.login);
}

export async function zuweisungAufheben(token: string, repo: string, nummer: number, personen: string[]): Promise<void> {
  await anfrage(token, `/repos/${repo}/issues/${nummer}/assignees`, { method: "DELETE", body: JSON.stringify({ assignees: personen }) });
}

/** Collaborator des Repositorys (Schreibrecht); im Zweifel nein */
export async function istCollaborator(token: string, repo: string, person: string): Promise<boolean> {
  const antwort = await fetch(`${API}/repos/${repo}/collaborators/${person}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "haben-board" },
  });
  return antwort.status === 204;
}

export type IssueMitZuweisung = { number: number; assignees: string[] };

/** Offene Issues mit mindestens einer Zuweisung, ohne Pull Requests */
export async function zugewieseneIssues(token: string, repo: string): Promise<IssueMitZuweisung[]> {
  const liste: IssueMitZuweisung[] = [];
  for (let seite = 1; ; seite++) {
    const teil = await anfrage<{ number: number; assignees: Person[]; pull_request?: unknown }[]>(
      token,
      `/repos/${repo}/issues?state=open&assignee=*&per_page=100&page=${seite}`,
    );
    liste.push(...teil.filter((i) => !i.pull_request).map((i) => ({ number: i.number, assignees: i.assignees.map((p) => p.login) })));
    if (teil.length < 100) return liste;
  }
}

/** Zeitpunkt der letzten Zuweisung an eine der Personen */
export async function zugewiesenAm(token: string, repo: string, nummer: number, personen: string[]): Promise<Date | null> {
  const ereignisse = await anfrage<{ event: string; created_at: string; assignee?: Person }[]>(token, `/repos/${repo}/issues/${nummer}/events?per_page=100`);
  const daten = ereignisse.filter((e) => e.event === "assigned" && e.assignee && personen.includes(e.assignee.login)).map((e) => new Date(e.created_at));
  return daten.length > 0 ? new Date(Math.max(...daten.map((d) => d.getTime()))) : null;
}

export async function kommentareSeit(token: string, repo: string, nummer: number, seit: Date) {
  const liste = await anfrage<{ user: Person; created_at: string; body: string }[]>(
    token,
    `/repos/${repo}/issues/${nummer}/comments?since=${seit.toISOString()}&per_page=100`,
  );
  return liste.map((k) => ({ person: k.user.login, bot: k.user.type === "Bot", am: new Date(k.created_at), text: k.body }));
}

/** Beschreibungen der offenen Pull Requests */
export async function offenePrs(token: string, repo: string): Promise<string[]> {
  const liste = await anfrage<{ body: string | null }[]>(token, `/repos/${repo}/pulls?state=open&per_page=100`);
  return liste.map((pr) => pr.body ?? "");
}
