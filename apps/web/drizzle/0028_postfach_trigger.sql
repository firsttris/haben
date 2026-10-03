-- Postfach-Abrufe und abgeholte Bescheide sind wie Übermittlungen unveränderlich.

CREATE TRIGGER postfach_requests_append_only BEFORE UPDATE OR DELETE ON postfach_requests
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER postfach_requests_audit AFTER INSERT ON postfach_requests
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER postfach_documents_append_only BEFORE UPDATE OR DELETE ON postfach_documents
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER postfach_documents_audit AFTER INSERT ON postfach_documents
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
