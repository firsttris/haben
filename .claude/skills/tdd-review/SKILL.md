---
name: "tdd-review"
description: "Unabhängiges Review eines Pull Requests in Haben: nur Fehler melden, die ein fehlschlagender Test belegt, Findings im PR posten, nach Red-Green fixen, bis CI grün ist; mergen nur als Maintainer oder Collaborator mit Zustimmung. Für jeden Pull Request mit Code vor dem Merge; ohne Code doku-pruefen."
---

# TDD-Review

Ein unabhängiger Reviewer prüft einen Pull Request und meldet **nur Fehler, die er mit einem fehlschlagenden Test beweisen kann**. Behauptungen ohne Test zählen nicht. Die Fehler werden nach Red-Green behoben; ist alles grün, mergt ein Maintainer oder mit dessen Zustimmung ein Collaborator. Der Ablauf ohne Claude steht in `docs/entwicklung.md` unter „Review“.

## 0. Wer reviewt?

Zeigt `git diff --name-only origin/main...<branch>` nur `*.md` und `mkdocs.yml`, gilt Skill `doku-pruefen` statt dieses Skills. Ändert der PR Code und Markdown, prüft derselbe Reviewer in derselben Runde die Markdown-Dateien nach `doku-pruefen`, Schritte 2 bis 6; diese Befunde brauchen keinen roten Test und stehen im selben Kommentar (Schritt 3).

Unabhängig ist, wer den Code nicht selbst geschrieben hat. Gemeint ist der Agent oder Mensch, nicht das Konto: Ein frischer Agent ohne den Verlauf der Entstehung ist unabhängig, auch wenn ihn der Autor gestartet hat (`docs/entwicklung.md`, Review, Punkt 1).

- **In dieser Session wurde am Code gearbeitet:** nicht selbst reviewen, sondern einen **separaten Subagenten** starten, der die Entstehung nicht gesehen hat. Ihm nur Repo, PR-Nummer, Branch, Basis-Branch und die Schritte 1–4 geben, keine eigene Einschätzung. Gibt es noch keinen PR, vorher Branch pushen und PR anlegen. Der Subagent arbeitet in einem eigenen Worktree auf dem Branch des PR und mit einer eigenen Compose-Instanz samt Test-Datenbank (Skill `checks`, Schritt 2: eigener Projektname und Ports), nie im Checkout oder in der `haben-dev`-Umgebung der Person; am Ende räumt er beides ab. Bei mehreren parallelen Reviews je eine eigene Instanz. Danach weiter mit Schritt 5.
- **Frische Session, nur ein PR genannt:** Diese Session ist unabhängig; direkt mit Schritt 1 beginnen.

## 1. Direkt reviewen

- Diff holen (`git fetch origin main <branch>`, `git diff origin/main...<branch>`) und **sofort** reviewen. Vorher keine Test-Suite laufen lassen.
- Mit `git merge-tree --write-tree origin/main <branch>` prüfen, ob der Branch noch konfliktfrei auf `main` passt.
- Gesucht werden echte Fehler: falsche Logik, Randfälle (null, leer, Grenzwerte, Vorzeichen, Gutschriften), Fehlerbehandlung, Race Conditions, Sicherheitslücken, Regressionen gegenüber dem bisherigen Verhalten. Auch die anderen Stellen ansehen, die die geänderten Funktionen oder Daten nutzen.
- Fachlich in Haben besonders: Buchungen in **SKR03 und SKR04**, **Ist und Soll**, **Einzelunternehmen und GmbH**; Abgleich Journal ↔ Voranmeldung/EÜR, E-Bilanz, DATEV-Export; GoBD-Sperren und Siegel; Geld in ganzen Cent. Hängt ein Detail an Steuerrecht oder einem Format, die Quelle nennen (`docs/entwicklung.md`, Konventionen, „Quellen statt Gedächtnis“).
- Keine Anmerkungen zu Stil, Namen oder Geschmack.

## 2. Jeden Verdacht mit einem Test beweisen

- Für jeden Verdacht einen neuen Test schreiben, der das erwartete Verhalten beschreibt, und nur diesen Test ausführen:
  - Fachlogik ohne Datenbank: Vitest neben dem Modul in `packages/*`.
  - Server mit Datenbank: Postgres-Test neben dem Modul in `apps/web/src/server/modules/`, mit `TEST_DATABASE_URL` (ohne die Variable wird er übersprungen und beweist nichts; ohne Bun im Dev-Container nach Skill `checks`).
  - Was ein Nutzer klickt: Playwright in `apps/web/e2e/`, nur wenn es nicht anders geht.
- **Nur ein Test, der auf dem Stand des PR rot ist, ist ein Finding.**
- Bleibt der Test grün oder lässt sich der Verdacht nicht testen, wird er verworfen (höchstens als Notiz unter „Nicht belegt“).

## 3. Findings in den PR posten

- Ein Kommentar im PR: je Finding Titel, Datei/Zeile, Testname, Ausgabe des roten Tests, kurze Erklärung; dazu die verworfenen Verdachte in je einem Satz.
- Keine Findings: das kurz im PR vermerken und weiter mit Schritt 5.
- Sprache Deutsch.

## 4. Fixen (Red → Green)

