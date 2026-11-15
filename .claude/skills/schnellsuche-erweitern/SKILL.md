---
name: "schnellsuche-erweitern"
description: "Die Schnellsuche (Befehlspalette, Strg+K) von Haben um eine neue Gruppe erweitern oder eine Gruppe ändern, wenn ein neues Objekt oder Feld dazukommt: Suche im Modul, Eintrag in search-query.ts und search-plan.ts, Rechte der Steuerberatung, Index mit haben_unaccent, Betrag und Datum, Treffer mit Kontext und Status-Komponente, „Alle anzeigen“, Tests und docs/suche.md."
---

# Schnellsuche erweitern

Was die Schnellsuche findet und warum, steht in `docs/suche.md` und `docs/architektur.md` („Schnellsuche“); die Gestaltung in `DESIGN.md` („Befehlspalette“, „Status“). Hintergrund und entschiedene Punkte: #617.

## Neue Gruppe

1. **Suche im Modul:** in `server/modules/<modul>/search.ts` ein Teil `<objekt>Part(query, limit)` mit `searchPart(felder, (felder) => db.select(felder)….limit(limit + 1), (zeilen) => firstHits(zeilen, limit))` aus `server/db/search-parts.ts` und ein Treffertyp `<Objekt>Hit`. Der Teil kommt in die Suchfunktion des Moduls (etwa `searchBank`), die alle Teile des Moduls mit `runSearchParts(partsFor(groups, { … }))` in einer Abfrage ausführt; ein Modul ohne Suche bekommt eine. Export über das `index.ts` des Moduls, nie direkt aus der Datei.
2. **Server:** In `server/functions/search-query.ts` das Feld in `CommandPaletteResult` und `emptyResult`, bei einem neuen Modul den Eintrag in `SUCHE`; in `server/functions/search-plan.ts` die Gruppe in `PALETTE_GROUPS`, beim Modul in `PALETTE_MODULES` und, wenn sie Betrag oder Datum vergleicht, in `MIT_BETRAG` bzw. `MIT_DATUM`.
3. **Rechte:** Die Steuerberatung bekommt eine Gruppe nur, wenn sie die Seite dazu lesen darf (`STEUERBERATUNG` in `search-plan.ts`, `docs/steuerberatung.md`); Entwürfe nie. Personendaten der Mitarbeiter (Steuer-ID, SV-Nummer, IBAN, Geburtsdatum) und `ciphertext`-Spalten werden nie durchsucht; das IBAN-Ende von Kontakten und Bankumsätzen schon.
4. **Text:** `unaccentIlike(spalte, likePattern(query))` aus `lib/search.ts`, Rangfolge mit `numberRank`, wo es eine Nummer gibt.
5. **Index:** je durchsuchte Textspalte im Schema `index("<tabelle>_<spalte>_trgm_idx").using("gin", sql\`haben_unaccent(${t.spalte}) gin_trgm_ops\`)`, dann `bun run db:generate --name <name>`; nie eine bestehende Migration ändern, `drizzle/meta/` nicht von Hand. Für Betrag und Datum ein btree-Index, wenn die Tabelle groß werden kann.
6. **Betrag:** `parseEuroSearchRange` aus `@haben/core` und `amountIn` bzw. `amountInEitherSign` (Vorzeichen egal, etwa beim Bankumsatz). Welcher Betrag zählt, steht in `docs/suche.md` („Beträge“) und ist entschieden (#1038, `search-money.ts`); nicht ohne neue Entscheidung erweitern.
7. **Datum:** `parseDateSearch` aus `@haben/core`, `eq(spalte, datum)`.
8. **Treffer:** in `lib/befehlspalette-stufe2.ts` (Stufe-1-Gruppen in `lib/befehlspalette.ts`) mit Titel, Kontext in `meta` und Ziel. Bezeichnungen statt gespeicherter Schlüssel (`PAUSCHALE_LABEL`, `ELSTER_KIND_LABEL` …).
9. **Zustand:** Hat das Objekt einen Zustand, kommt er aus der Status-Komponente, die auch seine Seite nutzt (`TransactionStatus`, `VatStatus`, `RecurringInvoiceStatus` …): als `status` am Treffer (`PaletteStatus` in `lib/befehlspalette.ts`) und gezeigt in `LinkStatus` in `components/PaletteListbox.tsx`. Zeigt die Seite den Zustand nur inline, ihn erst als eigene Komponente herausziehen und auf der Seite nutzen. Ohne Zustand kein Status. Am Handy steht das Statuswort **immer am Ende** (`DESIGN.md`, Status › Anordnung).
10. **Alle anzeigen:** nur, wo die Liste `?suche=` kennt und dieselben Treffer zeigt; `to` und, wenn nötig, `moreSearch` an der Gruppe; eine neue Liste kommt in `MoreTarget` (`lib/befehlspalette.ts`).

## Tests

- **Postgres** in `server/functions/search.test.ts`: findet nach Text, Umlaut ohne Akzent, Betrag und Datum; nichts außerhalb des Bereichs; die Steuerberatung bekommt die Gruppe nicht (oder nur das Erlaubte); `EXPLAIN` mit vielen Zeilen zeigt den Index (`vacuum analyze` vorher), kein `Seq Scan` auf großen Tabellen, auch für die gemeinsame Abfrage des Moduls (`searchPartsQuery`); die Zahl der Abfragen je Eingabe steigt nur mit einem neuen Modul.
- **Vitest:** `search-plan.test.ts`, wenn sich die Auswahl der Gruppen ändert; `lib/befehlspalette.test.ts` für Kontext, Ziel und Status des Treffers.
- **Playwright** in `e2e/befehlspalette.spec.ts`, wenn sich die Bedienung ändert.

## Doku

`docs/suche.md`: Zeile in der Tabelle (gesucht wird in, der Treffer zeigt), bei der Steuerberatung der Absatz dazu; neue Indizes nur, wenn sich `docs/architektur.md` dadurch ändert. Sichtbare Änderung: Screenshots nach Skill `pr-screenshots`.
