-- Eigene Belegvorlagen (#113): Name, Quelltext und Freigabe der Pakete stehen im Änderungsprotokoll
CREATE TRIGGER beleg_layouts_audit AFTER INSERT OR UPDATE OR DELETE ON beleg_layouts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
