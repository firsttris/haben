-- Der sevDesk-Token darf sich ändern; jede Änderung ins Audit-Log (die Funktion lässt den Chiffretext weg)
CREATE TRIGGER sevdesk_connection_audit AFTER INSERT OR UPDATE OR DELETE ON sevdesk_connection
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
