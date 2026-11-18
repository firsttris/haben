-- Bankdubletten, Abrufbeobachtung und Bankentscheidung (#865).
-- #865: Nachträglich beobachtete Umsätze ergänzen nur die Herkunft, ohne einen Umsatz zu ändern.
CREATE TRIGGER bank_import_transactions_append_only BEFORE UPDATE OR DELETE ON bank_import_transactions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_import_transactions_audit AFTER INSERT ON bank_import_transactions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_import_transactions_no_truncate BEFORE TRUNCATE ON bank_import_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();

--> statement-breakpoint
-- #865: Der Abruf erzeugt einen offenen Vermerk, keine Änderung am Konto oder seinen Umsätzen.
CREATE FUNCTION haben_check_new_bank_duplicate_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision <> 'pending' OR NOT EXISTS (
    SELECT 1 FROM bank_transactions a JOIN bank_transactions b
      ON b.bank_account_id = a.bank_account_id AND b.import_id <> a.import_id
    WHERE a.id = NEW.transaction_id AND b.id = NEW.original_transaction_id
  ) THEN
    RAISE EXCEPTION 'Ein neuer Dublettenverdacht braucht dasselbe Konto und verschiedene Importe' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_reviews_check_insert BEFORE INSERT ON bank_duplicate_reviews
  FOR EACH ROW EXECUTE FUNCTION haben_check_new_bank_duplicate_review();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_reviews_append_only BEFORE UPDATE OR DELETE ON bank_duplicate_reviews
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_reviews_audit AFTER INSERT ON bank_duplicate_reviews
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_reviews_no_truncate BEFORE TRUNCATE ON bank_duplicate_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();

--> statement-breakpoint
-- #865: Die Bestandsprüfung endet einmalig; auch ein leerer Lauf wird protokolliert.
CREATE TRIGGER bank_duplicate_check_append_only BEFORE UPDATE OR DELETE ON bank_duplicate_check
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_check_audit AFTER INSERT ON bank_duplicate_check
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_check_no_truncate BEFORE TRUNCATE ON bank_duplicate_check
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();

--> statement-breakpoint
CREATE FUNCTION haben_active_bank_duplicate_decision(verdacht_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT d.id FROM bank_duplicate_decisions d
  WHERE d.review_id = verdacht_id AND d.reverses_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM bank_duplicate_decisions r WHERE r.reverses_id = d.id);
$$;
--> statement-breakpoint
CREATE FUNCTION haben_bank_duplicate(umsatz_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM bank_duplicate_reviews d
    JOIN bank_duplicate_decisions e ON e.id = haben_active_bank_duplicate_decision(d.id)
    WHERE d.transaction_id = umsatz_id AND e.decision = 'duplicate'
  );
$$;
--> statement-breakpoint
CREATE FUNCTION haben_bank_shared_fetch(left_id uuid, right_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT import_id FROM bank_transactions WHERE id = left_id
      UNION ALL SELECT bank_import_id FROM bank_import_transactions WHERE transaction_id = left_id
    ) seen WHERE seen.import_id IN (
      SELECT import_id FROM bank_transactions WHERE id = right_id
      UNION ALL SELECT bank_import_id FROM bank_import_transactions WHERE transaction_id = right_id
    )
  );
