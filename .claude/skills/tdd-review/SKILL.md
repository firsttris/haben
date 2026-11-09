---
name: "tdd-review"
description: "Unabhängiges Review eines Pull Requests in Haben: nur Fehler melden, die ein fehlschlagender Test belegt, Findings im PR posten, nach Red-Green fixen, bis CI grün ist; mergen nur als Maintainer. Für jeden Pull Request vor dem Merge."
---

# TDD-Review

Ein unabhängiger Reviewer prüft einen Pull Request und meldet **nur Fehler, die er mit einem fehlschlagenden Test beweisen kann**. Behauptungen ohne Test zählen nicht. Die Fehler werden nach Red-Green behoben; ist alles grün, mergt ein Maintainer. Der Ablauf ohne Claude steht in `docs/entwicklung.md` unter „Review“.

## 0. Wer reviewt?

Unabhängig ist, wer den Code nicht selbst geschrieben hat.

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

## 6. Merge (nur Maintainer)

- Mergen darf nur, wer Maintainer von Haben ist und das ausdrücklich will. Wer beiträgt, hört nach Schritt 5 auf.
- Vor dem Merge prüfen: alle Findings behoben, alle Checks grün auf dem aktuellen Stand, kein Konflikt mit `main`.
- Merge-Methode nach `docs/entwicklung.md`, „Review“, Schritt 6: immer **Squash** des Pull Requests selbst.
- **Nicht mergen**, wenn ein Finding offen ist, Checks rot bleiben oder der Fix eine fachliche Entscheidung braucht – dann zurückmelden und fragen.

## Abschlussbericht

Immer zurückmelden: PR-Link, Anzahl belegter Findings, was behoben wurde (Commits), Stand der Checks, ob gemergt wurde oder warum nicht.
