-- Posting assertions are write-only views. RAISE is legal inside triggers and
-- aborts the entire D1 batch, including any request claim and audit event.
CREATE TABLE posting_requests (
 id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, member_id TEXT NOT NULL,
 request_key TEXT NOT NULL, payload TEXT NOT NULL, response_json TEXT,
 UNIQUE(household_id, member_id, request_key),
 FOREIGN KEY(household_id, member_id) REFERENCES household_members(household_id, id)
);
CREATE TABLE posting_details (
 transaction_id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL,
 account_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
 currency TEXT NOT NULL, rsd_equivalent_minor INTEGER, exchange_rate TEXT, exchange_rate_source TEXT,
 FOREIGN KEY(household_id, transaction_id) REFERENCES transactions(household_id, id),
 FOREIGN KEY(household_id, account_id, currency) REFERENCES accounts(household_id, id, currency)
);
CREATE VIEW posting_request_checks AS SELECT NULL AS household_id, NULL AS member_id, NULL AS request_key, NULL AS payload WHERE 0;
CREATE TRIGGER posting_request_checks_insert INSTEAD OF INSERT ON posting_request_checks BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM posting_requests WHERE household_id=NEW.household_id AND member_id=NEW.member_id AND request_key=NEW.request_key AND payload=NEW.payload)
 THEN RAISE(ABORT, 'posting_key_conflict') END;