- Je Finding: Test committen, minimalen Fix, Test grün. Kleine Commits (`test: …`, `fix: …`, Beschreibung auf Deutsch).
- Bestehende Tests nie abschwächen oder löschen, Sperren und Siegel nie lockern, um grün zu werden.
- Fixes als neue Commits auf den Branch des Pull Requests, Commits von Beitragenden nie umschreiben; wie bei Forks und „Allow edits by maintainers“ vorzugehen ist, steht in `docs/entwicklung.md` unter „Review“, Schritt 4.
- **PR aus einem Fork, Session in der Cloud (claude.ai/code):** Die Session schreibt nur in die Repositories, die beim Start als Quelle gewählt wurden. Ein Fork heißt meist ebenfalls `haben`; neben `firsttris/haben` lässt er sich nicht nachträglich hinzufügen (gleicher Name, gleiches Verzeichnis), und `git push`, `add_repo` und das GitHub-Werkzeug lehnen ihn ab. Nicht durchprobieren und die Person nicht selbst pushen lassen, sondern sofort so:
  1. Die Fixes in dieser Session fertig machen und prüfen (Commits auf einer lokalen Kopie des PR-Branches, `git fetch origin pull/<nr>/head:pr-<nr>`).
  2. Mit `create_session` eine **Session mit dem Fork als einziger Quelle** starten: `source_url` `https://github.com/<owner>/haben`, `source_revision` der Branch des PR. Im Prompt: der Maintainer hat den Push angewiesen, der erwartete HEAD-SHA, die Änderung genau (Datei, alte und neue Zeilen, notfalls als Patch), die Prüfung (z. B. Biome), die Commit-Nachricht wörtlich, `git push origin HEAD:<branch-des-pr>` ohne Force und nicht auf einen anderen Branch, am Ende den SHA melden.
  3. Den Push prüfen: `git ls-remote origin refs/pull/<nr>/head` zeigt den neuen SHA. Danach weiter mit Schritt 5.
  - Lokal (Claude Code auf dem Rechner der Person) gibt es die Grenze nicht: Dort pusht git mit ihren Zugangsdaten, wenn „Allow edits by maintainers“ an ist.
- Dann gezielt prüfen, was der PR und die Fixes berühren. Die volle Suite läuft in der CI, lokal nicht noch einmal (Befehle und Umgebung: Skill `checks`):
  - immer `lint` und `typecheck`;
  - Vitest und Postgres-Tests nur für die neuen Tests und die geänderten Module (`bun --bun vitest run <pfade>`, Postgres mit `TEST_DATABASE_URL`);
  - Playwright nur, wenn die Oberfläche betroffen ist, und nur die passenden Spec-Dateien oder Tests (`bun run e2e <datei>`, `-g <name>`);
  - Doku-Build nur, wenn `docs/` geändert ist;
  - breiter nur, wenn die Änderung viele Stellen trifft (Schema und Migrationen, viel genutzte Funktionen in `packages/*`, globale Styles, `playwright.config.ts`, Abhängigkeiten): dann die Aufrufer mitprüfen.
- Im Abschlusskommentar nennen, was lokal lief und was übersprungen wurde.
- Auf den PR-Branch pushen.

## 5. Grün prüfen

- Die CI prüft die volle Suite; ohne grüne CI ist das Review nicht fertig. Auf Entwürfen läuft sie nicht: Dann ist der PR vor dem Merge auf „Ready for review“ zu setzen, nur auf Freigabe der Person.
- Die CI-Checks des PR abwarten. Bei roten Checks die Ursache beheben und erneut pushen; keinen Test überspringen, keinen leeren Commit, um CI neu zu starten.
- Abschlusskommentar im PR: welche Findings behoben sind, welche Tests neu sind, Stand der Checks.

## Wie viele Runden

- **Eine Runde, eine zweite nur nach Fixes** (Schritte 1–5 sind eine Runde). Findet Runde 1 keinen belegten Befund, ist das Review fertig. Hat sie Fixes am Code gebracht, prüft Runde 2 diese Fixes und den betroffenen Bereich: Jeder Fix ist neuer Code, den sonst niemand geprüft hat.
- **Eine Runde, ein Stand:** Codex oder ein anderes KI-Review zählt zur selben Runde und prüft denselben Stand; Befunde zusammenführen, dann gemeinsam beheben.
- **Weitere Runden nur nach einem schweren Befund** (roter Test und Sicherheit, falsche Buchung oder Steuer, GoBD oder Datenverlust). Sie prüfen nur den Fix und den betroffenen Bereich.
- **Höchstens vier Runden.** Danach noch ein schwerer Befund offen: nicht weiter fixen, nicht mergen, an den Maintainer zurückmelden.
- **Konstruierte Eingaben** (Daten, die in echten Antworten nicht vorkommen): notieren, nicht fixen; lohnt es sich, ein eigenes Issue vorschlagen. Ausnahme: Sicherheit.
- Die Regel steht in `docs/entwicklung.md` unter „Review“.

## 6. Merge (Maintainer oder Collaborator mit Zustimmung)

- Mergen darf, wer Maintainer von Haben ist und das ausdrücklich will, oder ein Collaborator mit Zustimmung des Maintainers. Wer sonst beiträgt, hört nach Schritt 5 auf.
- Vor dem Merge prüfen: alle Findings behoben oder nach „Wie viele Runden“ notiert, alle Checks grün auf dem aktuellen Stand, kein Konflikt mit `main`, Titel und Beschreibung passen zum Stand (sie werden der Squash-Commit auf `main`).
- Merge-Methode nach `docs/entwicklung.md`, „Review“, Schritt 6: immer **Squash** des Pull Requests selbst.
- **Nicht mergen**, wenn ein zu behebendes Finding offen ist, Checks rot bleiben oder der Fix eine fachliche Entscheidung braucht – dann zurückmelden und fragen.

## Abschlussbericht

Immer zurückmelden: PR-Link, Anzahl belegter Findings, was behoben wurde (Commits), Stand der Checks, ob gemergt wurde oder warum nicht.
