# Category database contract

Categories belong to a household and have an immutable `expense` or `income` type. Names may be changed and status may be set to `archived`; historical records retain the same category ID and display its current name. Archived categories remain available for historical references but are not eligible for new selections. The application does not provide a hard-delete API. Existing foreign keys with `ON DELETE RESTRICT` protect referenced history; there is no additional delete trigger.

For a new category selection, first assert active membership with `HouseholdAccessService.batch` and then put this assertion before the dependent write in that same atomic D1 batch:

```sql
INSERT INTO category_selection_checks (household_id, category_id, usage)
VALUES (?, ?, ?);
```

The view stores no rows. `usage` is the purpose of the selection, not the category type: `expense`, `fee`, `refund`, and `budget` require an active expense category in the same household; `income` requires an active income category in the same household. `transfer` accepts only a null category and offers no category options. Invalid or null usage, a null household, a missing category for other usages, an archived category, a type mismatch, or a category from another household raises `category_not_eligible`. A transfer assertion alone does not establish that the household exists or that the caller is a member; the separate membership assertion must come first. Each subsequent statement must still scope its data to the household.

The category options API should return only active, same-household categories eligible for the requested usage; transfer returns no options. Management may rename, archive, or reactivate categories, but changing type raises `category_type_immutable`, including when the category has never been referenced. Create a separate category when a different type is needed.

Migration 0004 adds the view and triggers without modifying or seeding records. It does not retroactively validate existing references; it guards operations that explicitly use the assertion and future type changes. Older application versions that do not call the assertion remain structurally compatible but do not enforce selection eligibility, so deploy compatible application code together with the migration. If correction is needed, prefer a reviewed forward migration; dropping enforcement objects removes these protections, and reverting application code does not undo database changes. Follow the backup and recovery guidance in [migrations.md](migrations.md).
