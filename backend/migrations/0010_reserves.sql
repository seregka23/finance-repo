-- Additive marker: only transactions with no legacy reserve history may opt in.
CREATE TABLE reserve_funding_managed (
 transaction_id TEXT PRIMARY KEY NOT NULL,
 household_id TEXT NOT NULL,
 UNIQUE(household_id,transaction_id),
 FOREIGN KEY(household_id,transaction_id) REFERENCES transactions(household_id,id)
);
CREATE TRIGGER reserve_funding_managed_insert BEFORE INSERT ON reserve_funding_managed BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE household_id=NEW.household_id AND id=NEW.transaction_id AND type='expense' AND status='posted') OR EXISTS(SELECT 1 FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) THEN RAISE(ABORT,'reserve_funding_legacy_or_invalid') END;
END;
CREATE TRIGGER reserve_funding_managed_no_update BEFORE UPDATE ON reserve_funding_managed BEGIN SELECT RAISE(ABORT,'reserve_funding_immutable'); END;
CREATE TRIGGER reserve_funding_managed_no_delete BEFORE DELETE ON reserve_funding_managed BEGIN SELECT RAISE(ABORT,'reserve_funding_immutable'); END;
CREATE INDEX reserve_movements_transaction_idx ON reserve_movements(household_id,transaction_id,reserve_id);
CREATE INDEX reserve_movements_account_idx ON reserve_movements(household_id,account_id);
CREATE TRIGGER account_reserve_archive BEFORE UPDATE OF status ON accounts WHEN OLD.status='active' AND NEW.status='archived' BEGIN
 SELECT CASE WHEN (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=OLD.household_id AND account_id=OLD.id)<>0 THEN RAISE(ABORT,'account_reserve_nonzero') END;
