-- Additive refund metadata. Existing transactions are not rewritten.
CREATE TABLE refund_details (
 transaction_id TEXT PRIMARY KEY NOT NULL,
 household_id TEXT NOT NULL,
 purchase_transaction_id TEXT NOT NULL,
 allocation_sequence INTEGER NOT NULL CHECK(typeof(allocation_sequence)='integer' AND allocation_sequence BETWEEN 1 AND 9007199254740991),
 UNIQUE(household_id, transaction_id),
 UNIQUE(household_id, purchase_transaction_id, allocation_sequence),
 CHECK(transaction_id<>purchase_transaction_id),
 FOREIGN KEY(household_id, transaction_id) REFERENCES transactions(household_id, id),
 FOREIGN KEY(household_id, purchase_transaction_id) REFERENCES transactions(household_id, id)
);
CREATE TRIGGER refund_details_link_insert BEFORE INSERT ON refund_details BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM transactions r JOIN transactions p ON p.household_id=r.household_id AND p.id=r.parent_transaction_id WHERE r.household_id=NEW.household_id AND r.id=NEW.transaction_id AND r.type='refund' AND p.id=NEW.purchase_transaction_id AND p.type='expense') THEN RAISE(ABORT,'refund_link_invalid') END;
END;
CREATE TRIGGER refund_details_link_immutable BEFORE UPDATE ON refund_details BEGIN
 SELECT RAISE(ABORT,'refund_link_immutable');
END;
-- Keep the original rate/source immutable while posted refunds exist. The RSD
-- amount itself may change on a purchase amount edit, at that same rate.
CREATE TRIGGER refund_purchase_snapshot_guard BEFORE UPDATE ON posting_details
WHEN EXISTS (SELECT 1 FROM transactions r WHERE r.household_id=OLD.household_id AND r.parent_transaction_id=OLD.transaction_id AND r.type='refund' AND r.status='posted')
 AND (NEW.currency IS NOT OLD.currency OR NEW.exchange_rate IS NOT OLD.exchange_rate OR NEW.exchange_rate_source IS NOT OLD.exchange_rate_source)
