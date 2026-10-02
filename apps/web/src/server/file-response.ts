/** Auslieferung gespeicherter Dateien: nur PDF und Bilder inline, alles andere als Download ohne Ausführung */
export function fileResponse(bytes: Uint8Array, file: { mimeType: string; filename: string }, forceDownload: boolean): Response {
  const inlineSafe = file.mimeType === "application/pdf" || /^image\/(jpeg|png|webp)$/.test(file.mimeType);
  const isText = /^(text\/|application\/(xml|json))/.test(file.mimeType);
  const contentType = isText ? "text/plain; charset=utf-8" : inlineSafe ? file.mimeType : "application/octet-stream";
  const disposition = forceDownload || !(inlineSafe || isText) ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Der PDF-Viewer des Browsers verträgt kein sandbox
      "Content-Security-Policy":
        file.mimeType === "application/pdf" ? "default-src 'none'; object-src 'self'" : "sandbox; default-src 'none'; img-src 'self'",
    },
  });
}
