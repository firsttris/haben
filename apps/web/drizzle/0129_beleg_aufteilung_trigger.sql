-- Aufteilung eines Belegs auf mehrere Kontierungszeilen (#271): Die Zeilen sind ab dem Buchen gesperrt wie die Beträge
-- (haben_reject_locked_document_amount aus 0005 prüft nur den Beleg), stehen im Audit-Log und gehören zum Siegel des
-- Belegs. Siegel-Funktionen wie in 0127_lohn_trigger (mit Rechnungsanhängen und Lohn), für Belege um document_splits erweitert; ein Siegel ohne diesen Schlüssel in
-- seiner Spaltenliste (vor dieser Migration gebucht) wird wie bisher gebildet und bleibt gültig.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER document_splits_locked BEFORE INSERT OR UPDATE OR DELETE ON document_splits
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_document_amount();
--> statement-breakpoint
CREATE TRIGGER document_splits_audit AFTER INSERT OR UPDATE OR DELETE ON document_splits
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_seal_columns(tbl text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE tbl
    WHEN 'journal_entries' THEN jsonb_build_object(
      'journal_entries', haben_columns('journal_entries'), 'journal_lines', haben_columns('journal_lines'))
    WHEN 'invoices' THEN jsonb_build_object(
      'invoices', haben_columns('invoices'), 'invoice_lines', haben_columns('invoice_lines'),
      'invoice_taxes', haben_columns('invoice_taxes'), 'invoice_attachments', haben_columns('invoice_attachments'))
    WHEN 'documents' THEN jsonb_build_object(
      'documents', haben_columns('documents'), 'document_amounts', haben_columns('document_amounts'),
      'document_splits', haben_columns('document_splits'))
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
                            FROM invoice_taxes t WHERE t.invoice_id = rid))
        -- Nur Siegel ab 0125 kennen die Anhänge; ältere Siegel ergeben so denselben Inhalt wie bisher
        || CASE WHEN cols ? 'invoice_attachments' THEN jsonb_build_object(
             'invoice_attachments', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'invoice_attachments') ORDER BY a.id), '[]'::jsonb)
                                       FROM invoice_attachments a WHERE a.invoice_id = rid))
           ELSE '{}'::jsonb END;
    WHEN 'documents' THEN
      content := jsonb_build_object(
        'documents', (SELECT haben_pick(to_jsonb(d), cols -> 'documents') FROM documents d WHERE d.id = rid),
        'document_amounts', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'document_amounts') ORDER BY a.id), '[]'::jsonb)
                               FROM document_amounts a WHERE a.document_id = rid));
      -- Aufteilung (#271) nur in Siegeln, deren Spaltenliste sie nennt: Ältere Siegel behalten ihren Hash
      IF cols ? 'document_splits' THEN
        content := content || jsonb_build_object(
          'document_splits', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(s), cols -> 'document_splits') ORDER BY s.position), '[]'::jsonb)
                                FROM document_splits s WHERE s.document_id = rid));
      END IF;
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
SELECT set_config('haben.actor', '', true);
