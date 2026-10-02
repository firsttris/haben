// Stub-Worker: stürzt wie eine native Bibliothek ab.
process.once("message", () => process.kill(process.pid, "SIGSEGV"));
