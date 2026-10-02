// Stub-Worker: meldet einen Fehler.
process.once("message", () => process.send({ type: "error", message: "kaputt" }, () => process.exit(0)));
