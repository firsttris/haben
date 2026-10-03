-- Anträge, Freischaltungen und Widerrufe beim Berechtigungsmanagement sind wie Übermittlungen unveränderlich.

CREATE TRIGGER brm_requests_append_only BEFORE UPDATE OR DELETE ON brm_requests
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER brm_requests_audit AFTER INSERT ON brm_requests
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