$$;
--> statement-breakpoint
-- Eine bestätigte Dublette kann kein Original sein. Gemeinsam gelieferte Zahlungen bleiben
-- auch dann eigenständig, wenn beide einem dritten Umsatz ähneln (#865, § 146 Abs. 1 und 4 AO).
CREATE FUNCTION haben_bank_duplicate_block_reason(candidate_id uuid, original_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN haben_bank_duplicate(original_id)
      THEN 'Der ähnliche Umsatz ist bereits als Dublette bestätigt.'
    WHEN EXISTS (
      SELECT 1 FROM bank_duplicate_reviews r
      JOIN bank_duplicate_decisions d ON d.id = haben_active_bank_duplicate_decision(r.id)
      WHERE r.original_transaction_id = candidate_id AND d.decision = 'duplicate'
    ) THEN 'Zu diesem Umsatz wurde bereits eine andere Dublette bestätigt.'
    WHEN EXISTS (
      SELECT 1 FROM bank_duplicate_reviews r
      JOIN bank_duplicate_decisions d ON d.id = haben_active_bank_duplicate_decision(r.id)
      WHERE r.original_transaction_id = original_id AND r.transaction_id <> candidate_id
        AND d.decision = 'duplicate' AND haben_bank_shared_fetch(candidate_id, r.transaction_id)
    ) THEN 'Die Bank hat diesen Umsatz gemeinsam mit einer bereits bestätigten Dublette zum selben Original geliefert.'
  END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_check_bank_duplicate_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d bank_duplicate_reviews%ROWTYPE;
  active_id uuid;
  blocking_reason text;
BEGIN
  SELECT * INTO STRICT d FROM bank_duplicate_reviews WHERE id = NEW.review_id;
  PERFORM 1 FROM bank_transactions WHERE id IN (d.transaction_id, d.original_transaction_id) ORDER BY id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE t.id = d.transaction_id AND a.excluded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Das Konto ist ausgeschlossen' USING ERRCODE = 'check_violation';
  END IF;
  active_id := haben_active_bank_duplicate_decision(d.id);
  IF NEW.reverses_id IS NOT NULL THEN
    IF NEW.reverses_id IS DISTINCT FROM active_id THEN
      RAISE EXCEPTION 'Die Entscheidung ist nicht mehr wirksam' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF active_id IS NOT NULL THEN
    RAISE EXCEPTION 'Der Dublettenverdacht ist bereits entschieden' USING ERRCODE = 'check_violation';
  END IF;
  IF haben_bank_shared_fetch(d.transaction_id, d.original_transaction_id) THEN
    RAISE EXCEPTION 'Beide Umsätze stammen aus einem gemeinsamen Abruf' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.decision = 'duplicate' THEN
    IF haben_bank_duplicate(d.transaction_id) THEN
      RAISE EXCEPTION 'Der Umsatz ist bereits als Dublette bestätigt' USING ERRCODE = 'check_violation';
    END IF;
    -- Die Entscheidungen teilen eine gesperrte Umsatzzeile, auch wenn ihr Verdachtspaar verschieden ist.
    blocking_reason := haben_bank_duplicate_block_reason(d.transaction_id, d.original_transaction_id);
    IF blocking_reason IS NOT NULL THEN
      RAISE EXCEPTION '%', blocking_reason USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM allocations a WHERE a.transaction_id = d.transaction_id AND a.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM allocations r WHERE r.reverses_id = a.id)) THEN
      RAISE EXCEPTION 'Erst die Zuordnung aufheben' USING ERRCODE = 'check_violation';
    END IF;
    IF haben_bank_neutralized(d.transaction_id) THEN
      RAISE EXCEPTION 'Erst die Verrechnung aufheben' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM write_offs w WHERE w.transaction_id = d.transaction_id AND w.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM write_offs r WHERE r.reverses_id = w.id)) THEN
      RAISE EXCEPTION 'Erst die Ausbuchung aufheben' USING ERRCODE = 'check_violation';
    END IF;
    -- Store-Auszahlungen verknüpfen ihre Erlösanteile über die Referenz statt über eine Zuordnung.
    IF EXISTS (
      SELECT 1 FROM bank_transactions t
      JOIN bank_accounts a ON a.id = t.bank_account_id
      JOIN store_payouts p ON p.store = a.provider AND t.bank_reference = ANY(p.covered)
      WHERE t.id = d.transaction_id
    ) THEN
      RAISE EXCEPTION 'Der Umsatz gehört zu einer bereits übernommenen Store-Auszahlung' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_decisions_check BEFORE INSERT ON bank_duplicate_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_duplicate_decision();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_decisions_append_only BEFORE UPDATE OR DELETE ON bank_duplicate_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_decisions_audit AFTER INSERT ON bank_duplicate_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_duplicate_decisions_no_truncate BEFORE TRUNCATE ON bank_duplicate_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
--> statement-breakpoint
CREATE FUNCTION haben_check_bank_operation_not_duplicate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  counter_id uuid;
BEGIN
  IF NEW.reverses_id IS NOT NULL OR NEW.transaction_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'bank_neutralizations' THEN
    counter_id := NEW.counter_transaction_id;
  END IF;
  PERFORM 1 FROM bank_transactions WHERE id IN (NEW.transaction_id, counter_id) ORDER BY id FOR UPDATE;
  IF haben_bank_duplicate(NEW.transaction_id) OR haben_bank_duplicate(counter_id) THEN
    RAISE EXCEPTION 'Erst die Dublettenmarkierung aufheben' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_not_duplicate BEFORE INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_operation_not_duplicate();
--> statement-breakpoint
CREATE TRIGGER write_offs_not_duplicate BEFORE INSERT ON write_offs
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_operation_not_duplicate();
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_not_duplicate BEFORE INSERT ON bank_neutralizations
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_operation_not_duplicate();
