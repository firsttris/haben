// Stub-Worker: antwortet mit Transferticket und hängt danach (z. B. beim Beenden von ERiC).
process.once("message", () => {
  process.send({
    type: "result",
    result: { code: 0, message: "OK", responseXml: "", serverResponseXml: "", transferTicket: "stub-ticket" },
  });
  setInterval(() => {}, 1000);
});
