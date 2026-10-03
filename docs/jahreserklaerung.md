# Jahreserklärungen

Unter **Jahreserklärung** berechnet Haben für ein abgeschlossenes Jahr die **Umsatzsteuererklärung** und die **Anlage EÜR** mit dem Anlagenverzeichnis (**Anlage AVEÜR**) und übermittelt beide über ERiC an das Finanzamt, wie die [Voranmeldung](umsatzsteuer.md). Dazu kommt die **Einkommensteuererklärung** mit den Anlagen, die ein Selbständiger typischerweise braucht: Der Gewinn kommt aus der EÜR, Vorsorge, Sonderausgaben, Kinder und Kapitalerträge trägst du ein.

Die Seite zeigt je Erklärung die Zeilen mit Feldkennung, Hinweise und einen eigenen Bereich zum Übermitteln. Ohne Jahr in der Adresse öffnet sie das Vorjahr.

## Ablauf

1. **Jahr abschließen:** Bankumsätze bis 31.12. zuordnen, Belege buchen, unter [Anlagen](anlagen.md) die AfA des Jahres buchen. Solange AfA oder Privatnutzung fehlen, lässt sich die Anlage EÜR nicht senden.
2. **Einstellungen:** Für die Anlage EÜR braucht Haben die **Einkunftsart** (selbständige Arbeit oder Gewerbebetrieb) und die **Art des Betriebs** (z. B. „Softwareentwicklung“).
3. **Nur prüfen:** ERiC prüft das XML gegen das Schema und die Plausibilitätsregeln des Jahres. Erst hier zeigt sich, ob die Feldkennungen für das Jahr passen.
4. **Testübermittlung** mit Zertifikat und PIN: geht an den ELSTER-Server, aber nicht ans Finanzamt (Testmerker). Das Protokoll-PDF liegt im Verlauf.
5. **Echtübermittlung:** Häkchen „Nur Testübermittlung“ entfernen und zweimal bestätigen. Dafür brauchst du wie bei der Voranmeldung ERiC und eine eigene Hersteller-ID.

Jede Prüfung und Übermittlung speichert Haben mit XML, Antwort, Protokoll und den gesendeten Werten; ändern oder löschen lässt sich das nicht. Je Erklärung und Jahr ist nur eine Echtübermittlung möglich. Eine berichtigte Erklärung gibst du über das ELSTER-Portal ab.

Fristen: ohne Steuerberatung bis 31. Juli des Folgejahres, mit Steuerberatung später.

## Umsatzsteuererklärung

| Zeile | Woher |
| --- | --- |
| Umsätze zu 19 % und 7 % | Summe der zwölf Monate aus den Buchungen, wie in der Voranmeldung: Ist-Versteuerung nach Zahlungseingang, Soll nach Rechnungsdatum. Bemessungsgrundlage in vollen Euro, die Steuer daraus. Die private Kfz-Nutzung ist in den 19 % enthalten |
| Abziehbare Vorsteuer | Summe der Vorsteuer aus gebuchten Belegen |
| Vorauszahlungssoll | Summe der gesendeten Voranmeldungen des Jahres; je Monat zählt die zuletzt gesendete (bei Berichtigungen die berichtigte) |
| Abschlusszahlung bzw. Erstattung | Umsatzsteuer minus Vorsteuer minus Vorauszahlungssoll |

Hast du Voranmeldungen eines Jahres in einem anderen Programm gesendet (etwa vor dem Umzug aus Lexoffice), fehlen sie im Vorauszahlungssoll; Haben weist darauf hin. Dann stimmt die Abschlusszahlung nicht, und du gibst die Erklärung besser im ELSTER-Portal ab.

Haben übermittelt die Umsatzsteuererklärung nicht, wenn

- das Jahr Leistungen im EU-Ausland (Reverse Charge, Kz 21), nicht steuerbare Umsätze im Drittland (Kz 45) oder steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48) enthält. Für diese Zeilen fehlen Haben noch die geprüften Feldkennungen; die Werte stehen auf der Seite, abgeben kannst du im ELSTER-Portal.
- du Kleinunternehmer bist: Ab dem Jahr 2024 gibst du keine Umsatzsteuererklärung mehr ab, außer das Finanzamt fordert dazu auf.
- es weder Umsätze noch Vorsteuer gibt (Nullerklärung über das ELSTER-Portal).

