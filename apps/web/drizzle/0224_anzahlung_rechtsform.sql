-- #750: Unbezahlte Anforderungen buchen noch nicht ins Journal. Ihr festgeschriebenes Bilanzverfahren bleibt dennoch
-- an die Rechtsform gebunden. Bestehende Journal-Sperre und Serialisierung über die Audit-Kette unverändert beibehalten.
-- Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
CREATE OR REPLACE FUNCTION haben_check_company_rechtsform() RETURNS trigger
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
  IF EXISTS (SELECT 1 FROM invoices WHERE status = 'final' AND advance_accounting = 'deferred') THEN
    RAISE EXCEPTION 'Es gibt eine festgeschriebene Anzahlungsanforderung. Die Rechtsform ist damit festgelegt.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Während PDF/XML entstehen, ist die Audit-Kette noch frei. Hat der Rechtsformwechsel zuerst committed, darf der
-- anschließend festgeschriebene Marker nicht mehr die zuvor gelesenen GmbH-/UG-Daten verwenden. Dieselbe Kettensperre
-- wie im Firmen-Guard ordnet beide Vorgänge; die Firmenzeile nur lesen, keine entgegengesetzte Zeilensperre aufnehmen.
CREATE FUNCTION haben_check_advance_rechtsform() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM haben_lock_audit_chain();
  IF NOT EXISTS (SELECT 1 FROM company WHERE id = 1 AND rechtsform IN ('gmbh', 'ug')) THEN
    RAISE EXCEPTION 'Die Rechtsform wurde während der Festschreibung geändert. Bitte die Anzahlungsanforderung erneut prüfen.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- BEFORE: noch vor invoices_audit und invoices_seal. Bereits gesperrte Zeilen bleiben allein durch invoices_locked
-- unveränderlich; dieser Guard greift ausschließlich bei der erstmaligen Festschreibung einer neuen Anforderung.
CREATE TRIGGER invoices_advance_rechtsform BEFORE UPDATE OF locked_at ON invoices
  FOR EACH ROW WHEN (
    OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL AND NEW.status = 'final'
    AND NEW.kind = 'rechnung' AND NEW.variant = 'abschlag' AND NEW.advance_type = 'anzahlung'
    AND NEW.advance_accounting = 'deferred'
  ) EXECUTE FUNCTION haben_check_advance_rechtsform();
--> statement-breakpoint
-- Wie invoices_seal_insert: Auch eine bereits festgeschrieben eingefügte Anforderung muss dieselbe Voraussetzung haben.
CREATE TRIGGER invoices_advance_rechtsform_insert BEFORE INSERT ON invoices
  FOR EACH ROW WHEN (
    NEW.locked_at IS NOT NULL AND NEW.status = 'final'
    AND NEW.kind = 'rechnung' AND NEW.variant = 'abschlag' AND NEW.advance_type = 'anzahlung'
    AND NEW.advance_accounting = 'deferred'
  ) EXECUTE FUNCTION haben_check_advance_rechtsform();
