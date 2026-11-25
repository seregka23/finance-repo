-- Optional matching metadata; no full card numbers.
ALTER TABLE accounts ADD COLUMN bank_name TEXT;
ALTER TABLE accounts ADD COLUMN card_last_four TEXT;
CREATE TRIGGER accounts_import_metadata_insert BEFORE INSERT ON accounts
WHEN NOT ((NEW.bank_name IS NULL AND NEW.card_last_four IS NULL) OR
 (NEW.bank_name IS NOT NULL AND length(trim(NEW.bank_name))>0 AND NEW.bank_name=trim(NEW.bank_name)
  AND NEW.card_last_four IS NOT NULL AND length(NEW.card_last_four)=4 AND NEW.card_last_four NOT GLOB '*[^0-9]*'))
BEGIN SELECT RAISE(ABORT,'account_import_metadata_invalid'); END;
CREATE TRIGGER accounts_import_metadata_update BEFORE UPDATE OF bank_name,card_last_four ON accounts
WHEN NOT ((NEW.bank_name IS NULL AND NEW.card_last_four IS NULL) OR
 (NEW.bank_name IS NOT NULL AND length(trim(NEW.bank_name))>0 AND NEW.bank_name=trim(NEW.bank_name)
  AND NEW.card_last_four IS NOT NULL AND length(NEW.card_last_four)=4 AND NEW.card_last_four NOT GLOB '*[^0-9]*'))
BEGIN SELECT RAISE(ABORT,'account_import_metadata_invalid'); END;
CREATE INDEX accounts_import_match_idx ON accounts(household_id,card_last_four,currency,status) WHERE bank_name IS NOT NULL;

-- Legacy confirmed rows have no replay proof; only new transitions require it.
ALTER TABLE import_drafts ADD COLUMN confirmation_hash TEXT;
CREATE TRIGGER import_drafts_insert_guard BEFORE INSERT ON import_drafts
WHEN NEW.status='confirmed' OR NEW.confirmation_hash IS NOT NULL
BEGIN SELECT RAISE(ABORT,'import_confirmation_invalid'); END;
CREATE TRIGGER import_drafts_identity_guard BEFORE UPDATE ON import_drafts
WHEN NEW.id IS NOT OLD.id OR NEW.household_id IS NOT OLD.household_id OR NEW.author_member_id IS NOT OLD.author_member_id OR NEW.source_type IS NOT OLD.source_type OR NEW.source_hash IS NOT OLD.source_hash OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'import_identity_immutable'); END;
CREATE TRIGGER import_drafts_confirmed_update_guard BEFORE UPDATE ON import_drafts WHEN OLD.status='confirmed'
BEGIN SELECT RAISE(ABORT,'import_confirmed_immutable'); END;
CREATE TRIGGER import_drafts_confirmed_delete_guard BEFORE DELETE ON import_drafts WHEN OLD.status='confirmed'
BEGIN SELECT RAISE(ABORT,'import_confirmed_immutable'); END;
CREATE TRIGGER import_drafts_transition_guard BEFORE UPDATE ON import_drafts
WHEN OLD.status<>'confirmed' AND ((NEW.status='confirmed' AND (OLD.status<>'pending' OR NEW.transaction_id IS NULL OR NEW.confirmation_hash IS NULL OR length(NEW.confirmation_hash)<>64 OR NEW.confirmation_hash GLOB '*[^0-9a-f]*'))
 OR (NEW.status<>'confirmed' AND NEW.confirmation_hash IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'import_confirmation_invalid'); END;
-- The composite FK checks all three values; require confirmed status as well.
-- Insert receipt lines only after the draft transition in the same batch.
CREATE TRIGGER receipt_items_confirmed_insert BEFORE INSERT ON receipt_items
WHEN NOT EXISTS(SELECT 1 FROM import_drafts d WHERE d.household_id=NEW.household_id AND d.id=NEW.import_draft_id AND d.transaction_id=NEW.transaction_id AND d.status='confirmed')
BEGIN SELECT RAISE(ABORT,'receipt_draft_invalid'); END;
CREATE TRIGGER receipt_items_confirmed_update BEFORE UPDATE ON receipt_items
WHEN NOT EXISTS(SELECT 1 FROM import_drafts d WHERE d.household_id=NEW.household_id AND d.id=NEW.import_draft_id AND d.transaction_id=NEW.transaction_id AND d.status='confirmed')
BEGIN SELECT RAISE(ABORT,'receipt_draft_invalid'); END;
