// Prüft beim Hochladen, ob sich ein Bild in ein PDF/A einbetten lässt (embedsInPdf in pdf.ts)
#let d = json(bytes(sys.inputs.data))
#image(d.file, width: 10mm)