BEGIN SELECT RAISE(ABORT,'posting_refunds_conflict'); END;
DROP TRIGGER posting_checks_insert;
CREATE TRIGGER posting_checks_insert INSTEAD OF INSERT ON posting_checks BEGIN
 SELECT CASE WHEN NEW.operation <> 'post' AND NOT EXISTS (
   SELECT 1 FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id
   WHERE t.household_id=NEW.household_id AND t.id=NEW.transaction_id AND t.status='posted' AND t.version=NEW.version AND t.version<9007199254740991 AND t.type IN ('expense','income')
 ) THEN RAISE(ABORT, 'posting_version_conflict') END;
 SELECT CASE WHEN NEW.operation <> 'post' AND (
   EXISTS(SELECT 1 FROM transactions WHERE household_id=NEW.household_id AND ((parent_transaction_id=NEW.transaction_id AND NOT (type='refund' AND EXISTS (SELECT 1 FROM refund_details rd WHERE rd.household_id=transactions.household_id AND rd.transaction_id=transactions.id AND rd.purchase_transaction_id=NEW.transaction_id))) OR (id=NEW.transaction_id AND parent_transaction_id IS NOT NULL))) OR
   EXISTS(SELECT 1 FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
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


-- JSON snapshots are bound parameters. See docs/database/refunds.md for exact fields.
CREATE VIEW refund_checks AS SELECT NULL household_id,NULL transaction_id,NULL purchase_id,NULL version,NULL operation,NULL before_json,NULL expected_json WHERE 0;
CREATE TRIGGER refund_checks_insert INSTEAD OF INSERT ON refund_checks BEGIN
 SELECT CASE WHEN NEW.operation NOT IN ('post','edit','void') OR NOT json_valid(NEW.before_json) OR NOT json_valid(NEW.expected_json) THEN RAISE(ABORT,'refund_snapshot_invalid') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM transactions p JOIN posting_details d ON d.household_id=p.household_id AND d.transaction_id=p.id
  WHERE p.household_id=NEW.household_id AND p.id=NEW.purchase_id AND p.type='expense' AND p.status='posted'
   AND p.version=json_extract(NEW.before_json,'$.purchase.version') AND p.version<9007199254740991
   AND p.category_id IS json_extract(NEW.before_json,'$.purchase.categoryId')
   AND EXISTS(SELECT 1 FROM categories c WHERE c.household_id=p.household_id AND c.id=p.category_id AND c.type='expense')
   AND d.amount_minor=CAST(json_extract(NEW.before_json,'$.purchase.amountMinor') AS INTEGER)
   AND d.currency IS json_extract(NEW.before_json,'$.purchase.currency')
   AND d.exchange_rate IS json_extract(NEW.before_json,'$.purchase.exchangeRate')
   AND d.exchange_rate_source IS json_extract(NEW.before_json,'$.purchase.exchangeRateSource')
   AND d.rsd_equivalent_minor IS CAST(json_extract(NEW.before_json,'$.purchase.rsdEquivalentMinor') AS INTEGER)
   AND d.rsd_equivalent_minor IS NOT NULL AND (d.currency='RSD' OR d.exchange_rate IS NOT NULL)
 ) THEN RAISE(ABORT,'refund_purchase_conflict') END;
 SELECT CASE WHEN json_type(NEW.before_json,'$.refunds')<>'array' OR
 (SELECT count(*) FROM transactions r WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.purchase_id AND r.type='refund')<>(SELECT count(*) FROM json_each(NEW.before_json,'$.refunds')) OR
 EXISTS (SELECT 1 FROM json_each(NEW.before_json,'$.refunds') j WHERE NOT EXISTS (
  SELECT 1 FROM transactions r JOIN refund_details rd ON rd.household_id=r.household_id AND rd.transaction_id=r.id
  JOIN posting_details d ON d.household_id=r.household_id AND d.transaction_id=r.id
  WHERE r.household_id=NEW.household_id AND r.id=json_extract(j.value,'$.id') AND r.parent_transaction_id=NEW.purchase_id AND r.type='refund' AND rd.purchase_transaction_id=NEW.purchase_id
   AND r.status IS json_extract(j.value,'$.status') AND r.version=json_extract(j.value,'$.version')
   AND rd.allocation_sequence=CAST(json_extract(j.value,'$.sequence') AS INTEGER)
   AND d.amount_minor=CAST(json_extract(j.value,'$.amountMinor') AS INTEGER)
   AND d.rsd_equivalent_minor IS CAST(json_extract(j.value,'$.rsdEquivalentMinor') AS INTEGER)
 )) OR (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.before_json,'$.refunds'))<>(SELECT count(*) FROM json_each(NEW.before_json,'$.refunds'))
 THEN RAISE(ABORT,'refund_snapshot_conflict') END;
 SELECT CASE WHEN NEW.operation<>'post' AND NOT EXISTS (SELECT 1 FROM transactions r JOIN refund_details rd ON rd.household_id=r.household_id AND rd.transaction_id=r.id WHERE r.household_id=NEW.household_id AND r.id=NEW.transaction_id AND r.type='refund' AND r.status='posted' AND r.version=NEW.version AND r.version<9007199254740991 AND r.parent_transaction_id=NEW.purchase_id AND rd.purchase_transaction_id=NEW.purchase_id) THEN RAISE(ABORT,'refund_version_conflict') END;
 SELECT CASE WHEN NEW.operation<>'post' AND (EXISTS(SELECT 1 FROM transactions WHERE household_id=NEW.household_id AND parent_transaction_id=NEW.transaction_id) OR EXISTS(SELECT 1 FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR EXISTS(SELECT 1 FROM import_drafts WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR EXISTS(SELECT 1 FROM receipt_items WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR EXISTS(SELECT 1 FROM import_references WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR (SELECT count(*) FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)<>1) THEN RAISE(ABORT,'refund_linked') END;
 SELECT CASE WHEN NEW.operation<>'void' AND (CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) IS NULL OR CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) NOT BETWEEN 1 AND 9007199254740991 OR NOT EXISTS(SELECT 1 FROM accounts WHERE household_id=NEW.household_id AND id=json_extract(NEW.expected_json,'$.accountId') AND status='active' AND currency=json_extract(NEW.before_json,'$.purchase.currency'))) THEN RAISE(ABORT,'refund_account_or_amount_invalid') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM account_movements m JOIN accounts a ON a.household_id=m.household_id AND a.id=m.account_id WHERE m.household_id=NEW.household_id AND m.transaction_id=NEW.transaction_id AND a.status<>'active') THEN RAISE(ABORT,'refund_account_or_amount_invalid') END;
 SELECT CASE WHEN (SELECT COALESCE(SUM(d.amount_minor),0) FROM transactions r JOIN posting_details d ON d.household_id=r.household_id AND d.transaction_id=r.id WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.purchase_id AND r.type='refund' AND r.status='posted' AND r.id<>NEW.transaction_id) + CASE WHEN NEW.operation='void' THEN 0 ELSE CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) END > CAST(json_extract(NEW.before_json,'$.purchase.amountMinor') AS INTEGER) THEN RAISE(ABORT,'refund_ceiling_invalid') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND (a.id=json_extract(NEW.expected_json,'$.accountId') OR a.id IN (SELECT account_id FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)) AND (
 (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements m WHERE m.household_id=a.household_id AND m.account_id=a.id AND (m.transaction_id IS NULL OR m.transaction_id<>NEW.transaction_id)) + CASE WHEN NEW.operation<>'void' AND a.id=json_extract(NEW.expected_json,'$.accountId') THEN CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) ELSE 0 END - (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements v WHERE v.household_id=a.household_id AND v.account_id=a.id)<0 OR
 (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements m WHERE m.household_id=a.household_id AND m.account_id=a.id AND (m.transaction_id IS NULL OR m.transaction_id<>NEW.transaction_id)) + CASE WHEN NEW.operation<>'void' AND a.id=json_extract(NEW.expected_json,'$.accountId') THEN CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) ELSE 0 END>9007199254740991)) THEN RAISE(ABORT,'refund_balance_invalid') END;
