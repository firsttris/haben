# Barrierefreiheit

Haben lässt sich vollständig mit der Tastatur bedienen und erfüllt nach den automatischen Prüfungen die Kriterien der
WCAG 2.2 auf Stufe AA, in allen hellen und dunklen Themes. Jede Änderung wird in der CI mit axe-core und eigenen
Tastaturtests geprüft (`apps/web/e2e/barrierefreiheit.spec.ts`).

Tastenkürzel, wie geprüft wird und was noch nicht systematisch getestet ist (etwa Screenreader), steht unter
[Barrierefreiheit und Tastatur](https://firsttris.github.io/haben/barrierefreiheit.html).

Fällt dir eine Barriere auf, freuen wir uns über ein [Issue](https://github.com/firsttris/haben/issues/new/choose).
Beiträge, die die Oberfläche ändern, halten die Regeln ein: echte Buttons und Links, ein Label für jedes Feld,
sichtbarer Fokus, ausreichender Kontrast (siehe [CONTRIBUTING.md](CONTRIBUTING.md)).
