---
name: "schnellsuche-erweitern"
description: "Die Schnellsuche (Befehlspalette, Strg+K) von Haben um eine neue Gruppe erweitern oder eine Gruppe ändern, wenn ein neues Objekt oder Feld dazukommt: Suche im Modul, Eintrag in search-query.ts und search-plan.ts, Rechte der Steuerberatung, Index mit haben_unaccent, Betrag und Datum, Treffer mit Kontext und Status-Komponente, „Alle anzeigen“, Tests und docs/suche.md."
---

# Schnellsuche erweitern

Was die Schnellsuche findet und warum, steht in `docs/suche.md` und `docs/architektur.md` („Schnellsuche“); die Gestaltung in `DESIGN.md` („Befehlspalette“, „Status“). Hintergrund und entschiedene Punkte: #617.

## Neue Gruppe

1. **Suche im Modul:** `server/modules/<modul>/search.ts` mit `search<Objekt>(query, limit = 5): Promise<{ hits; more }>` und einem Treffertyp `<Objekt>Hit`; `limit + 1` lesen, `more` daraus. Export über das `index.ts` des Moduls, nie direkt aus der Datei.
2. **Server:** In `server/functions/search-query.ts` das Feld in `CommandPaletteResult`, `emptyResult` und `SUCHE` ergänzen; in `server/functions/search-plan.ts` die Gruppe in `PALETTE_GROUPS` und, wenn sie Betrag oder Datum vergleicht, in `MIT_BETRAG` bzw. `MIT_DATUM`.
3. **Rechte:** Die Steuerberatung bekommt eine Gruppe nur, wenn sie die Seite dazu lesen darf (`STEUERBERATUNG` in `search-plan.ts`, `docs/steuerberatung.md`); Entwürfe nie. Personendaten wie Steuer-ID, SV-Nummer, IBAN oder Geburtsdatum werden nie durchsucht, `ciphertext`-Spalten auch nicht.
4. **Text:** `unaccentIlike(spalte, likePattern(query))` aus `lib/search.ts`, Rangfolge mit `numberRank`, wo es eine Nummer gibt.
5. **Index:** je durchsuchte Textspalte im Schema `index("<tabelle>_<spalte>_trgm_idx").using("gin", sql\`haben_unaccent(${t.spalte}) gin_trgm_ops\`)`, dann `bun run db:generate --name <name>`; nie eine bestehende Migration ändern, `drizzle/meta/` nicht von Hand. Für Betrag und Datum ein btree-Index, wenn die Tabelle groß werden kann.
6. **Betrag:** `parseEuroSearchRange` aus `@haben/core` und `amountIn` bzw. `amountInEitherSign` (Vorzeichen egal, etwa beim Bankumsatz). Verglichen wird nur der Bruttobetrag bzw. der gezahlte Betrag, nie netto und nie der offene Rest einer Teilzahlung, und nie ungefähr: Das ist entschieden (#1038), nicht vergessen.
7. **Datum:** `parseDateSearch` aus `@haben/core`, `eq(spalte, datum)`.
8. **Treffer:** in `lib/befehlspalette-stufe2.ts` (Stufe-1-Gruppen in `lib/befehlspalette.ts`) mit Titel, Kontext in `meta` und Ziel. Bezeichnungen statt gespeicherter Schlüssel (`PAUSCHALE_LABEL`, `ELSTER_KIND_LABEL` …).
9. **Zustand:** Hat das Objekt einen Zustand, kommt er aus der Status-Komponente, die auch seine Seite nutzt (`TransactionStatus`, `VatStatus`, `RecurringInvoiceStatus` …): als `status` am Treffer (`PaletteStatus` in `lib/befehlspalette.ts`) und gezeigt in `LinkStatus` in `components/PaletteListbox.tsx`. Zeigt die Seite den Zustand nur inline, ihn erst als eigene Komponente herausziehen und auf der Seite nutzen. Ohne Zustand kein Status.
10. **Alle anzeigen:** nur, wo die Liste `?suche=` kennt und dieselben Treffer zeigt; `to` und, wenn nötig, `moreSearch` an der Gruppe.

## Tests

- **Postgres** in `server/functions/search.test.ts`: findet nach Text, Umlaut ohne Akzent, Betrag und Datum; nichts außerhalb des Bereichs; die Steuerberatung bekommt die Gruppe nicht (oder nur das Erlaubte); `EXPLAIN` mit vielen Zeilen zeigt den Index (`vacuum analyze` vorher), kein `Seq Scan` auf großen Tabellen.
- **Vitest:** `search-plan.test.ts`, wenn sich die Auswahl der Gruppen ändert; `lib/befehlspalette.test.ts` für Kontext, Ziel und Status des Treffers.
- **Playwright** in `e2e/befehlspalette.spec.ts`, wenn sich die Bedienung ändert.

## Doku

`docs/suche.md`: Zeile in der Tabelle (gesucht wird in, der Treffer zeigt), bei der Steuerberatung der Absatz dazu; neue Indizes nur, wenn sich `docs/architektur.md` dadurch ändert. Sichtbare Änderung: Screenshots nach Skill `pr-screenshots`.
