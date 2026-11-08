-- Zusätzliche Anhänge an Angeboten (#415): festgeschrieben mit dem Angebot wie dessen Positionen (quote_lines_locked,
-- 0044), jede Änderung steht im Audit-Log. Angebote haben kein Siegel; die Sperre entspricht der der Positionen. Auch
-- das Umhängen an ein festgeschriebenes Angebot ist gesperrt.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE FUNCTION haben_reject_locked_quote_attachment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM quotes WHERE id = OLD.quote_id AND locked_at IS NOT NULL) THEN
    locked := OLD.quote_id;
  ELSIF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM quotes WHERE id = NEW.quote_id AND locked_at IS NOT NULL) THEN
    locked := NEW.quote_id;
  END IF;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'Angebot % ist festgeschrieben, Anhänge sind unveränderlich', locked USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_attachments_locked BEFORE INSERT OR UPDATE OR DELETE ON quote_attachments
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_quote_attachment();
--> statement-breakpoint
CREATE TRIGGER quote_attachments_audit AFTER INSERT OR UPDATE OR DELETE ON quote_attachments
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
