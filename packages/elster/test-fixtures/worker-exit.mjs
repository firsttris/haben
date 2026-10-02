// Stub-Worker: beendet sich ohne Antwort.
process.once("message", () => {
  process.stderr.write("libericapi.so: cannot open shared object file\n");
  process.exit(3);
});
