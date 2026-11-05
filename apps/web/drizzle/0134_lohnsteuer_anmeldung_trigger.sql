-- Lohnsteuer-Anmeldung: Prüfungen und Übermittlungen sind wie die der Voranmeldung nur anhängbar; eine echt übermittelte
-- Anmeldung lässt sich so nicht mehr ändern (GoBD), eine Korrektur geht als berichtigte Anmeldung. haben_audit lässt das
-- Protokoll-PDF weg. Der Anmeldungszeitraum je Jahr ist änderbar, jede Änderung steht im Audit-Log.
CREATE TRIGGER lsta_submissions_append_only BEFORE UPDATE OR DELETE ON lsta_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER lsta_submissions_audit AFTER INSERT ON lsta_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER lsta_turnus_audit AFTER INSERT OR UPDATE OR DELETE ON lsta_turnus
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
