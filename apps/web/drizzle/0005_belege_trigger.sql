-- Gebuchte Belege und ihre Beträge sind unveränderlich.

CREATE FUNCTION haben_reject_locked_document_amount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM documents WHERE id = parent AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Beleg % ist gebucht, Beträge sind unveränderlich', parent
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_locked BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked();
--> statement-breakpoint
CREATE TRIGGER document_amounts_locked BEFORE INSERT OR UPDATE OR DELETE ON document_amounts
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_document_amount();
--> statement-breakpoint
CREATE TRIGGER documents_audit AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
