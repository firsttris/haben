-- Kontenrahmen einer GmbH oder UG (#213): Sie trägt die Salden der Bestandskonten von Jahr zu Jahr vor. Nach einem Wechsel
-- des Kontenrahmens kämen die Vorträge im neuen nicht an; die Bilanz wäre falsch. Deshalb ist der Kontenrahmen ab der
-- ersten Buchung fest, wie die Rechtsform (0096). Im Einzelunternehmen gilt weiter nur die Jahressperre (0065): Die EÜR
-- beginnt jedes Jahr bei null. Wie 0065 nimmt die Prüfung vorher die Sperre der Hash-Kette.
CREATE FUNCTION haben_check_company_kontenrahmen_kapg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kontenrahmen IS NOT DISTINCT FROM OLD.kontenrahmen OR OLD.rechtsform NOT IN ('gmbh', 'ug') THEN
    RETURN NEW;
  END IF;
  PERFORM haben_lock_audit_chain();
  IF EXISTS (SELECT 1 FROM journal_entries) THEN
    RAISE EXCEPTION 'Der Kontenrahmen einer GmbH oder UG lässt sich nur vor der ersten Buchung festlegen.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_kontenrahmen_kapg_lock BEFORE UPDATE ON company
  FOR EACH ROW EXECUTE FUNCTION haben_check_company_kontenrahmen_kapg();