END;
-- Every operation is checked inside the same D1 batch before the insert.
CREATE VIEW reserve_checks AS SELECT NULL household_id,NULL reserve_id,NULL account_id,NULL transaction_id,NULL operation,NULL amount_minor WHERE 0;
CREATE TRIGGER reserve_checks_insert INSTEAD OF INSERT ON reserve_checks BEGIN
 SELECT CASE WHEN NEW.operation NOT IN ('create','allocation','release','spend','reversal') THEN RAISE(ABORT,'reserve_operation_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND a.id=NEW.account_id AND a.status='active') THEN RAISE(ABORT,'reserve_account_ineligible') END;
 SELECT CASE WHEN NEW.operation<>'create' AND NOT EXISTS(SELECT 1 FROM reserves r WHERE r.household_id=NEW.household_id AND r.id=NEW.reserve_id AND r.account_id=NEW.account_id AND r.status='active') THEN RAISE(ABORT,'reserve_ineligible') END;
 SELECT CASE WHEN NEW.operation<>'create' AND (typeof(NEW.amount_minor)<>'integer' OR NEW.amount_minor NOT BETWEEN 1 AND 9007199254740991) THEN RAISE(ABORT,'reserve_amount_invalid') END;
 SELECT CASE WHEN NEW.operation IN ('allocation','release') AND NEW.transaction_id IS NOT NULL THEN RAISE(ABORT,'reserve_operation_invalid') END;
 SELECT CASE WHEN NEW.operation IN ('spend','reversal') AND NOT EXISTS(SELECT 1 FROM reserve_funding_managed f JOIN transactions t ON t.household_id=f.household_id AND t.id=f.transaction_id WHERE f.household_id=NEW.household_id AND f.transaction_id=NEW.transaction_id AND t.type='expense' AND t.status='posted') THEN RAISE(ABORT,'reserve_funding_invalid') END;
 SELECT CASE WHEN NEW.operation='allocation' AND ((SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=NEW.household_id AND account_id=NEW.account_id) - (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND account_id=NEW.account_id) < NEW.amount_minor OR (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND reserve_id=NEW.reserve_id) > 9007199254740991-NEW.amount_minor) THEN RAISE(ABORT,'reserve_balance_invalid') END;
 SELECT CASE WHEN NEW.operation IN ('release','spend') AND (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND reserve_id=NEW.reserve_id)<NEW.amount_minor THEN RAISE(ABORT,'reserve_balance_invalid') END;
 SELECT CASE WHEN NEW.operation='reversal' AND (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND reserve_id=NEW.reserve_id AND transaction_id=NEW.transaction_id)>-NEW.amount_minor THEN RAISE(ABORT,'reserve_funding_invalid') END;
 SELECT CASE WHEN NEW.operation='reversal' AND (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND reserve_id=NEW.reserve_id)>9007199254740991-NEW.amount_minor THEN RAISE(ABORT,'reserve_balance_invalid') END;
END;
-- Check the exact row after INSERT, including when another trigger ignores it.
CREATE VIEW reserve_movement_result_checks AS SELECT NULL id,NULL household_id,NULL reserve_id,NULL account_id,NULL transaction_id,NULL operation,NULL amount_minor WHERE 0;
CREATE TRIGGER reserve_movement_result_checks_insert INSTEAD OF INSERT ON reserve_movement_result_checks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reserve_movements m WHERE m.id=NEW.id AND m.household_id=NEW.household_id AND m.reserve_id=NEW.reserve_id AND m.account_id=NEW.account_id AND m.transaction_id IS NEW.transaction_id AND m.type=NEW.operation AND m.amount_minor=CASE WHEN NEW.operation IN ('allocation','reversal') THEN NEW.amount_minor ELSE -NEW.amount_minor END) THEN RAISE(ABORT,'reserve_result_invalid') END;
END;
-- Invoke after the complete posting, and after the existing posting_result_checks.
CREATE VIEW reserve_funding_result_checks AS SELECT NULL household_id,NULL transaction_id,NULL reserve_id,NULL account_id,NULL amount_minor WHERE 0;
CREATE TRIGGER reserve_funding_result_checks_insert INSTEAD OF INSERT ON reserve_funding_result_checks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reserve_funding_managed WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR typeof(NEW.amount_minor)<>'integer' OR NEW.amount_minor NOT BETWEEN 0 AND 9007199254740991 THEN RAISE(ABORT,'reserve_result_invalid') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reserve_movements m WHERE m.household_id=NEW.household_id AND m.transaction_id=NEW.transaction_id GROUP BY m.reserve_id HAVING SUM(m.amount_minor)>0 OR (SUM(m.amount_minor)<0 AND (m.reserve_id IS NOT NEW.reserve_id OR m.account_id IS NOT NEW.account_id))) OR -(SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)<>NEW.amount_minor THEN RAISE(ABORT,'reserve_result_invalid') END;
 SELECT CASE WHEN NEW.amount_minor>0 AND NOT EXISTS(SELECT 1 FROM transactions t JOIN posting_details d ON d.household_id=t.household_id AND d.transaction_id=t.id JOIN reserves r ON r.household_id=t.household_id AND r.id=NEW.reserve_id AND r.account_id=d.account_id JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id WHERE t.household_id=NEW.household_id AND t.id=NEW.transaction_id AND t.type='expense' AND t.status='posted' AND d.account_id=NEW.account_id AND d.currency=a.currency AND d.amount_minor>=NEW.amount_minor) THEN RAISE(ABORT,'reserve_result_invalid') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND a.id IN (SELECT account_id FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) AND ((SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=a.household_id AND account_id=a.id) - (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=a.household_id AND account_id=a.id)<0 OR (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=a.household_id AND account_id=a.id)>9007199254740991)) THEN RAISE(ABORT,'reserve_balance_invalid') END;
