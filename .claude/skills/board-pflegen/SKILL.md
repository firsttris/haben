---
name: "board-pflegen"
description: "Project „Roadmap“ von Haben pflegen (https://github.com/users/firsttris/projects/2): offene Gespräche und Übernahme-Wünsche in Issues finden, neue Issues prüfen (wollen wir das, erledigt, Duplikat, genug Angaben) und einordnen, Karten aufräumen, nach einem Release prüfen; das Ergebnis bekommt jedes fremde Issue als kurzen Kommentar. Mit gh und gh api graphql. Vorschläge an den Maintainer, umsetzen und kommentieren erst nach seinem OK. Wenn neue Issues da sind, einmal pro Woche oder nach einem Release."
---

# Board pflegen

Die Planung von Haben steht im [Project „Roadmap“](https://github.com/users/firsttris/projects/2); die Regeln dazu in [`docs/entwicklung.md`](../../../docs/entwicklung.md) unter „Etwas übernehmen“ und „Branches, Titel und Commits“ (Vom Issue zum Release), die Grundsätze und „Bewusst nicht“ in [`docs/roadmap.md`](../../../docs/roadmap.md). Was der Workflow „Board“ (`scripts/board/`) selbst schiebt, macht dieser Skill nicht noch einmal. Montags läuft er automatisch im Workflow „Board-Pflege“: Dort liefert er statt der Tabelle in Schritt 3 eine Datei `plan.json` (Aufbau in `scripts/board/plan.ts`), und Schritt 4 bis 6 übernimmt nach `/ok` des Maintainers `scripts/board/plan-anwenden.ts`.

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
gh issue list --repo firsttris/haben --state open --limit 300 --json number,title,author,labels,assignees,comments,createdAt,updatedAt > issues.json
```

Daraus ermitteln:
- offene Issues ohne Karte (weiter mit Schritt 2);
- **offene Gespräche:** offene Issues, deren letzter Kommentar nicht vom Maintainer und nicht von einem Bot stammt (`jq '.[]|select((.comments|length)>0 and (.comments|last|.author.login)!="firsttris")' issues.json`). Jedes lesen und einordnen: **Übernahme** (jemand will die Karte bauen und ist nicht zugewiesen; meist hat der Workflow „Übernehmen“ dann mit Begründung abgelehnt, oder die Person hat ohne `/übernehmen` geschrieben: dann auf den Befehl hinweisen oder nach OK von Hand zuweisen), **Frage an den Maintainer**, **neue Angaben** (Anwendungsfall, Beispieldatei, Rückmeldung zu einem Release) oder **keine Antwort nötig** (Dank, Notiz eines Collaborators, Verweis auf ein anderes Issue);
- Karten in „In Arbeit“ ohne offenen PR und ohne Kommentar seit 14 Tagen (`gh issue view <n> --json comments,updatedAt`, `gh pr list --search "<n> in:body"`);
- geschlossene Issues, deren Karte nicht in „Erledigt“ steht;
- Karten in „Im nächsten Release“, deren PR kein `Umgesetzt #…` hat: die schließt das Release nicht (`scripts/board/regel.ts`);
- Entwürfe, für die es inzwischen ein Issue gibt.

### 2. Issues prüfen

Jedes offene Issue ohne Karte lesen, mit Kommentaren (`gh issue view <n> --json body,comments`), und genau ein Ergebnis bestimmen. Wie bei `beitrag-pruefen` braucht jedes Ergebnis einen Beleg: Commit oder PR, Abschnitt in `docs/roadmap.md`, Issue-Nummer, Satz aus der Quelle.

| Ergebnis | Wann | Beleg |
| --- | --- | --- |
| **Erledigt** | Auf `origin/main` schon umgesetzt | `git log --oneline origin/main \| grep "#<n>"`, `gh pr list --state all --search "<n> in:body"`, Doku der Seite; Release, in dem es kam |
| **Duplikat** | Thema steht schon in einem Issue oder Entwurf | Nummer bzw. Titel des Entwurfs; Neues aus diesem Issue nennen, damit es nicht verloren geht |
| **Nicht ins Board** | Unter „Bewusst nicht“, Frage, Sammel-Issue, Interna | Zeile in „Bewusst nicht“ oder die Art des Issues |
| **Rückfrage** | Angaben reichen nicht für Aufwand und Akzeptanzkriterien: kein Beispiel, kein Ablauf, unklar, was „fertig“ ist | Die eine oder zwei Fragen, die fehlen |
| **Aufnehmen** | Alles andere | Spalte, Position, Aufwand, Bereich, Hinweis, `einstieg` |

Bei `steuer`-Issues und Fehlern bei Buchung oder Steuer die fachliche Aussage an der Primärquelle prüfen, die das Issue nennt. Stimmt sie nicht oder ist sie unsicher, ist das eine Rückfrage, keine Karte.

### 3. Vorschlagen

Eine Tabelle an den Maintainer, je Zeile: Issue, Titel, Ergebnis aus Schritt 2, bei „Aufnehmen“ Spalte, Position „nach #…“, Aufwand, Bereich, Hinweis, `einstieg` ja/nein, dazu ein Satz Begründung und ob ein Kommentar kommt (Schritt 5). Eigene Abschnitte für die übrigen Funde aus Schritt 1. Die offenen Gespräche kommen als eigene Tabelle mit Antwortentwurf; **Übernahmen stehen ganz oben**, weil die Person laut „Etwas übernehmen“ auf die Zuweisung wartet. Dazu je Übernahme: bisherige PRs der Person (`gh pr list --state all --author <login>`), wie viele Karten sie schon hat, offene Fragen in ihrer Skizze. Was nur der Maintainer entscheiden kann (Registrierungen, Verträge, Rechtsfragen, Reihenfolge), steht als Frage an ihn in der Tabelle, nicht als Antwortentwurf. Die Rangfolge in „Geplant“ entscheidet der Maintainer. Erledigtes ohne `Umgesetzt` schließt der Maintainer von Hand mit Hinweis auf das Release.

### 4. Umsetzen, nach OK

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
| Zuweisen (Übernahme) | `gh issue edit <n> --repo firsttris/haben --add-assignee <login>`; der Workflow „Board“ schiebt die Karte nach „In Arbeit“ |

Position (das CLI kann es nicht): GraphQL, `afterId` ist die Karte darüber, ohne `afterId` ganz nach oben.

```sh
gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID){updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' \
  -f p=$PROJECT_ID -f i=<item> -f a=<item-darüber>
```

Der Workflow „Item added to project“ setzt bei neuen Karten selbst einen Status, manchmal kurz nach dem eigenen Aufruf: Status zum Schluss noch einmal auslesen und bei Abweichung neu setzen. Nach Zuweisungen ebenso prüfen, dass die Karte in „In Arbeit“ steht.

### 5. Kommentieren, nach OK

Wer ein Issue schreibt, soll wissen, dass es gelesen und wie es eingeordnet wurde. Das OK des Maintainers zur Tabelle aus Schritt 3 ist der Auftrag dafür.

- Ein Kommentar je geprüftem Issue, das noch keinen Kommentar zur Einordnung hat, auch bei Issues des Maintainers oder seiner Agenten: Wer das Issue später liest, sieht so, wo es steht. Bei eigenen Issues ohne „Danke!“.
- Kurz, auf Deutsch, Du-Form; kein Termin und kein Versprechen; die Begründung aus Schritt 2 mit Link. Kein Hinweis auf das Werkzeug: Der Text ist eine Mitteilung des Maintainers.
- `gh issue comment <n> --repo firsttris/haben --body-file <datei>`

| Ergebnis | Text (Vorlage, anpassen) |
| --- | --- |
| Aufnehmen | Danke! Ist jetzt im [Board](https://github.com/users/firsttris/projects/2) unter „Geplant“ (bzw. „Später“), Bereich Belege. Die Reihenfolge in der Spalte ist die Priorität. Wer es übernehmen möchte: [Etwas übernehmen](https://haben.app/entwicklung.html#etwas-übernehmen). Bei `einstieg` zusätzlich: Gut für den Einstieg geeignet. |
| Rückfrage | Danke! Damit wir es einordnen können, fehlt noch: … Sobald das da ist, kommt es ins [Board](https://github.com/users/firsttris/projects/2). |
| Duplikat | Danke! Das Thema steht schon in #… (bzw. im Entwurf „…“ im [Board](https://github.com/users/firsttris/projects/2)). Was hier neu ist (…), ist dort vermerkt. |
| Nicht ins Board | Danke! Das planen wir nicht: [Bewusst nicht](https://haben.app/roadmap.html#bewusst-nicht), Zeile „…“. Kurz der Grund … |
| Erledigt | Danke! Das gibt es seit v… ([Release](https://github.com/firsttris/haben/releases/tag/v…), PR #…). |

Antworten in offenen Gesprächen (Schritt 1) gehen genauso nach OK, mit dem freigegebenen Entwurf. Bei einer Übernahme: @-Erwähnung, „gehört dir“, Umfang in einem Satz (bei einer Skizze: „Die Skizze passt so“ oder was abweicht), Hinweis auf „In Arbeit“. Hat die Person schon mehrere Karten, dazuschreiben, dass sie nacheinander gern gesehen sind.

Schließen und Labels außer `einstieg` bleiben beim Maintainer.

### 6. Prüfen

`gh project item-list` erneut lesen und eine Tabelle je Spalte (Position, Karte, Aufwand, Bereich) gegen den Vorschlag vergleichen; Abweichungen korrigieren und melden. Dazu die Liste der geschriebenen Kommentare mit Link.

## Grenzen

- Kommentare nur die aus Schritt 5 und nur nach OK; zuweisen nur nach OK; Issues schließen oder anlegen nur auf Auftrag; Labels nur nach OK.
- Die Spalten nicht umbenennen: `scripts/board/regel.ts` und der Workflow „Board“ hängen an den Namen.
- Keine Karte zurückschieben, die der Workflow nach vorn gesetzt hat, außer der Maintainer will es.
- Nach einem Release: prüfen, dass der Job `issues-schliessen` lief und die Karten in „Erledigt“ stehen; das Release selbst ist Skill `release`.
