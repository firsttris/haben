-- Lohn (docs/lohn-plan.md, PR 3): Stammdaten der Mitarbeiter und Lohnläufe sind änderbar, jede Änderung im Audit-Log.
-- Eine Abrechnung ist bis zum Festschreiben ein Entwurf; ab locked_at gesperrt (haben_reject_locked aus 0001) und
-- versiegelt wie eine Rechnung (haben_seal aus 0063). Korrigiert wird nur mit einem Storno in payslip_cancellations
-- (nur anhängbar, versiegelt wie document_cancellations aus 0109) und einer neuen Abrechnung desselben Monats.
-- Siegel-Funktionen und Integritätsprüfung wie in 0109, um payslips und payslip_cancellations erweitert.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_seal_columns(tbl text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE tbl
    WHEN 'journal_entries' THEN jsonb_build_object(
      'journal_entries', haben_columns('journal_entries'), 'journal_lines', haben_columns('journal_lines'))
    WHEN 'invoices' THEN jsonb_build_object(
      'invoices', haben_columns('invoices'), 'invoice_lines', haben_columns('invoice_lines'),
      'invoice_taxes', haben_columns('invoice_taxes'))
    WHEN 'documents' THEN jsonb_build_object(
      'documents', haben_columns('documents'), 'document_amounts', haben_columns('document_amounts'))
    WHEN 'vat_returns' THEN jsonb_build_object('vat_returns', haben_columns('vat_returns'))
    WHEN 'cash_entries' THEN jsonb_build_object('cash_entries', haben_columns('cash_entries'))
    WHEN 'allocations' THEN jsonb_build_object('allocations', haben_columns('allocations'))
    WHEN 'pauschalen' THEN jsonb_build_object('pauschalen', haben_columns('pauschalen'))
    WHEN 'asset_depreciations' THEN jsonb_build_object('asset_depreciations', haben_columns('asset_depreciations'))
    WHEN 'document_cancellations' THEN jsonb_build_object('document_cancellations', haben_columns('document_cancellations'))
    WHEN 'payslips' THEN jsonb_build_object('payslips', haben_columns('payslips'))
    WHEN 'payslip_cancellations' THEN jsonb_build_object('payslip_cancellations', haben_columns('payslip_cancellations'))
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_seal_digest(tbl text, rid uuid, cols jsonb) RETURNS text
LANGUAGE plpgsql STABLE
SET TimeZone = 'UTC' SET bytea_output = 'hex' SET IntervalStyle = 'postgres' SET extra_float_digits = 1
AS $$
DECLARE
  content jsonb;
BEGIN
  CASE tbl
    WHEN 'journal_entries' THEN
      content := jsonb_build_object(
        'journal_entries', (SELECT haben_pick(to_jsonb(e), cols -> 'journal_entries') FROM journal_entries e WHERE e.id = rid),
        'journal_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'journal_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM journal_lines l WHERE l.entry_id = rid));
    WHEN 'invoices' THEN
      content := jsonb_build_object(
        'invoices', (SELECT haben_pick(to_jsonb(i), cols -> 'invoices') FROM invoices i WHERE i.id = rid),
        'invoice_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'invoice_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM invoice_lines l WHERE l.invoice_id = rid),
        'invoice_taxes', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(t), cols -> 'invoice_taxes') ORDER BY t.rate), '[]'::jsonb)
                            FROM invoice_taxes t WHERE t.invoice_id = rid));
    WHEN 'documents' THEN
      content := jsonb_build_object(
        'documents', (SELECT haben_pick(to_jsonb(d), cols -> 'documents') FROM documents d WHERE d.id = rid),
        'document_amounts', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'document_amounts') ORDER BY a.id), '[]'::jsonb)
                               FROM document_amounts a WHERE a.document_id = rid));
    WHEN 'vat_returns' THEN
      content := jsonb_build_object(
        'vat_returns', (SELECT haben_pick(to_jsonb(v), cols -> 'vat_returns') FROM vat_returns v WHERE v.id = rid));
    WHEN 'cash_entries' THEN
      content := jsonb_build_object(
        'cash_entries', (SELECT haben_pick(to_jsonb(c), cols -> 'cash_entries') FROM cash_entries c WHERE c.id = rid));
    WHEN 'allocations' THEN
      content := jsonb_build_object(
        'allocations', (SELECT haben_pick(to_jsonb(a), cols -> 'allocations') FROM allocations a WHERE a.id = rid));
    WHEN 'pauschalen' THEN
      content := jsonb_build_object(
        'pauschalen', (SELECT haben_pick(to_jsonb(p), cols -> 'pauschalen') FROM pauschalen p WHERE p.id = rid));
    WHEN 'asset_depreciations' THEN
      content := jsonb_build_object(
        'asset_depreciations', (SELECT haben_pick(to_jsonb(d), cols -> 'asset_depreciations') FROM asset_depreciations d WHERE d.id = rid));
    WHEN 'document_cancellations' THEN
      content := jsonb_build_object(
        'document_cancellations', (SELECT haben_pick(to_jsonb(c), cols -> 'document_cancellations') FROM document_cancellations c WHERE c.id = rid));
    WHEN 'payslips' THEN
      content := jsonb_build_object(
        'payslips', (SELECT haben_pick(to_jsonb(p), cols -> 'payslips') FROM payslips p WHERE p.id = rid));
    WHEN 'payslip_cancellations' THEN
      content := jsonb_build_object(
        'payslip_cancellations', (SELECT haben_pick(to_jsonb(c), cols -> 'payslip_cancellations') FROM payslip_cancellations c WHERE c.id = rid));
    ELSE
      RAISE EXCEPTION 'Für % gibt es kein Siegel', tbl;
  END CASE;
  RETURN encode(sha256(convert_to(content::text, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_integrity_problems(max_rows integer DEFAULT 100)
RETURNS TABLE (art text, tabelle text, zeile text, seq bigint, befund text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tbl text;
  locked text;
BEGIN
  RETURN QUERY
  SELECT 'kette'::text, 'audit_log'::text, c.id::text, c.seq,
    CASE
      WHEN c.seq <> coalesce(c.before_seq, 0) + 1 THEN format('Lücke: auf Eintrag %s folgt %s', coalesce(c.before_seq, 0), c.seq)
      WHEN c.prev_hash IS DISTINCT FROM coalesce(c.before_hash, haben_audit_genesis()) THEN 'Verweis auf den Vorgänger passt nicht'
      ELSE 'Inhalt passt nicht zum Hash'
    END
  FROM (
    SELECT a.id, a.seq, a.prev_hash, a.row_hash, haben_audit_hash(a.prev_hash, a) AS calc,
           lag(a.seq) OVER w AS before_seq, lag(a.row_hash) OVER w AS before_hash
      FROM audit_log a
    WINDOW w AS (ORDER BY a.seq)
  ) c
  WHERE c.seq <> coalesce(c.before_seq, 0) + 1
     OR c.prev_hash IS DISTINCT FROM coalesce(c.before_hash, haben_audit_genesis())
     OR c.row_hash IS DISTINCT FROM c.calc
  ORDER BY c.seq
  LIMIT max_rows;

  RETURN QUERY
  SELECT 'kopf'::text, 'audit_chain'::text, NULL::text, h.seq,
    CASE
      WHEN h.id IS NULL THEN 'Kopf der Kette fehlt'
      WHEN last.seq IS DISTINCT FROM h.seq THEN format('Kopf steht bei %s, das Audit-Log endet bei %s', h.seq, last.seq)
      ELSE 'Kopf passt nicht zum letzten Eintrag'
    END
  FROM (SELECT 1) one
  LEFT JOIN audit_chain h ON true
  LEFT JOIN LATERAL (SELECT a.seq, a.row_hash FROM audit_log a ORDER BY a.seq DESC LIMIT 1) last ON true
  WHERE h.id IS NULL OR last.seq IS DISTINCT FROM h.seq OR last.row_hash IS DISTINCT FROM h.hash;

  FOREACH tbl IN ARRAY ARRAY['journal_entries', 'invoices', 'documents', 'vat_returns', 'cash_entries',
                             'allocations', 'pauschalen', 'asset_depreciations', 'document_cancellations',
                             'payslips', 'payslip_cancellations'] LOOP
    locked := CASE WHEN tbl IN ('cash_entries', 'allocations', 'pauschalen', 'asset_depreciations', 'document_cancellations',
                                'payslip_cancellations') THEN 'true'
                   ELSE 't.locked_at IS NOT NULL' END;
    RETURN QUERY EXECUTE format($q$
      (SELECT 'siegel'::text, %1$L::text, s.row_id::text, NULL::bigint,
         CASE
           WHEN t.id IS NULL THEN 'Versiegelter Datensatz fehlt'
           WHEN NOT (%2$s) THEN 'Festschreibung aufgehoben'
           ELSE 'Inhalt passt nicht zum Siegel'
         END
         FROM seals s
         LEFT JOIN %1$I t ON t.id = s.row_id
        WHERE s.table_name = %1$L
          AND (t.id IS NULL OR NOT (%2$s) OR haben_seal_digest(s.table_name, s.row_id, s.columns) <> s.digest)
        ORDER BY s.id
        LIMIT $1)
      UNION ALL
      (SELECT 'siegel'::text, %1$L::text, t.id::text, NULL::bigint, 'Festgeschrieben, aber ohne Siegel'
         FROM %1$I t
        WHERE %2$s
          AND NOT EXISTS (SELECT 1 FROM seals s WHERE s.table_name = %1$L AND s.row_id = t.id)
        ORDER BY t.id
        LIMIT $1)
    $q$, tbl, locked) USING max_rows;
  END LOOP;

  -- Ein Siegel gilt nur so, wie es in der Kette steht
  RETURN QUERY
  SELECT 'siegel'::text, s.table_name, s.row_id::text, a.seq,
    CASE WHEN a.id IS NULL THEN 'Siegel fehlt im Audit-Log' ELSE 'Siegel weicht vom Eintrag im Audit-Log ab' END
    FROM seals s
    LEFT JOIN audit_log a ON a.table_name = 'seals' AND a.row_id = s.id::text AND a.action = 'INSERT'
   WHERE a.id IS NULL
      OR a.new_value ->> 'digest' IS DISTINCT FROM s.digest
      OR a.new_value -> 'columns' IS DISTINCT FROM s.columns
      OR a.new_value ->> 'row_id' IS DISTINCT FROM s.row_id::text
      OR a.new_value ->> 'table_name' IS DISTINCT FROM s.table_name
   ORDER BY s.id
   LIMIT max_rows;
END;
$$;
--> statement-breakpoint
--> statement-breakpoint
-- Je Mitarbeiter und Monat höchstens eine Abrechnung, die nicht storniert ist; eine neue Abrechnung nach einem Storno
-- verweist auf die stornierte desselben Mitarbeiters und Monats. Die App sperrt den Mitarbeiter vorher (FOR UPDATE) und
-- meldet dasselbe verständlich; der Trigger fängt, was an ihr vorbei geschrieben wird.
CREATE FUNCTION haben_check_payslip() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payslips p
     WHERE p.employee_id = NEW.employee_id AND p.year = NEW.year AND p.month = NEW.month AND p.id <> NEW.id
       AND NOT EXISTS (SELECT 1 FROM payslip_cancellations c WHERE c.payslip_id = p.id)
  ) THEN
    RAISE EXCEPTION 'Für Mitarbeiter % gibt es im Monat %/% schon eine Abrechnung', NEW.employee_id, NEW.month, NEW.year
      USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payslips p JOIN payslip_cancellations c ON c.payslip_id = p.id
     WHERE p.id = NEW.replaces_id AND p.employee_id = NEW.employee_id AND p.year = NEW.year AND p.month = NEW.month
  ) THEN
    RAISE EXCEPTION 'Abrechnung % ist keine stornierte Abrechnung desselben Mitarbeiters und Monats', NEW.replaces_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslips_check BEFORE INSERT ON payslips
  FOR EACH ROW EXECUTE FUNCTION haben_check_payslip();
--> statement-breakpoint
CREATE TRIGGER payslips_locked BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked();
--> statement-breakpoint
CREATE TRIGGER payslips_audit AFTER INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER payslips_seal AFTER UPDATE OF locked_at ON payslips
  FOR EACH ROW WHEN (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER payslips_seal_insert AFTER INSERT ON payslips
  FOR EACH ROW WHEN (NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
-- Nur festgeschriebene Abrechnungen lassen sich stornieren; die App prüft dasselbe vorher mit verständlicher Meldung
CREATE FUNCTION haben_check_payslip_cancellation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payslips p WHERE p.id = NEW.payslip_id AND p.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Abrechnung % ist nicht festgeschrieben und lässt sich nicht stornieren', NEW.payslip_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payslip_cancellations_check BEFORE INSERT ON payslip_cancellations
  FOR EACH ROW EXECUTE FUNCTION haben_check_payslip_cancellation();
--> statement-breakpoint
CREATE TRIGGER payslip_cancellations_append_only BEFORE UPDATE OR DELETE ON payslip_cancellations
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER payslip_cancellations_audit AFTER INSERT ON payslip_cancellations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER payslip_cancellations_seal AFTER INSERT ON payslip_cancellations
  FOR EACH ROW EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER employees_audit AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER payroll_runs_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
