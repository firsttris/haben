-- Zugang zu PayPal (Status, letzter Abruf, Stichtag): jede Änderung ins Protokoll, Client-ID und Secret (ciphertext)
-- bleiben draußen. Wie bei etsy_connections, bank_connections und store_connections gegen TRUNCATE gesperrt.

CREATE TRIGGER paypal_connections_audit AFTER INSERT OR UPDATE OR DELETE ON paypal_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER paypal_connections_no_truncate BEFORE TRUNCATE ON paypal_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