## Anlage EÜR

Grundlage ist dieselbe Rechnung wie unter [Auswertungen](auswertungen.md): Zufluss und Abfluss im Jahr, vereinnahmte Umsatzsteuer als Einnahme, Vorsteuer und gezahlte Umsatzsteuer als Ausgabe. Summen und Gewinn sind dieselben; Haben verteilt die Beträge nur auf die Zeilen des amtlichen Vordrucks.

| Kategorie in Haben | Zeile der Anlage EÜR |
| --- | --- |
| Software und Lizenzen, Hosting und IT-Dienste | Laufende EDV-Kosten |
| Hardware (GWG) und GWG aus dem Anlagenverzeichnis | Geringwertige Wirtschaftsgüter |
| Telefon, Internet | Telekommunikation |
| Bürobedarf, Fachliteratur, Porto | Arbeitsmittel |
| Fortbildung | Fortbildungskosten |
| Reisekosten: Übernachtung | Übernachtungs- und Reisenebenkosten |
| Reisekosten: Fahrten, Kfz: Laden, Tanken, Wartung, Reparaturen | Sonstige tatsächliche Fahrtkosten |
| Kfz: Versicherung, Steuer | Steuern, Versicherungen und Maut für Kraftfahrzeuge |
| Kfz: Leasing | Leasingkosten für Kraftfahrzeuge |
| Rechts- und Beratungskosten, Buchführung und Steuerberatung | Rechts- und Steuerberatung, Buchführung |
| Versicherungen, Beiträge | Beiträge, Gebühren, Abgaben und Versicherungen |
| Werbung | Werbekosten |
| Fremdleistungen | Bezogene Fremdleistungen |
| Kontoführung und Gebühren, Sonstiger Aufwand | Übrige Betriebsausgaben |
| AfA aus dem Anlagenverzeichnis | AfA auf bewegliche Wirtschaftsgüter, Auflösung Sammelposten, Restbuchwert ausgeschiedener Anlagen |
| [Pauschale](pauschalen.md): Homeoffice-Tage | Tagespauschale für die Arbeit in der Wohnung |
| [Pauschale](pauschalen.md): Fahrten mit dem Privatfahrzeug | Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge (Nutzungseinlage) |
| [Pauschale](pauschalen.md): Verpflegungsmehraufwand | Verpflegungsmehraufwendungen (beschränkt abziehbar) |
| Private Kfz-Nutzung | Private Kfz-Nutzung (Einnahme), die Umsatzsteuer darauf bei der vereinnahmten Umsatzsteuer |

**Entnahmen und Einlagen** kommen aus dem Journal: alles, was auf den Privatkonten gebucht ist (Privatüberweisungen im Bankabgleich, privat bezahlte Belege, Pauschalen ohne Beleg, Privatanteile, Privatnutzung der Firmenwagen mit Umsatzsteuer).

**Allgemeine Angaben:** Rechtsform „Angehörige freier Berufe“ bzw. „Einzelgewerbetreibende“, Betriebsinhaber ist die steuerpflichtige Person, keine Veräußerung von Grundstücken. Für Gesellschaften ist die Anlage EÜR in Haben nicht gedacht.

Nicht abgebildet sind Bewirtung, Geschenke, das häusliche Arbeitszimmer als Mittelpunkt (die Tagespauschale schon), Verpflegung im Ausland, Fahrten zwischen Wohnung und Betriebsstätte, Investitionsabzugsbeträge und Rücklagen. Brauchst du davon etwas, ergänze die Anlage im ELSTER-Portal statt sie hier zu senden.

### Anlage AVEÜR

Das Anlagenverzeichnis listet jede Anlage mit Bezeichnung, Anschaffungsdatum, Anschaffungskosten, Buchwert zu Beginn, AfA, Abgang und Buchwert am Ende, gruppiert nach Kraftfahrzeugen, Büroeinrichtung und anderen beweglichen Wirtschaftsgütern; Sammelposten stehen je Jahrgang. Geringwertige Wirtschaftsgüter gehören nicht hinein. Anlagen, die im Jahr angeschafft wurden, stehen mit den Anschaffungskosten im Buchwert zu Beginn, wie es auch EasyCash&Tax übermittelt.

