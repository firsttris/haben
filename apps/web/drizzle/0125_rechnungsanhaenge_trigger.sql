-- Zusätzliche Anhänge an Ausgangsrechnungen (#272): Sie sind mit der Rechnung festgeschrieben wie Positionen und
-- Steuerzeilen, jede Änderung steht im Audit-Log, und ab jetzt festgeschriebene Rechnungen schließen sie in ihr Siegel
-- ein. Siegel-Funktionen wie in 0109; ein Siegel enthält die Anhänge nur, wenn seine Spalten sie nennen, ältere Siegel
-- bleiben also gültig.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE FUNCTION haben_reject_locked_invoice_attachment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND locked_at IS NOT NULL) THEN
    locked := OLD.invoice_id;
  ELSIF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND locked_at IS NOT NULL) THEN
    locked := NEW.invoice_id;
  END IF;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben, Anhänge sind unveränderlich', locked USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_attachments_locked BEFORE INSERT OR UPDATE OR DELETE ON invoice_attachments
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_invoice_attachment();
--> statement-breakpoint
CREATE TRIGGER invoice_attachments_audit AFTER INSERT OR UPDATE OR DELETE ON invoice_attachments
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
      'documents', haben_columns('documents'), 'document_amounts', haben_columns('document_amounts'))
    WHEN 'vat_returns' THEN jsonb_build_object('vat_returns', haben_columns('vat_returns'))
    WHEN 'cash_entries' THEN jsonb_build_object('cash_entries', haben_columns('cash_entries'))
    WHEN 'allocations' THEN jsonb_build_object('allocations', haben_columns('allocations'))
    WHEN 'pauschalen' THEN jsonb_build_object('pauschalen', haben_columns('pauschalen'))
    WHEN 'asset_depreciations' THEN jsonb_build_object('asset_depreciations', haben_columns('asset_depreciations'))
    WHEN 'document_cancellations' THEN jsonb_build_object('document_cancellations', haben_columns('document_cancellations'))
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
    ELSE
      RAISE EXCEPTION 'Für % gibt es kein Siegel', tbl;
  END CASE;
  RETURN encode(sha256(convert_to(content::text, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
