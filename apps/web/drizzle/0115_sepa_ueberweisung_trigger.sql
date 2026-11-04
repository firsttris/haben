-- Erzeugte SEPA-Überweisungsdateien halten fest, was wann an die Bank ging: nur anhängen, mit Audit-Eintrag.

CREATE TRIGGER sepa_transfers_append_only BEFORE UPDATE OR DELETE ON sepa_transfers
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_transfers_audit AFTER INSERT ON sepa_transfers
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sepa_transfer_items_append_only BEFORE UPDATE OR DELETE ON sepa_transfer_items
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_transfer_items_audit AFTER INSERT ON sepa_transfer_items
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
