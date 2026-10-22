-- Belege in Fremdwährung aus der Zeit vor den Umrechnungskursen: Die Auslesung hat die Beträge laut Beleg in net/tax
-- geschrieben, obwohl sie keine Euro sind. Sie werden zu Originalbeträgen; Euro gibt es erst mit dem Kurs. Gebucht werden
-- konnten solche Belege nicht, gesperrte (z. B. aus Lexoffice übernommene) bleiben unverändert.
UPDATE document_amounts a SET original_net = a.net, original_tax = a.tax, net = 0, tax = 0
  FROM documents d
 WHERE d.id = a.document_id AND d.currency <> 'EUR' AND d.locked_at IS NULL AND a.original_net IS NULL;
--> statement-breakpoint
UPDATE documents SET net = 0, tax = 0, gross = 0 WHERE currency <> 'EUR' AND locked_at IS NULL AND exchange_rate IS NULL;