END;
CREATE VIEW posting_checks AS SELECT NULL AS household_id, NULL AS transaction_id, NULL AS version, NULL AS account_id, NULL AS currency, NULL AS category_id, NULL AS type, NULL AS amount_minor, NULL AS operation WHERE 0;
CREATE TRIGGER posting_checks_insert INSTEAD OF INSERT ON posting_checks BEGIN
 SELECT CASE WHEN NEW.operation <> 'post' AND NOT EXISTS (
   SELECT 1 FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id
   WHERE t.household_id=NEW.household_id AND t.id=NEW.transaction_id AND t.status='posted' AND t.version=NEW.version AND t.version<9007199254740991 AND t.type IN ('expense','income')
 ) THEN RAISE(ABORT, 'posting_version_conflict') END;
 SELECT CASE WHEN NEW.operation <> 'post' AND (
   EXISTS(SELECT 1 FROM transactions WHERE household_id=NEW.household_id AND (parent_transaction_id=NEW.transaction_id OR (id=NEW.transaction_id AND parent_transaction_id IS NOT NULL))) OR
   EXISTS(SELECT 1 FROM reserve_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   EXISTS(SELECT 1 FROM import_drafts WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   EXISTS(SELECT 1 FROM receipt_items WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   EXISTS(SELECT 1 FROM import_references WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) OR
   (SELECT count(*) FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id) <> 1
 ) THEN RAISE(ABORT, 'posting_linked') END;
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

-- Assert the completed writes, including statements suppressed by an IGNORE
-- trigger. This runs before the batch commits, so a missing row rolls back all.
CREATE VIEW posting_result_checks AS SELECT NULL AS household_id, NULL AS transaction_id,
 NULL AS version, NULL AS operation, NULL AS expected_json, NULL AS signed_amount,
 NULL AS signed_rsd, NULL AS positive_rsd, NULL AS audit_id, NULL AS claim_id WHERE 0;
CREATE TRIGGER posting_result_checks_insert INSTEAD OF INSERT ON posting_result_checks BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM transactions t JOIN posting_details d ON d.household_id=t.household_id AND d.transaction_id=t.id
  WHERE t.household_id=NEW.household_id AND t.id=NEW.transaction_id AND t.version=NEW.version
    AND t.status=CASE WHEN NEW.operation='void' THEN 'void' ELSE 'posted' END
    AND (NEW.operation='void' OR (
     t.type IS json_extract(NEW.expected_json,'$.type') AND t.transaction_date IS json_extract(NEW.expected_json,'$.transactionDate')
     AND t.category_id IS json_extract(NEW.expected_json,'$.categoryId') AND t.merchant IS json_extract(NEW.expected_json,'$.merchant')
     AND t.note IS json_extract(NEW.expected_json,'$.note') AND d.account_id IS json_extract(NEW.expected_json,'$.accountId')
     AND d.amount_minor=CAST(json_extract(NEW.expected_json,'$.amountMinor') AS INTEGER) AND d.currency IS json_extract(NEW.expected_json,'$.currency')
     AND d.exchange_rate IS json_extract(NEW.expected_json,'$.exchangeRate') AND d.exchange_rate_source IS json_extract(NEW.expected_json,'$.exchangeRateSource')
     AND d.rsd_equivalent_minor IS CAST(NEW.positive_rsd AS INTEGER)))
 ) THEN RAISE(ABORT,'posting_result_invalid') END;
 SELECT CASE WHEN NEW.operation='void' AND EXISTS (SELECT 1 FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)
  OR NEW.operation<>'void' AND ((SELECT count(*) FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id)<>1 OR NOT EXISTS (
   SELECT 1 FROM account_movements WHERE household_id=NEW.household_id AND transaction_id=NEW.transaction_id
    AND account_id IS json_extract(NEW.expected_json,'$.accountId') AND amount_minor=CAST(NEW.signed_amount AS INTEGER)
    AND currency IS json_extract(NEW.expected_json,'$.currency') AND movement_date IS json_extract(NEW.expected_json,'$.transactionDate')
    AND rsd_equivalent_minor IS CAST(NEW.signed_rsd AS INTEGER) AND exchange_rate IS json_extract(NEW.expected_json,'$.exchangeRate')
    AND exchange_rate_source IS json_extract(NEW.expected_json,'$.exchangeRateSource')
  )) THEN RAISE(ABORT,'posting_result_invalid') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM audit_events WHERE id=NEW.audit_id AND household_id=NEW.household_id AND transaction_id=NEW.transaction_id
   AND details_json IS NOT NULL AND (NEW.operation='post' OR (json_type(details_json,'$.before')='object' AND json_type(details_json,'$.after')='object'
   AND json_extract(details_json,'$.after.version')=NEW.version AND json_extract(details_json,'$.after.status')=CASE WHEN NEW.operation='void' THEN 'void' ELSE 'posted' END)))
  THEN RAISE(ABORT,'posting_result_invalid') END;
 SELECT CASE WHEN NEW.operation='post' AND NOT EXISTS (
  SELECT 1 FROM posting_requests p JOIN idempotency_keys k ON k.household_id=p.household_id AND k.member_id=p.member_id AND k.request_key=p.request_key
  WHERE p.id=NEW.claim_id AND p.household_id=NEW.household_id AND p.response_json IS NOT NULL AND json_valid(p.response_json)
    AND json_extract(p.response_json,'$.id')=NEW.transaction_id AND k.transaction_id=NEW.transaction_id
 ) THEN RAISE(ABORT,'posting_result_invalid') END;
END;
CREATE VIEW posting_replay_checks AS SELECT NULL AS household_id, NULL AS member_id, NULL AS request_key WHERE 0;
CREATE TRIGGER posting_replay_checks_insert INSTEAD OF INSERT ON posting_replay_checks BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM posting_requests WHERE household_id=NEW.household_id AND member_id=NEW.member_id AND request_key=NEW.request_key AND response_json IS NOT NULL AND json_valid(response_json))
 THEN RAISE(ABORT,'posting_result_invalid') END;
END;

-- changes() is evaluated by the top-level INSERT before entering this trigger;
-- it counts the immediately preceding top-level UPDATE or DELETE, even when
-- that statement was ignored by a BEFORE trigger.
CREATE VIEW posting_write_checks AS SELECT NULL AS changed WHERE 0;
CREATE TRIGGER posting_write_checks_insert INSTEAD OF INSERT ON posting_write_checks BEGIN
 SELECT CASE WHEN NEW.changed IS NOT 1 THEN RAISE(ABORT,'posting_result_invalid') END;
END;
