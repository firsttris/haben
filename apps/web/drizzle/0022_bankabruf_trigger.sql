-- Zustimmungen für den Kontoabruf ändern sich (Status, letzter Abruf); jede Änderung ins Protokoll,
-- die verschlüsselte Sitzungskennung bleibt draußen.

CREATE TRIGGER bank_connections_audit AFTER INSERT OR UPDATE OR DELETE ON bank_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
