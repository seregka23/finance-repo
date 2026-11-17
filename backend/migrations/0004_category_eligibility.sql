-- A write-only assertion for a category selected for a new operation.
-- Authorization must be asserted separately, first in the same batch.
CREATE VIEW category_selection_checks AS
  SELECT CAST(NULL AS TEXT) AS household_id, CAST(NULL AS TEXT) AS category_id,
         CAST(NULL AS TEXT) AS usage WHERE 0;
CREATE TRIGGER category_selection_checks_insert INSTEAD OF INSERT ON category_selection_checks
BEGIN
  SELECT CASE WHEN NEW.household_id IS NOT NULL AND (
    (NEW.usage = 'transfer' AND NEW.category_id IS NULL) OR
    (NEW.usage IN ('expense', 'fee', 'refund', 'budget', 'income') AND EXISTS (
      SELECT 1 FROM categories c
      WHERE c.household_id = NEW.household_id AND c.id = NEW.category_id
        AND c.status = 'active'
        AND c.type = CASE WHEN NEW.usage = 'income' THEN 'income' ELSE 'expense' END
    ))
  ) THEN 1 ELSE RAISE(ABORT, 'category_not_eligible') END;
END;

-- Category identity and historical references retain their original type.
CREATE TRIGGER category_type_immutable BEFORE UPDATE OF type ON categories
WHEN NEW.type <> OLD.type
BEGIN
  SELECT RAISE(ABORT, 'category_type_immutable');
END;
