#!/bin/sh
# Prüft im fertigen Image pdftotext und pdftoppm an einem kleinen PDF mit der nicht eingebetteten Standardschrift
# Helvetica (CI-Job container): Textebene mit Lage der Wörter (Erkennung eigener Rechnungen) und Seitenbild (KI-Dienst).
# Ohne Schriften im Image rendert pdftoppm den Text nicht und meldet „Couldn't find a font“, ohne beschreibbaren
# Cache „Fontconfig error“. Aufruf: docker exec -i haben-app sh < scripts/container/pdf-werkzeuge.sh
set -eu
dir=$(mktemp -d)
cd "$dir"
printf '%s\n' '%PDF-1.4' '1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj' '2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj' \
  '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>> endobj' \
  '4 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica>> endobj' \
  '5 0 obj <</Length 44>> stream' 'BT /F1 24 Tf 72 720 Td (Rechnung 4711) Tj ET' 'endstream endobj' \
  'trailer <</Size 6/Root 1 0 R>>' '%%EOF' >probe.pdf
pdftotext -bbox-layout -enc UTF-8 probe.pdf - 2>/dev/null | grep -q '>4711</word>' || {
  echo "pdftotext liefert die Textebene nicht" >&2
  exit 1
}
pdftoppm -png -r 50 -singlefile probe.pdf seite 2>meldungen.txt
if grep -qi font meldungen.txt; then
  cat meldungen.txt >&2
  exit 1
fi
test -s seite.png || {
  echo "pdftoppm hat kein Seitenbild geschrieben" >&2
  exit 1
}
cd /
rm -rf "$dir"
echo "pdftotext $(pdftotext -v 2>&1 | head -n 1 | sed 's/.*version //') und pdftoppm ok"