END;

CREATE VIEW refund_count_checks AS SELECT NULL changed,NULL expected WHERE 0;
CREATE TRIGGER refund_count_checks_insert INSTEAD OF INSERT ON refund_count_checks BEGIN
 SELECT CASE WHEN NEW.changed IS NOT NEW.expected OR NEW.expected<0 THEN RAISE(ABORT,'refund_result_invalid') END;
END;
-- after_json contains the complete set, not just changed refunds.
CREATE VIEW refund_result_checks AS SELECT NULL household_id,NULL transaction_id,NULL purchase_id,NULL operation,NULL before_json,NULL after_json,NULL claim_id WHERE 0;
CREATE TRIGGER refund_result_checks_insert INSTEAD OF INSERT ON refund_result_checks BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.after_json) OR json_type(NEW.after_json,'$.refunds')<>'array' OR json_type(NEW.after_json,'$.audits')<>'array' THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions p JOIN posting_details d ON d.household_id=p.household_id AND d.transaction_id=p.id WHERE p.household_id=NEW.household_id AND p.id=NEW.purchase_id AND p.status='posted' AND p.type='expense' AND p.version=json_extract(NEW.after_json,'$.purchase.version') AND p.category_id IS json_extract(NEW.after_json,'$.purchase.categoryId') AND d.amount_minor=CAST(json_extract(NEW.after_json,'$.purchase.amountMinor') AS INTEGER) AND d.currency IS json_extract(NEW.after_json,'$.purchase.currency') AND d.exchange_rate IS json_extract(NEW.after_json,'$.purchase.exchangeRate') AND d.exchange_rate_source IS json_extract(NEW.after_json,'$.purchase.exchangeRateSource') AND d.rsd_equivalent_minor IS CAST(json_extract(NEW.after_json,'$.purchase.rsdEquivalentMinor') AS INTEGER)) THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN (SELECT count(*) FROM transactions r WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.purchase_id AND r.type='refund')<>(SELECT count(*) FROM json_each(NEW.after_json,'$.refunds')) OR (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.after_json,'$.refunds'))<>(SELECT count(*) FROM json_each(NEW.after_json,'$.refunds')) OR EXISTS (SELECT 1 FROM json_each(NEW.after_json,'$.refunds') j WHERE NOT EXISTS (
 SELECT 1 FROM transactions r JOIN refund_details rd ON rd.household_id=r.household_id AND rd.transaction_id=r.id JOIN posting_details d ON d.household_id=r.household_id AND d.transaction_id=r.id
 WHERE r.household_id=NEW.household_id AND r.id=json_extract(j.value,'$.id') AND r.type='refund' AND r.parent_transaction_id=NEW.purchase_id AND rd.purchase_transaction_id=NEW.purchase_id AND rd.allocation_sequence=CAST(json_extract(j.value,'$.sequence') AS INTEGER)
 AND r.status IS json_extract(j.value,'$.status') AND r.version=json_extract(j.value,'$.version') AND r.transaction_date IS json_extract(j.value,'$.transactionDate') AND (r.status='void' OR r.category_id IS json_extract(NEW.after_json,'$.purchase.categoryId')) AND r.merchant IS json_extract(j.value,'$.merchant') AND r.note IS json_extract(j.value,'$.note')
 AND d.account_id IS json_extract(j.value,'$.accountId') AND d.amount_minor=CAST(json_extract(j.value,'$.amountMinor') AS INTEGER) AND (r.status='void' OR (d.currency IS json_extract(NEW.after_json,'$.purchase.currency') AND d.exchange_rate IS json_extract(NEW.after_json,'$.purchase.exchangeRate') AND d.exchange_rate_source IS json_extract(NEW.after_json,'$.purchase.exchangeRateSource'))) AND d.rsd_equivalent_minor IS CAST(json_extract(j.value,'$.rsdEquivalentMinor') AS INTEGER)
 AND ((r.status='void' AND NOT EXISTS(SELECT 1 FROM account_movements m WHERE m.household_id=r.household_id AND m.transaction_id=r.id)) OR (r.status='posted' AND (SELECT count(*) FROM account_movements m WHERE m.household_id=r.household_id AND m.transaction_id=r.id)=1 AND EXISTS(SELECT 1 FROM account_movements m WHERE m.household_id=r.household_id AND m.transaction_id=r.id AND m.type='transaction' AND m.account_id=d.account_id AND m.currency=d.currency AND m.amount_minor=d.amount_minor AND m.rsd_equivalent_minor IS d.rsd_equivalent_minor AND m.exchange_rate IS d.exchange_rate AND m.exchange_rate_source IS d.exchange_rate_source AND m.movement_date=r.transaction_date)))
 )) THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN (SELECT COALESCE(SUM(d.amount_minor),0) FROM transactions r JOIN posting_details d ON d.household_id=r.household_id AND d.transaction_id=r.id WHERE r.household_id=NEW.household_id AND r.parent_transaction_id=NEW.purchase_id AND r.type='refund' AND r.status='posted')>CAST(json_extract(NEW.after_json,'$.purchase.amountMinor') AS INTEGER) THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.refunds') j WHERE json_extract(j.value,'$.id')=NEW.transaction_id AND json_extract(j.value,'$.status')=CASE WHEN NEW.operation='void' THEN 'void' ELSE 'posted' END) OR NOT EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.audits') j WHERE json_extract(j.value,'$.transactionId')=NEW.transaction_id) OR NOT EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.audits') j WHERE json_extract(j.value,'$.transactionId')=NEW.purchase_id) OR EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.audits') j WHERE NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.household_id=NEW.household_id AND a.id=json_extract(j.value,'$.id') AND a.transaction_id=json_extract(j.value,'$.transactionId') AND a.actor_member_id IS json_extract(j.value,'$.actorMemberId') AND a.action IS json_extract(j.value,'$.action') AND a.details_json IS json_extract(j.value,'$.detailsJson') AND json_valid(a.details_json) AND json_type(a.details_json,'$.after')='object' AND json_extract(a.details_json,'$.after.version')=json_extract(j.value,'$.version') AND (json_extract(j.value,'$.beforeRequired')=0 OR json_type(a.details_json,'$.before')='object'))) THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN NOT json_valid(NEW.before_json) OR json_extract(NEW.after_json,'$.purchase.version')<>json_extract(NEW.before_json,'$.purchase.version')+1 OR EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.refunds') a JOIN json_each(NEW.before_json,'$.refunds') b ON json_extract(a.value,'$.id')=json_extract(b.value,'$.id') WHERE json_extract(a.value,'$.rsdEquivalentMinor') IS NOT json_extract(b.value,'$.rsdEquivalentMinor') AND (json_extract(a.value,'$.version')<>json_extract(b.value,'$.version')+1 OR NOT EXISTS(SELECT 1 FROM json_each(NEW.after_json,'$.audits') x WHERE json_extract(x.value,'$.transactionId')=json_extract(a.value,'$.id') AND json_extract(x.value,'$.version')=json_extract(a.value,'$.version') AND json_extract(x.value,'$.beforeRequired')=1))) THEN RAISE(ABORT,'refund_result_invalid') END;
 SELECT CASE WHEN NEW.operation='post' AND NOT EXISTS(SELECT 1 FROM posting_requests p JOIN idempotency_keys k ON k.household_id=p.household_id AND k.member_id=p.member_id AND k.request_key=p.request_key WHERE p.id=NEW.claim_id AND p.household_id=NEW.household_id AND json_valid(p.response_json) AND json_extract(p.response_json,'$.id')=NEW.transaction_id AND json_extract(p.response_json,'$.purchaseTransactionId')=NEW.purchase_id AND json_extract(p.response_json,'$.type')='refund' AND k.transaction_id=NEW.transaction_id) THEN RAISE(ABORT,'refund_result_invalid') END;
END;
