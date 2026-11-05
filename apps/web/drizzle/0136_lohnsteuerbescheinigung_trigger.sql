-- Lohnsteuerbescheinigung (§ 41b EStG): Prüfungen, Übermittlungen über ERiC und Vermerke einer Übermittlung im
-- ELSTER-Portal sind nur anhängbar; eine übermittelte Bescheinigung lässt sich so nicht mehr ändern (GoBD), Korrektur und
-- Storno sind neue Zeilen. haben_audit lässt das Protokoll-PDF weg.
CREATE TRIGGER lstb_submissions_append_only BEFORE UPDATE OR DELETE ON lstb_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER lstb_submissions_audit AFTER INSERT ON lstb_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
