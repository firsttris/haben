-- Prüfungen und Übermittlungen der Jahreserklärungen sind wie die der Voranmeldung unveränderlich.

CREATE TRIGGER annual_submissions_append_only BEFORE UPDATE OR DELETE ON annual_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER annual_submissions_audit AFTER INSERT ON annual_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
