-- Eigene Seiten ändern sich frei wie Textbausteine; jede Änderung steht im Änderungsprotokoll
CREATE TRIGGER custom_pages_audit AFTER INSERT OR UPDATE OR DELETE ON custom_pages
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
