-- DATEV-Personenkonten (#327): Was ein Export einmal geschrieben hat, bleibt. datev_personenkonten ist nur anhängbar
-- und steht im Audit-Log; eine dort eingetragene Nummer ist am Kontakt fest, damit spätere Stapel dasselbe Konto
-- tragen wie die, die die Steuerberatung schon hat. Der Name des Kontakts darf sich weiter ändern.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE FUNCTION haben_datev_personenkonto_passt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  aktuell integer;
BEGIN
  SELECT CASE NEW.rolle WHEN 'debitor' THEN debitor_nr ELSE kreditor_nr END INTO aktuell FROM contacts WHERE id = NEW.contact_id;
  IF aktuell IS DISTINCT FROM NEW.nummer THEN
    RAISE EXCEPTION 'Personenkonto % passt nicht zum Kontakt %', NEW.nummer, NEW.contact_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_contact_personenkonto_fest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.debitor_nr IS DISTINCT FROM OLD.debitor_nr
     AND EXISTS (SELECT 1 FROM datev_personenkonten WHERE contact_id = OLD.id AND rolle = 'debitor') THEN
    RAISE EXCEPTION 'Debitor % steht schon in einem DATEV-Export und bleibt fest.', OLD.debitor_nr USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kreditor_nr IS DISTINCT FROM OLD.kreditor_nr
     AND EXISTS (SELECT 1 FROM datev_personenkonten WHERE contact_id = OLD.id AND rolle = 'kreditor') THEN
    RAISE EXCEPTION 'Kreditor % steht schon in einem DATEV-Export und bleibt fest.', OLD.kreditor_nr USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER datev_personenkonten_passt BEFORE INSERT ON datev_personenkonten
  FOR EACH ROW EXECUTE FUNCTION haben_datev_personenkonto_passt();
--> statement-breakpoint
CREATE TRIGGER datev_personenkonten_append_only BEFORE UPDATE OR DELETE ON datev_personenkonten
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER datev_personenkonten_audit AFTER INSERT ON datev_personenkonten
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER contacts_personenkonto_fest BEFORE UPDATE OF debitor_nr, kreditor_nr ON contacts
  FOR EACH ROW EXECUTE FUNCTION haben_contact_personenkonto_fest();
