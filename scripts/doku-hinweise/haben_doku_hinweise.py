"""Deutsche Titel für die Hinweiskästen der Doku.

Die Doku schreibt Hinweise im Stil von GitHub (`> [!NOTE]`), damit sie auch beim Lesen der Dateien auf GitHub als
Kasten erscheinen. Auf der Website macht pymdownx.quotes mit `callouts: true` daraus einen Kasten
(https://zensical.org/docs/authoring/admonitions/#github-callouts), mit dem Typ als englischem Titel („Important“).
Einen eigenen Titel hinter dem Marker kennt GitHub nicht, er stünde dort als Text im Zitat. Diese Erweiterung
ersetzt deshalb nach dem Rendern den englischen Standardtitel durch den deutschen; ein eigener Titel bleibt.
"""

from __future__ import annotations

import xml.etree.ElementTree as etree

from markdown import Extension, Markdown
from markdown.treeprocessors import Treeprocessor

# Die fünf Typen von GitHub; andere Typen behalten ihren Titel
TITLES = {
    "note": "Hinweis",
    "tip": "Tipp",
    "important": "Wichtig",
    "warning": "Warnung",
    "caution": "Vorsicht",
}


def german_title(box: etree.Element) -> None:
    """Ersetzt im Kasten den englischen Standardtitel seines Typs („Note“) durch den deutschen."""
    classes = box.get("class", "").split()
    if "admonition" not in classes:
        return
    title = box.find("p")
    if title is None or "admonition-title" not in title.get("class", "").split() or len(title):
        return
    for kind in classes:
        if kind in TITLES and title.text == kind.title():
            title.text = TITLES[kind]
            return


class _TitleTreeprocessor(Treeprocessor):
    def run(self, root: etree.Element) -> None:
        for box in root.iter("div"):
            german_title(box)


class HinweiseExtension(Extension):
    def extendMarkdown(self, md: Markdown) -> None:
        # Nach pymdownx.quotes (19.99), das die Zitate erst zu Kästen macht; höhere Zahl läuft früher
        md.treeprocessors.register(_TitleTreeprocessor(md), "hinweise_deutsch", 19)


def makeExtension(**kwargs) -> HinweiseExtension:
    return HinweiseExtension(**kwargs)
