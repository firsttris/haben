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


def title_of(box: etree.Element) -> etree.Element | None:
    """Titel eines Kastens: <p class="admonition-title"> im <div>, <summary> im einklappbaren <details>."""
    first = box.find("*")
    if first is None:
        return None
    if box.tag == "div" and "admonition" in box.get("class", "").split():
        return first if first.tag == "p" and "admonition-title" in first.get("class", "").split() else None
    if box.tag == "details":
        return first if first.tag == "summary" else None
    return None


def german_title(box: etree.Element) -> None:
    """Ersetzt im Kasten den englischen Standardtitel seines Typs („Note“) durch den deutschen."""
    title = title_of(box)
    if title is None or len(title):
        return
    for kind in box.get("class", "").split():
        if kind in TITLES and title.text == kind.title():
            title.text = TITLES[kind]
            return


class _TitleTreeprocessor(Treeprocessor):
    def run(self, root: etree.Element) -> None:
        for box in root.iter():
            german_title(box)


class HinweiseExtension(Extension):
    def extendMarkdown(self, md: Markdown) -> None:
        # Nach pymdownx.quotes (19.99), das die Zitate erst zu Kästen macht; höhere Zahl läuft früher
        md.treeprocessors.register(_TitleTreeprocessor(md), "hinweise_deutsch", 19)


def makeExtension(**kwargs) -> HinweiseExtension:
    return HinweiseExtension(**kwargs)
