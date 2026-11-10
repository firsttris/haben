-- Fremdes Bankkonto ausschließen (#462): Ein Konto, das nicht zu dieser Firma gehört, lässt sich ausschließen, solange
-- keiner seiner Umsätze zugeordnet, verrechnet oder ausgebucht ist. Der Server prüft das vorher; der Trigger prüft es ein
-- zweites Mal und sperrt dazu die Umsätze des Kontos, so wie das Zuordnen sie sperrt: Eine gleichzeitige Zuordnung wartet,
-- bis die Entscheidung feststeht, und scheitert danach am zweiten Trigger. Nichts wird gelöscht; der Schritt steht über den
-- vorhandenen Audit-Trigger von bank_accounts im Änderungsprotokoll. Zahlungsdienstleister haben ein eigenes Verrechnungskonto
-- im Journal und lassen sich nicht ausschließen.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_check_bank_account_exclusion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.excluded_at IS NOT NULL AND OLD.excluded_at IS NULL THEN
    IF NEW.purpose = 'zahlungsdienstleister' THEN
      RAISE EXCEPTION 'Ein Zahlungsdienstleister lässt sich nicht ausschließen' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM bank_transactions WHERE bank_account_id = NEW.id ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM allocations a JOIN bank_transactions t ON t.id = a.transaction_id WHERE t.bank_account_id = NEW.id) THEN
      RAISE EXCEPTION 'Ein Umsatz des Kontos ist zugeordnet' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM bank_neutralizations n JOIN bank_transactions t ON t.id IN (n.transaction_id, n.counter_transaction_id)
       WHERE t.bank_account_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Ein Umsatz des Kontos ist verrechnet' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM write_offs w JOIN bank_transactions t ON t.id = w.transaction_id WHERE t.bank_account_id = NEW.id) THEN
      RAISE EXCEPTION 'Zu einem Umsatz des Kontos gibt es eine Ausbuchung' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_accounts_exclusion BEFORE UPDATE OF excluded_at ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_account_exclusion();
--> statement-breakpoint
-- Auf einem ausgeschlossenen Konto entsteht nichts mehr: weder ein Umsatz noch eine Zuordnung, Verrechnung oder Ausbuchung
CREATE OR REPLACE FUNCTION haben_check_account_included_for_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
     WHERE t.id = NEW.transaction_id AND a.excluded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Das Konto des Umsatzes ist ausgeschlossen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_konto_aktiv BEFORE INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_check_account_included_for_transaction();
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_konto_aktiv BEFORE INSERT ON bank_neutralizations
  FOR EACH ROW EXECUTE FUNCTION haben_check_account_included_for_transaction();
--> statement-breakpoint
CREATE TRIGGER write_offs_konto_aktiv BEFORE INSERT ON write_offs
  FOR EACH ROW EXECUTE FUNCTION haben_check_account_included_for_transaction();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_check_account_included_for_import() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM bank_accounts WHERE id = NEW.bank_account_id AND excluded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Das Konto ist ausgeschlossen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_transactions_konto_aktiv BEFORE INSERT ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION haben_check_account_included_for_import();
--> statement-breakpoint
CREATE TRIGGER bank_imports_konto_aktiv BEFORE INSERT ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION haben_check_account_included_for_import();
