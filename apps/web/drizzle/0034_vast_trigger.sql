-- Belegabrufe und abgeholte Belege sind wie Postfach-Abrufe unveränderlich.
-- Das Beleg-XML (Spalte xml) bleibt wie Bescheide aus dem Audit-Log heraus.

CREATE TRIGGER vast_requests_append_only BEFORE UPDATE OR DELETE ON vast_requests
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER vast_requests_audit AFTER INSERT ON vast_requests
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER vast_belege_append_only BEFORE UPDATE OR DELETE ON vast_belege
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER vast_belege_audit AFTER INSERT ON vast_belege
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
