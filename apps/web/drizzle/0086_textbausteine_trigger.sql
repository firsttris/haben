-- Textbausteine ändern sich frei wie Artikel; jede Änderung steht im Änderungsprotokoll
CREATE TRIGGER text_blocks_audit AFTER INSERT OR UPDATE OR DELETE ON text_blocks
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
