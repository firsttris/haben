-- Pauschalen sind Buchungsgrundlage: nur anhängen, Storno als eigene Zeile
CREATE TRIGGER pauschalen_append_only BEFORE UPDATE OR DELETE ON pauschalen FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER pauschalen_audit AFTER INSERT ON pauschalen FOR EACH ROW EXECUTE FUNCTION haben_audit();
