-- Dauerfristverlängerung: der Stand je Jahr ändert sich mit Antrag oder von Hand, jede Änderung steht im Audit-Log.
-- Prüfungen und Übermittlungen des Antrags sind wie die der Voranmeldung nur anhängbar (haben_audit lässt das Protokoll-PDF weg).
CREATE TRIGGER vat_extensions_audit AFTER INSERT OR UPDATE OR DELETE ON vat_extensions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER vat_extension_submissions_append_only BEFORE UPDATE OR DELETE ON vat_extension_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER vat_extension_submissions_audit AFTER INSERT ON vat_extension_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
