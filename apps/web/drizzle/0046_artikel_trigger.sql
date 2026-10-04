-- Artikel ändern sich frei; jede Änderung steht im Änderungsprotokoll.
CREATE TRIGGER articles_audit AFTER INSERT OR UPDATE OR DELETE ON articles
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
