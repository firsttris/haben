---
name: "jahreswerte"
description: "Amtliche Jahreswerte in Haben nachziehen: Lohnsteuer-PAP des BMF, Rechengrößen und Beitragssätze der Sozialversicherung, Taxonomie der E-Bilanz, neue ERiC-Version, geänderte Normen des Gesetzeswächters und Stand von SKR03/SKR04. Wenn der Workflow „Jahreswerte prüfen“ ein Issue mit dem Label jahreswerte geöffnet hat oder ein Jahreswechsel-Test fehlschlägt."
---

# Jahreswerte nachziehen

Was der Workflow „Jahreswerte prüfen“ beobachtet und warum, steht in `docs/entwicklung.md` unter „Jahreswerte“; die Kennung im Titel des Issues (`[jahreswerte:pap-2027]`) sagt, welcher Abschnitt hier gilt. Jeder Wert kommt mit Primärquelle in Code und Commit-Nachricht (`docs/entwicklung.md`, Konventionen, „Quellen statt Gedächtnis“); was sich nicht belegen lässt, bleibt offen und das Jahr wird nicht freigegeben. Danach weiter nach Skill `beitrag`; der Pull Request ist fachlich heikel (`beitrag-pruefen`, Schritt 2).

## Lohnsteuer: PAP

Befunde `pap-<Jahr>`, `pap-<Jahr>-geaendert`, `est-tarif-<Jahr>`. Code in `packages/core/src/lohnsteuer/`.

