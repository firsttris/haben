-- Darlehen: jede Änderung im Änderungsprotokoll. Nach der ersten Zuordnung sind Geber, Restlaufzeit, Zweck und Restschuld
-- zum Stichtag fest, denn sie bestimmen Konten und Bestand gebuchter Zahlungen; der Name bleibt änderbar. Löschen geht
-- nur ohne Zuordnung (Fremdschlüssel der Zuordnungen).
SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER loans_audit AFTER INSERT OR UPDATE OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE FUNCTION haben_loan_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.lender, NEW.term, NEW.purpose, NEW.opening_balance, NEW.opening_date)
     IS DISTINCT FROM (OLD.lender, OLD.term, OLD.purpose, OLD.opening_balance, OLD.opening_date)
     AND EXISTS (SELECT 1 FROM allocations WHERE loan_id = OLD.id) THEN
    RAISE EXCEPTION 'Darlehen % hat Zahlungen; Geber, Restlaufzeit, Zweck und Restschuld sind fest', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER loans_fixed BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION haben_loan_fixed();