END;
-- Retain all 0009 guards, except for histories explicitly enrolled above.
DROP TRIGGER posting_checks_insert;
DROP VIEW posting_checks;
CREATE VIEW posting_checks AS SELECT NULL household_id,NULL transaction_id,NULL version,NULL account_id,NULL currency,NULL category_id,NULL type,NULL amount_minor,NULL operation,NULL reserve_adjusted WHERE 0;
CREATE TRIGGER posting_checks_insert INSTEAD OF INSERT ON posting_checks BEGIN
 SELECT CASE WHEN NEW.operation <> 'post' AND NOT EXISTS (
   SELECT 1 FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id
   WHERE t.household_id=NEW.household_id AND t.id=NEW.transaction_id AND t.status='posted' AND t.version=NEW.version AND t.version<9007199254740991 AND t.type IN ('expense','income')
 ) THEN RAISE(ABORT, 'posting_version_conflict') END;
 SELECT CASE WHEN NEW.operation <> 'post' AND (
   EXISTS(SELECT 1 FROM transactions WHERE household_id=NEW.household_id AND ((parent_transaction_id=NEW.transaction_id AND NOT (type='refund' AND EXISTS (SELECT 1 FROM refund_details rd WHERE rd.household_id=transactions.household_id AND rd.transaction_id=transactions.id AND rd.purchase_transaction_id=NEW.transaction_id))) OR (id=NEW.transaction_id AND parent_transaction_id IS NOT NULL))) OR
   (EXISTS(SELECT 1 FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) AND NOT (NEW.reserve_adjusted IS 1 AND EXISTS(SELECT 1 FROM reserve_funding_managed WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id))) OR
   EXISTS(SELECT 1 FROM import_drafts WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   EXISTS(SELECT 1 FROM receipt_items WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   EXISTS(SELECT 1 FROM import_references WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   (SELECT count(*) FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) <> 1
 ) THEN RAISE(ABORT, 'posting_linked') END;
 -- Posted refunds protect their purchase snapshot and its remaining ceiling.
 SELECT CASE WHEN NEW.operation <> 'post' AND EXISTS (
   SELECT 1 FROM transactions r WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.transaction_id AND r.type='refund' AND r.status='posted'
 ) AND (NEW.operation='void' OR NEW.type<>'expense' OR NEW.currency IS NOT (SELECT currency FROM posting_details WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)
 OR NEW.category_id IS NOT (SELECT category_id FROM transactions WHERE household_id=NEW.household_id AND id=NEW.transaction_id)
 OR -CAST(NEW.amount_minor AS INTEGER) < (SELECT COALESCE(SUM(d.amount_minor),0) FROM transactions r JOIN posting_details d ON d.household_id=r.household_id AND d.transaction_id=r.id WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.transaction_id AND r.type='refund' AND r.status='posted'))
 THEN RAISE(ABORT,'posting_refunds_conflict') END;
 SELECT CASE WHEN NEW.operation <> 'void' AND NOT EXISTS (
   SELECT 1 FROM accounts WHERE household_id=NEW.household_id AND id=NEW.account_id AND status='active' AND currency=NEW.currency
 ) THEN RAISE(ABORT, 'posting_account_ineligible') END;
 -- Editing or voiding also writes the old account's ledger. Archived accounts
 -- must be reactivated before any effective financial write can change them.
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND a.status<>'active'
     AND a.id IN (SELECT account_id FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)
 ) THEN RAISE(ABORT, 'posting_account_ineligible') END;
 SELECT CASE WHEN NEW.operation <> 'void' AND NOT EXISTS (
   SELECT 1 FROM categories WHERE household_id=NEW.household_id AND id=NEW.category_id AND status='active' AND type=NEW.type
 ) THEN RAISE(ABORT, 'posting_category_ineligible') END;
 -- Examine both affected accounts after removing the old movement and applying
 -- the proposed one. Integer SUM overflow aborts safely instead of rounding.
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND
     (a.id=NEW.account_id OR a.id IN (SELECT account_id FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)) AND (
       (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements m WHERE m.household_id=a.household_id AND m.account_id=a.id AND (m.transaction_id IS NULL OR m.transaction_id<>NEW.transaction_id))
       + CASE WHEN NEW.operation <> 'void' AND a.id=NEW.account_id THEN CAST(NEW.amount_minor AS INTEGER) ELSE 0 END
       - (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements r WHERE r.household_id=a.household_id AND r.account_id=a.id)
       < 0 OR
       (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements m WHERE m.household_id=a.household_id AND m.account_id=a.id AND (m.transaction_id IS NULL OR m.transaction_id<>NEW.transaction_id))
       + CASE WHEN NEW.operation <> 'void' AND a.id=NEW.account_id THEN CAST(NEW.amount_minor AS INTEGER) ELSE 0 END > 9007199254740991
     )
 ) THEN RAISE(ABORT, 'posting_balance_invalid') END;
END;