-- Mahnungen sind wie verschickte Schreiben unveränderlich.

ALTER TABLE dunnings ADD CONSTRAINT dunnings_level CHECK (level BETWEEN 1 AND 3);
--> statement-breakpoint
CREATE TRIGGER dunnings_append_only BEFORE UPDATE OR DELETE ON dunnings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER dunnings_audit AFTER INSERT ON dunnings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
