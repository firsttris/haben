-- Firmendaten nach der ersten Buchung nicht löschen. Die Sperren der Firmendaten (0065 Kontenrahmen, Versteuerung und
-- § 19 UStG im laufenden Jahr; 0096 Rechtsform; 0101 Kontenrahmen von GmbH und UG) vergleichen bei UPDATE den alten mit
-- dem neuen Wert. DELETE und ein neues INSERT mit anderen Werten gingen an allen drei vorbei. Die Zeile wird deshalb
-- nicht mehr gelöscht, sobald es eine Buchung gibt, ob im laufenden Jahr oder davor: Die Rechtsform ist ab der ersten
-- Buchung überhaupt fest. Vorher bleibt Löschen erlaubt, dann ist auch jedes UPDATE frei; loadCompany legt eine fehlende
-- Zeile mit den Vorgaben wieder an.
-- Wie 0065 nimmt die Prüfung vorher die Sperre der Hash-Kette, damit sie laufende Buchungen sieht.
-- Die App löscht die Firmendaten nie. Die Tests leeren company mit leeren() (session_replication_role = replica), ein
-- Restore aus pg_dump legt die Trigger erst nach den Daten an; beide feuern den Trigger nicht.
CREATE FUNCTION haben_check_company_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM haben_lock_audit_chain();
  IF EXISTS (SELECT 1 FROM journal_entries) THEN
    RAISE EXCEPTION 'Es gibt schon Buchungen. Die Firmendaten lassen sich nach der ersten Buchung nicht löschen, nur ändern.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_delete_lock BEFORE DELETE ON company
  FOR EACH ROW EXECUTE FUNCTION haben_check_company_delete();
