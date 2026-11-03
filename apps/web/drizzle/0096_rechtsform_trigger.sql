-- Rechtsform (#213): Einzelunternehmen oder Kapitalgesellschaft (GmbH, UG). Sie bestimmt, ob Geld zwischen Unternehmen und
-- Inhaber auf Privateinlage/-entnahme oder auf das Gesellschafter-Verrechnungskonto geht. Ein Wechsel nach der ersten
-- Buchung brächte beides in dieselben Bücher; eine neue Rechtsform ist ein neues Unternehmen mit eigenen Büchern.
-- Wie 0065 nimmt die Prüfung vorher die Sperre der Hash-Kette, damit sie laufende Buchungen sieht.
CREATE FUNCTION haben_check_company_rechtsform() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rechtsform IS NOT DISTINCT FROM OLD.rechtsform THEN
    RETURN NEW;
  END IF;
  PERFORM haben_lock_audit_chain();
  IF EXISTS (SELECT 1 FROM journal_entries) THEN
    RAISE EXCEPTION 'Es gibt schon Buchungen. Die Rechtsform lässt sich nur vor der ersten Buchung festlegen.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_rechtsform_lock BEFORE UPDATE ON company
  FOR EACH ROW EXECUTE FUNCTION haben_check_company_rechtsform();