1. Das PAP-XML vom [BMF-Steuerrechner](https://www.bmf-steuerrechner.de/) laden (`/javax.faces.resource/daten/xmls/Lohnsteuer<Jahr>.xml.xhtml`) und unverändert als `Lohnsteuer<Jahr>.xml` neben `pap.ts` legen.
2. Mit dem XML des Vorjahres vergleichen (`diff`). Ändern sich nur Zahlen, reicht `pap-<Jahr>.ts` nach dem Muster von `pap-2026.ts` mit Version, Stand und SHA-256 der Datei. Ändert sich der Ablauf einer Methode, die `pap.ts` überträgt (MPARA, MRE4JL, MRE4ABZ, MBERECH, MZTABFB, MLSTJAHR, UPEVP, MVSPKVPV, MVSPHB, UPMLST, MST5_6, UP5_6, UPTAB, MSOLZ, UPANTEIL), bekommt das neue Jahr eine eigene Übertragung; die alte bleibt für Korrekturen früherer Jahre.
3. Das Jahr in `PAP_JAHRE` in `index.ts` eintragen, Test nach dem Muster von `pap-2026.test.ts`, der jeden Wert mit dem XML abgleicht.
4. Prüffälle von der externen Schnittstelle des BMF-Steuerrechners (`/interface/<Jahr>Version1.xhtml?code=LSt<Jahr>ext`) abrufen, mindestens Steuerklassen I bis VI in allen Lohnzahlungszeiträumen, mit Kindern, privat versichert und ohne Rentenversicherungspflicht, als `packages/core/test-fixtures/lohnsteuer/bmf-<Jahr>.json`.
5. Den Tarif in `TARIFE` in `packages/core/src/income-tax.ts` ergänzen; `pap.test.ts` vergleicht ihn mit UPTAB.

## Sozialversicherung

Befund `sv-<Jahr>`. Code in `packages/core/src/sozialversicherung/`.

1. Die Werte sammeln, jeden mit Quelle: Sozialversicherungsrechengrößen-Verordnung (BBG KV/PV und RV/AV), Beitragssatz der Rentenversicherung, durchschnittlicher Zusatzbeitrag (BMG, Bundesanzeiger), Geringfügigkeitsgrenze und Faktor F (BMAS, Bundesanzeiger), Pflege- und Arbeitslosenversicherung, Insolvenzgeldumlage, Pauschalen und Umlagen der Minijob-Zentrale. Gesetze bei gesetze-im-internet.de, Bekanntmachungen im Bundesanzeiger, keine Ratgeber.
2. In `werte.ts` `SV_<Jahr>` nach dem Muster von `SV_2026` anlegen, mit Quelle je Wert, und in `SV_JAHRE` in `index.ts` eintragen. `werte.test.ts` prüft Quellen, Faktor F und den Abgleich mit dem PAP desselben Jahres.
3. Beispielrechnungen des Jahres als Tests (Beratungsblatt der TK zum Übergangsbereich, Häufige Fragen der Minijob-Zentrale), mit Quelle und Link am Erwartungswert.
4. Ändert sich eine Regel (Formel des Übergangsbereichs, Rundung, Pauschalen), bekommt das neue Jahr eine eigene Rechnung; die alte bleibt.

## ERiC heben

Befunde `eric`, `eric-<Version>-entfernt`.

1. Pakete unter `https://download.elster.de/download/eric/eric_<Hauptversion>/ERiC-<Version>-Linux-x86_64.jar`, die Dokumentation daneben als `ERiC-<Version>-Dokumentation.zip`. Ein `.x.1` im Herbst ist BETA (Senden nur mit Testmerker).
2. Neben dem bisherigen installieren: `ERIC_DIR=/var/tmp/eric-<Version> bun packages/elster/src/install-cli.ts --lizenz-akzeptiert <Version>`.
3. In der Dokumentation `ERiC-Releasenotes.pdf`, `Datenartversionmatrix.ods` und die Schemas unter `Datenarten/` lesen; `include/` mit der alten Version vergleichen (`diff -r`). Entfallene Datenart-Versionen und geänderte Signaturen in `packages/elster` anpassen, neue Jahre in `KAPESTA_JAHRE`, `LSTA_JAHRE`, `GEWST_JAHRE`, `KST_JAHRE`, `EBILANZ_TAXONOMIEN`, `LSTB_SCHNITTSTELLEN`. `lstb.test.ts` prüft die Nutzdaten von ElsterLohn gegen die Schemas, wenn `ERIC_DOKU` auf `Dokumentation` des entpackten Pakets zeigt (braucht `java`).
4. Die Tests mit dem neuen ERiC laufen lassen (`docs/entwicklung.md`, „Tests mit echtem ERiC“), auch die neuen Jahre in `eric-echt.test.ts`, und mit dem alten gegenprüfen.
5. `DEFAULT_ERIC_VERSION` in `packages/elster/src/install.ts` nur auf eine für Echtfälle freigegebene Version heben, nach einer geglückten Testübermittlung (die macht der Maintainer), und die Tabelle in `docs/einrichtung.md` („Welche ERiC-Version“) nachziehen.

## Taxonomie der E-Bilanz

Kommt jährlich zum 1. April, bekannt im Juni, mit ERiC (Befund `eric`). Der Auszug in `packages/elster/src/ebilanz/taxonomie-<Version>.json` hält je Position Pflichtgrad, Summe mit Gewicht, Soll/Haben und Periodentyp.

1. Herunterladen von esteuer.de. Der Server liefert ein falsches Zwischenzertifikat; das richtige über die AIA-Adresse holen (`openssl x509 -noout -text`, „CA Issuers“), die TLS-Prüfung bleibt an:

   ```sh
   curl -sS -o r46.crt http://secure.globalsign.com/cacert/gsgccr46dvtlsca2025.crt
   openssl x509 -inform DER -in r46.crt -out r46.pem
   cat /etc/ssl/certs/ca-certificates.crt r46.pem > ca-esteuer.pem
   curl -sS --cacert ca-esteuer.pem -O https://www.esteuer.de/download/taxonomie_20260615/germany-gaap-taxonomy-v6.10-2026-04-01-xbrl.zip
   ```

2. Auszug erzeugen: `bun scripts/ebilanz/taxonomie.ts <Ordner>/de-gaap-ci-<Datum> packages/elster/src/ebilanz/taxonomie-<Version>.json`.
3. In `taxonomie.ts` eintragen, dort `ebilanzTaxonomie` (welches Wirtschaftsjahr, nach dem BMF-Schreiben zur Taxonomie) und `EBILANZ_TAXONOMIEN` in `packages/elster/src/xml.ts` ergänzen.
4. Tests mit ERiC; `zuordnung.test.ts` meldet Positionen der Kontenzuordnung, die es nicht mehr gibt oder die keine Blätter mehr sind. Prüfregeln: Technischer Leitfaden und Änderungsnachweis auf esteuer.de, ERiC-Releasenotes („Datenart Bilanz“), Beispiele unter `Datenarten/ElsterBilanz/Bilanz/Beispiele/Taxonomie_<Version>`.

## Normen

Befund `norm-<id>`. `scripts/jahreswerte/normen.json` nennt je Norm, wofür Haben sie braucht, und die Stellen im Code.

1. Die Änderung lesen: Fußnote und „Textnachweis“ der Seite nennen das ändernde Gesetz und ab wann es gilt. Bei 404 im Inhaltsverzeichnis des Gesetzes oder im Bundesgesetzblatt suchen und die neue Adresse eintragen.
2. Die genannten Stellen prüfen und anpassen.
3. Den Hash nachziehen, auch wenn sich in Haben nichts ändert, sonst bleibt der Befund. Der Befehl übernimmt die Hashes aller Normen; vorher darf kein anderer Befund zu einer Norm offen sein. Eine neue Norm kommt mit leerem `sha256` dazu und bekommt ihren Hash ebenso:

   ```sh
   bun scripts/jahreswerte/pruefen.ts --trocken --normen-schreiben
   ```

## Kontenrahmen

Befunde `datev-skr03`, `datev-skr04`: die Kontenzuordnung (`hgb.ts`, `posting.ts`, `ebilanz.ts`) mit der neuen Ausgabe abgleichen, dann `HABEN_KONTENRAHMEN_STAND` in `scripts/jahreswerte/datev.ts` anheben. Widerspricht eine Kontenfunktion dem Gesetz, einer Kennzahl oder der Taxonomie, gilt die Norm.

## Abschlussbericht

Issue, Pull Request, je Wert die Quelle, was offen blieb und warum.
