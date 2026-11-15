-- Zugang zu Etsy Payments (Status, letzter Abruf, Stichtag): jede Änderung ins Protokoll, Geheimnis und Token
-- (ciphertext) bleiben draußen. Wie bei bank_connections und store_connections gegen TRUNCATE gesperrt.

CREATE TRIGGER etsy_connections_audit AFTER INSERT OR UPDATE OR DELETE ON etsy_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER etsy_connections_no_truncate BEFORE TRUNCATE ON etsy_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
