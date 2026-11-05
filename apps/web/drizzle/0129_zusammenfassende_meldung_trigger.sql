-- Zusammenfassende Meldung: Prüfungen und Übermittlungen sind wie die der Voranmeldung nur anhängbar; eine echt übermittelte
-- Meldung lässt sich so nicht mehr ändern (GoBD), eine Korrektur geht als Berichtigung. haben_audit lässt das Protokoll-PDF weg.
CREATE TRIGGER zm_submissions_append_only BEFORE UPDATE OR DELETE ON zm_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER zm_submissions_audit AFTER INSERT ON zm_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
