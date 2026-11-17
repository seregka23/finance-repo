-- Currency locks survive transaction edits and voids. Older audit records can
-- retain the original account after posting_details has moved elsewhere.
ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991);
ALTER TABLE accounts ADD COLUMN currency_locked INTEGER NOT NULL DEFAULT 0 CHECK(currency_locked IN (0,1));
UPDATE accounts SET currency_locked=1 WHERE EXISTS (SELECT 1 FROM account_movements m WHERE m.household_id=accounts.household_id AND m.account_id=accounts.id AND m.type='transaction') OR EXISTS (SELECT 1 FROM posting_details d WHERE d.household_id=accounts.household_id AND d.account_id=accounts.id) OR EXISTS (SELECT 1 FROM audit_events e WHERE e.household_id=accounts.household_id AND e.transaction_id IS NOT NULL AND (json_extract(e.details_json,'$.accountId')=accounts.id OR json_extract(e.details_json,'$.before.accountId')=accounts.id OR json_extract(e.details_json,'$.after.accountId')=accounts.id));
CREATE TRIGGER accounts_lock_transaction AFTER INSERT ON account_movements WHEN NEW.type='transaction' BEGIN
 UPDATE accounts SET currency_locked=1 WHERE household_id=NEW.household_id AND id=NEW.account_id;
END;
CREATE TRIGGER accounts_currency_guard BEFORE UPDATE OF currency ON accounts WHEN NEW.currency<>OLD.currency BEGIN
 SELECT CASE WHEN OLD.currency_locked=1 OR EXISTS (SELECT 1 FROM reserves WHERE household_id=OLD.household_id AND account_id=OLD.id) OR EXISTS (SELECT 1 FROM reserve_movements WHERE household_id=OLD.household_id AND account_id=OLD.id) THEN RAISE(ABORT,'account_currency_locked') END;
END;
-- SQLite checks immediate foreign keys at the end of the parent statement.
CREATE TRIGGER accounts_currency_propagate AFTER UPDATE OF currency ON accounts WHEN NEW.currency<>OLD.currency BEGIN
 UPDATE account_movements SET currency=NEW.currency,rsd_equivalent_minor=NULL,exchange_rate=NULL,exchange_rate_source=NULL WHERE household_id=NEW.household_id AND account_id=NEW.id AND type IN ('opening_balance','adjustment');
END;
CREATE INDEX account_movements_page_idx ON account_movements(household_id,account_id,movement_date DESC,id DESC);
CREATE VIEW account_checks AS SELECT NULL AS household_id,NULL AS account_id,NULL AS version,NULL AS owner_id,NULL AS operation,NULL AS amount WHERE 0;
CREATE TRIGGER account_checks_insert INSTEAD OF INSERT ON account_checks BEGIN
 SELECT CASE WHEN NEW.operation<>'create' AND NOT EXISTS(SELECT 1 FROM accounts WHERE household_id=NEW.household_id AND id=NEW.account_id) THEN RAISE(ABORT,'account_not_found') END;
 SELECT CASE WHEN NEW.operation<>'create' AND NOT EXISTS(SELECT 1 FROM accounts WHERE household_id=NEW.household_id AND id=NEW.account_id AND version=NEW.version AND version<9007199254740991) THEN RAISE(ABORT,'account_version_conflict') END;
 SELECT CASE WHEN NEW.operation IN ('create','update') AND NEW.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM household_members WHERE household_id=NEW.household_id AND id=NEW.owner_id AND status='active') THEN RAISE(ABORT,'account_owner_ineligible') END;
 SELECT CASE WHEN NEW.operation IN ('adjust','update') AND NOT EXISTS(SELECT 1 FROM accounts WHERE household_id=NEW.household_id AND id=NEW.account_id AND status='active') THEN RAISE(ABORT,'account_ineligible') END;
 SELECT CASE WHEN NEW.operation='adjust' AND EXISTS(SELECT 1 FROM accounts a WHERE a.household_id=NEW.household_id AND a.id=NEW.account_id AND ((SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=a.household_id AND account_id=a.id)+CAST(NEW.amount AS INTEGER)-(SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=a.household_id AND account_id=a.id)<0 OR (SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=a.household_id AND account_id=a.id)+CAST(NEW.amount AS INTEGER)>9007199254740991)) THEN RAISE(ABORT,'account_balance_invalid') END;
END;
