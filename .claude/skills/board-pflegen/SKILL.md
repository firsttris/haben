---
name: "board-pflegen"
description: "Project „Roadmap“ von Haben pflegen (https://github.com/users/firsttris/projects/2): neue Issues einordnen, Karten aufräumen, nach einem Release prüfen. Mit gh und gh api graphql. Vorschläge an den Maintainer, umsetzen erst nach seinem OK. Wenn neue Issues da sind, einmal pro Woche oder nach einem Release."
---

# Board pflegen

Die Planung von Haben steht im [Project „Roadmap“](https://github.com/users/firsttris/projects/2); die Regeln dazu in [`docs/entwicklung.md`](../../../docs/entwicklung.md) unter „Etwas übernehmen“ und „Branches, Titel und Commits“ (Vom Issue zum Release), die Grundsätze in [`docs/roadmap.md`](../../../docs/roadmap.md). Was der Workflow „Board“ (`scripts/board/`) selbst schiebt, macht dieser Skill nicht noch einmal.

## Voraussetzungen

- `gh` mit dem Scope `project`: `gh auth status` zeigt ihn, sonst `gh auth refresh -s project`.
- Schreibrecht am Project: Project → Settings → Manage access, Rolle Write. Collaborator am Repository zu sein reicht nicht.
- Ohne beides: nur lesen und Vorschläge als Liste an den Maintainer geben.

## Das Board

| Feld | Werte |
| --- | --- |
| Status | Später, Geplant, In Arbeit, Im nächsten Release, Erledigt |
| Aufwand | S, S–M, M, M–L, L |
| Bereich | Bank und Kasse, Belege, Rechnungen, Steuern, Buchhaltung, Lohn, Umzug, Oberfläche, Plattform |
| Hinweis | Freitext ohne Markdown: Frist, Vorbedingung, wer es übernimmt |

- **Rang** ist die Position in der Spalte, von oben nach unten. Es gibt keine Platznummer; in einer Ansicht keine Sortierung setzen, sonst ist der Rang nicht zu sehen.
- **Reihenfolge in „Geplant“:** zuerst Fehler bei Steuer und Buchung, dann kleine Wünsche aus dem Alltag, dann was Freiberuflern und kleinen GmbHs beim Buchen am meisten fehlt (`docs/roadmap.md`).
- **Eine Karte je Thema.** Gehören mehrere Issues zu einem Thema, stehen sie als eigene Karten direkt untereinander; Hinweis nur auf der ersten. Ein Thema ohne Issue ist ein Entwurf (Draft Item).
- **Nicht ins Board:** Fragen, Sammel-Issues, Interna (Renovate, CI), Themen unter „Bewusst nicht“.
- **`einstieg`:** Label für kleine, abgegrenzte Issues ohne Steuer- oder GoBD-Feinheiten, die niemand übernommen hat.

## Ablauf

### 1. Lesen

```sh
gh project item-list 2 --owner firsttris --limit 300 --format json > board.json
gh issue list --repo firsttris/haben --state open --limit 300 --json number,title,labels,assignees,createdAt,updatedAt > issues.json
```

Daraus ermitteln:
- offene Issues ohne Karte;
- Karten in „In Arbeit“ ohne offenen PR und ohne Kommentar seit 14 Tagen (`gh issue view <n> --json comments,updatedAt`, `gh pr list --search "<n> in:body"`);
- geschlossene Issues, deren Karte nicht in „Erledigt“ steht;
- Karten in „Im nächsten Release“, deren PR kein `Umgesetzt #…` hat: die schließt das Release nicht (`scripts/board/regel.ts`);
- Entwürfe, für die es inzwischen ein Issue gibt.

### 2. Vorschlagen

Eine Tabelle an den Maintainer, je Zeile: Issue, Titel, Vorschlag (Spalte, Position „nach #…“, Aufwand, Bereich, Hinweis, `einstieg` ja/nein) oder „nicht ins Board“, mit einem Satz Begründung. Eigene Abschnitte für die Funde aus Schritt 1. Die Rangfolge in „Geplant“ entscheidet der Maintainer.

Vorher am Code auf `origin/main` prüfen, ob ein Issue schon erledigt ist (`git log --oneline origin/main | grep "#<n>"`, Doku der Seite). Erledigtes ohne `Umgesetzt` schließt der Maintainer von Hand mit Hinweis auf das Release.

### 3. Umsetzen, nach OK

IDs einmal holen:

```sh
gh project view 2 --owner firsttris --format json --jq .id          # PROJECT_ID
gh project field-list 2 --owner firsttris --format json             # Feld- und Options-IDs
```

| Schritt | Befehl |
| --- | --- |
| Issue hinzufügen | `gh project item-add 2 --owner firsttris --url https://github.com/firsttris/haben/issues/<n> --format json --jq .id` |
| Entwurf anlegen | `gh project item-create 2 --owner firsttris --title "…" --body "…" --format json --jq .id` |
| Auswahlfeld setzen | `gh project item-edit --project-id $PROJECT_ID --id <item> --field-id <feld> --single-select-option-id <option>` |
| Text setzen | `gh project item-edit --project-id $PROJECT_ID --id <item> --field-id <feld> --text "…"` |
| Label setzen | `gh issue edit <n> --repo firsttris/haben --add-label einstieg` |

Position (das CLI kann es nicht): GraphQL, `afterId` ist die Karte darüber, ohne `afterId` ganz nach oben.

```sh
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID){updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' \
  -f p=$PROJECT_ID -f i=<item> -f a=<item-darüber>
```

Der Workflow „Item added to project“ setzt bei neuen Karten selbst einen Status, manchmal kurz nach dem eigenen Aufruf: Status zum Schluss noch einmal auslesen und bei Abweichung neu setzen.

### 4. Prüfen

`gh project item-list` erneut lesen und eine Tabelle je Spalte (Position, Karte, Aufwand, Bereich) gegen den Vorschlag vergleichen; Abweichungen korrigieren und melden.

## Grenzen

- Keine Issues schließen, kommentieren oder anlegen ohne Auftrag; Labels nur nach OK.
- Die Spalten nicht umbenennen: `scripts/board/regel.ts` und der Workflow „Board“ hängen an den Namen.
- Keine Karte zurückschieben, die der Workflow nach vorn gesetzt hat, außer der Maintainer will es.
- Nach einem Release: prüfen, dass der Job `issues-schliessen` lief und die Karten in „Erledigt“ stehen; das Release selbst ist Skill `release`.
