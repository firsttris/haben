-- Anlagen: Sobald eine Abschreibung oder die Eröffnung gebucht ist, sind die Berechnungsgrundlagen fest.
-- Bezeichnung, Notiz und Abgang bleiben änderbar (den Abgang prüft die App gegen gebuchte Jahre).

CREATE FUNCTION haben_reject_booked_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  booked boolean := EXISTS (SELECT 1 FROM asset_depreciations WHERE asset_id = OLD.id) OR OLD.opening_entry_id IS NOT NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF booked OR OLD.document_id IS NOT NULL THEN
      RAISE EXCEPTION 'Anlage % ist gebucht und kann nicht gelöscht werden', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF booked AND (
    NEW.kind IS DISTINCT FROM OLD.kind OR NEW.method IS DISTINCT FROM OLD.method OR NEW.account IS DISTINCT FROM OLD.account
    OR NEW.acquisition_date IS DISTINCT FROM OLD.acquisition_date OR NEW.cost IS DISTINCT FROM OLD.cost
    OR NEW.useful_life_months IS DISTINCT FROM OLD.useful_life_months OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.opening_date IS DISTINCT FROM OLD.opening_date OR NEW.opening_book_value IS DISTINCT FROM OLD.opening_book_value
    OR (OLD.opening_entry_id IS NOT NULL AND NEW.opening_entry_id IS DISTINCT FROM OLD.opening_entry_id)
  ) THEN
    RAISE EXCEPTION 'Anlage % ist gebucht, die Berechnungsgrundlagen sind unveränderlich', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assets_booked BEFORE UPDATE OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION haben_reject_booked_asset();
--> statement-breakpoint
CREATE TRIGGER assets_audit AFTER INSERT OR UPDATE OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER asset_depreciations_append_only BEFORE UPDATE OR DELETE ON asset_depreciations
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER asset_depreciations_audit AFTER INSERT ON asset_depreciations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