## Einkommensteuererklärung

Die Einkommensteuererklärung (Datenart ESt, Vordruck E10) setzt Haben aus drei Quellen zusammen:

| Teil | Woher |
| --- | --- |
| Hauptvordruck ESt 1 A | [Persönliche Angaben](einrichtung.md#persönliche-angaben) (Steuer-ID, Name, Geburtsdatum, Religion, Beruf, bei Zusammenveranlagung Ehegatte und Heiratsdatum), Anschrift, Telefon und IBAN aus den Firmendaten |
| Anlage S oder G | Gewinn laut Anlage EÜR des Jahres in vollen Euro, Tätigkeit aus „Art des Betriebs“; selbständige Arbeit geht in Anlage S, Gewerbe in Anlage G |
| Übrige Anlagen | Angaben, die du auf der Seite einträgst und speicherst |

Die eingetragenen Angaben speichert Haben je Jahr; jede Änderung steht im Audit-Log. Übermittelt wird, was gespeichert ist. Leere Anlagen schickt Haben nicht mit.

| Anlage | Angaben |
| --- | --- |
| Vorsorgeaufwand | Je Person: gesetzliche Rentenversicherung, gesetzliche Kranken- und Pflegeversicherung (Basis, dazu Krankengeldanteil und Wahlleistungen), private Kranken- und Pflege-Pflichtversicherung samt Erstattungen; weitere sonstige Vorsorge (Haftpflicht, Unfall, Risikoleben) |
| Sonderausgaben | Gezahlte und erstattete Kirchensteuer, Spenden an steuerbegünstigte Empfänger im Inland |
| Außergewöhnliche Belastungen | Selbst getragene Krankheitskosten |
| Haushaltsnahe Aufwendungen (§ 35a EStG) | Minijobs im Haushalt, haushaltsnahe Dienstleistungen, Handwerkerleistungen (nur Arbeits-, Maschinen- und Fahrtkosten) |
| Kind | Je Kind Vorname, Geburtsdatum, Steuer-ID, Familienkasse und Kinderbetreuungskosten; leibliches Kind beider Ehegatten bzw. der steuerpflichtigen Person, Wohnsitz im Inland im ganzen Jahr bzw. ab Geburt |
| KAP | Erträge mit und ohne inländischen Steuerabzug, genutzter Sparer-Pauschbetrag, einbehaltene Kapitalertragsteuer, Solidaritätszuschlag und Kirchensteuer, Antrag auf Günstigerprüfung |

Unter den Angaben zeigt Haben das geschätzte zu versteuernde Einkommen und die voraussichtliche Steuer, berechnet wie die [Steuerprognose](finanzamt.md#steuerprognose) mit dem tatsächlichen Gewinn des Jahres.

Beträge gehen in vollen Euro an ELSTER, nur die Steuern auf Kapitalerträge mit Cent. Bei der Einzelveranlagung trägt Haben Kinderbetreuungskosten als selbst getragen ein.

Nicht abgebildet sind unter anderem Arbeitslohn (Anlage N, etwa für einen angestellten Ehegatten), Renten, Vermietung, Unterhalt, Riester sowie Kinder mit anderem Kindschaftsverhältnis oder Wohnsitz im Ausland. Brauchst du davon etwas, gibst du die Erklärung im ELSTER-Portal ab, statt sie hier zu senden; ein Nachsenden einzelner Anlagen ist nicht möglich.

## Belege von ELSTER

Arbeitgeber, Rentenversicherung, Krankenkassen und andere Stellen melden dem Finanzamt Daten für die Steuererklärung: Lohnsteuerbescheinigung, Rentenbezüge, Beiträge zur Kranken- und Pflegeversicherung, Lohnersatzleistungen und mehr. Diese Belege der vorausgefüllten Steuererklärung (VaSt) holt Haben unter **Belege von ELSTER** auf der Seite des Jahres ab:

1. Persönliche Angaben mit Steuer-ID hinterlegen ([Einstellungen](einrichtung.md#persönliche-angaben)) und das ELSTER-Zertifikat hochladen.
2. Person wählen (bei Zusammenveranlagung), PIN eingeben, **Belege abrufen**. Ist der automatische Postfachabruf an, reicht die gespeicherte PIN.
3. Haben fragt die Liste der Belege für Steuer-ID und Jahr ab, holt alle Belege in einem zweiten Schritt und entschlüsselt sie mit dem Zertifikat.

Jeder Beleg erscheint mit seiner Art und allen gemeldeten Werten; Beträge zeigt Haben in Euro, Datumsangaben als Datum. Das XML lässt sich so öffnen, wie es von ELSTER kam. Abrufe und Belege sind wie Postfach-Abrufe unveränderlich gespeichert, das Beleg-XML steht wegen der persönlichen Daten nicht im Audit-Log. Wiederholte Abrufe legen nur neue Belege ab; eine berichtigte Meldung kommt bei ELSTER mit neuer ID. Testbelege blendet Haben aus, sobald es echte für das Jahr gibt.

Gut zu wissen:

- Die meisten Meldungen liegen ab Ende Februar des Folgejahres vor; die Belege lassen sich beliebig oft abrufen, eine Bestätigung wie beim Postfach gibt es nicht.
- Mit dem eigenen Zertifikat, das mit deiner Steuer-ID registriert ist, holst du deine eigenen Belege. Für die Belege des Ehegatten braucht dein Zertifikat eine Berechtigung, siehe unten. Alternativ ruft der Ehegatte mit dem eigenen Zertifikat ab.
- Der Testabruf trägt den Testmerker der Datenabholung (`370000001`). Ohne ERiC liefert er zwei erfundene Beispielbelege.
- Haben übernimmt die Werte noch nicht von selbst in die Erklärung. Die Belege dienen zum Abgleich mit den Angaben oben; das Finanzamt hat sie ohnehin und gleicht selbst ab. Für eine sichere Zuordnung zu den Feldern fehlen die Schemas der einzelnen Belegarten ([Roadmap](roadmap.md#blockiert)).

### Berechtigung für den Ehegatten

Wählst du unter **Für** den Ehegatten (Person B aus den [persönlichen Angaben](einrichtung.md#persönliche-angaben)), zeigt Haben den Stand der Berechtigung (ELSTER-Verfahren ElsterBRM):

1. **Berechtigung beantragen:** mit Steuer-ID und Geburtsdatum des Ehegatten, für alle Jahre und gültig bis zum gewählten Datum (Vorschlag: Ende des übernächsten Jahres). ELSTER schickt dem Ehegatten einen Brief mit Freischaltcode; die E-Mail-Adresse aus den Firmendaten bekommt Benachrichtigungen.
2. **Freischalten:** den Code aus dem Brief eingeben, bevor die Frist abläuft, die Haben beim Antrag anzeigt. Danach steht die Berechtigung auf „genehmigt“ und der Belegabruf für den Ehegatten funktioniert wie der eigene.
3. **Widerrufen** oder einen offenen Antrag zurückziehen geht jederzeit, mit Rückfrage.

**Stand bei ELSTER prüfen** fragt alle eigenen Anträge ab. So erkennt Haben auch einen Antrag, den du in Mein ELSTER gestellt hast, und ob eine Berechtigung abgelaufen ist. Jeder Schritt braucht die Zertifikats-PIN (oder die gespeicherte) und steht unveränderlich im Verlauf; den Freischaltcode speichert Haben nicht. Test und echt sind getrennt: Der Testserver führt eigene Anträge, im simulierten Betrieb gilt jeder Code.

## Herkunft der Feldkennungen

Das Finanzamt beschreibt jedes Feld mit einer Kennung (z. B. `E6007202` für den Gewinn). Die amtliche Liste steht in der Jahresdokumentation im ERiC-Paket. Haben nutzt die Kennungen und die Reihenfolge, mit denen andere freie Programme die Erklärungen bereits übermitteln (EasyCash&Tax für Anlage EÜR und AVEÜR, viking und finamt für die Umsatzsteuererklärung, viking für die Einkommensteuererklärung), für die Jahre ab 2023. Die Reihenfolge der Felder der Einkommensteuererklärung ist gegen die Feldliste der Jahresdokumentation 2024 abgeglichen.

Die Vordrucke ändern sich jedes Jahr ein wenig. Deshalb vor der Echtübermittlung immer erst prüfen oder testweise senden: Meldet ERiC ein unbekanntes Feld oder eine verletzte Regel, steht die Meldung im Verlauf. Bitte dann als Issue melden.
