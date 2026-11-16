-- Additive household finance schema. Amounts are minor-unit integers constrained
-- to the range representable exactly by the D1 JavaScript binding. Dates are
-- business dates; *_at values are application-supplied audit timestamps.
-- Authorization, atomic posting, balance checks and refund limits belong to the API.

CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'RSD' CHECK (base_currency = 'RSD'),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Belgrade',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE household_members (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  identity_subject TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, identity_subject),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'card')),
  currency TEXT NOT NULL CHECK (currency IN ('RSD', 'EUR', 'RUB', 'USD')),
  owner_member_id TEXT,
  designation TEXT NOT NULL CHECK (designation IN ('personal', 'business')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, id, currency),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, owner_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
);

CREATE TABLE monthly_plans (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12'),
  category_id TEXT NOT NULL,
  limit_minor INTEGER NOT NULL CHECK (typeof(limit_minor) = 'integer' AND limit_minor BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, month, category_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer', 'fee', 'refund')),
  transaction_date TEXT NOT NULL CHECK (transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id TEXT,
  merchant TEXT,
  note TEXT,
  author_member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version BETWEEN 1 AND 9007199254740991),
  parent_transaction_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  CHECK (parent_transaction_id IS NULL OR parent_transaction_id <> id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, author_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, parent_transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);
CREATE INDEX transactions_household_date_id_idx ON transactions(household_id, transaction_date DESC, id DESC);

CREATE TABLE account_movements (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  transaction_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('transaction', 'opening_balance', 'adjustment')),
  movement_date TEXT NOT NULL CHECK (movement_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (currency IN ('RSD', 'EUR', 'RUB', 'USD')),
  rsd_equivalent_minor INTEGER CHECK (rsd_equivalent_minor IS NULL OR (typeof(rsd_equivalent_minor) = 'integer' AND rsd_equivalent_minor BETWEEN -9007199254740991 AND 9007199254740991)),
  exchange_rate TEXT CHECK (exchange_rate IS NULL OR (length(exchange_rate) > 0 AND exchange_rate NOT GLOB '*[^0-9.]*' AND exchange_rate NOT LIKE '%.%.%' AND substr(exchange_rate, 1, 1) <> '.' AND substr(exchange_rate, -1, 1) <> '.' AND length(replace(replace(exchange_rate, '0', ''), '.', '')) > 0)),
  exchange_rate_source TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  CHECK ((type = 'transaction' AND transaction_id IS NOT NULL) OR (type IN ('opening_balance', 'adjustment') AND transaction_id IS NULL)),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, account_id, currency) REFERENCES accounts(household_id, id, currency) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);
CREATE INDEX account_movements_account_idx ON account_movements(household_id, account_id);
CREATE INDEX account_movements_transaction_idx ON account_movements(household_id, transaction_id);

CREATE TABLE reserves (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, id, account_id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE reserve_movements (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  reserve_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  transaction_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('allocation', 'release', 'spend', 'reversal')),
  movement_date TEXT NOT NULL CHECK (movement_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  CHECK (type NOT IN ('spend', 'reversal') OR transaction_id IS NOT NULL),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, reserve_id, account_id) REFERENCES reserves(household_id, id, account_id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);
CREATE INDEX reserve_movements_reserve_idx ON reserve_movements(household_id, reserve_id);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  actor_member_id TEXT NOT NULL,
  action TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  monthly_plan_id TEXT,
  transaction_id TEXT,
  reserve_id TEXT,
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  CHECK ((account_id IS NOT NULL) + (category_id IS NOT NULL) + (monthly_plan_id IS NOT NULL) + (transaction_id IS NOT NULL) + (reserve_id IS NOT NULL) <= 1),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, actor_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, monthly_plan_id) REFERENCES monthly_plans(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, reserve_id) REFERENCES reserves(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE import_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  author_member_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  extracted_fields_json TEXT NOT NULL CHECK (json_valid(extracted_fields_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'discarded')),
  suggested_account_id TEXT,
  suggested_category_id TEXT,
  decision_provider TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, source_type, source_hash),
  UNIQUE (household_id, id, transaction_id),
  CHECK (status <> 'confirmed' OR transaction_id IS NOT NULL),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, author_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, suggested_account_id) REFERENCES accounts(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, suggested_category_id) REFERENCES categories(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE receipt_items (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  import_draft_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity TEXT,
  unit_price_minor INTEGER CHECK (unit_price_minor IS NULL OR (typeof(unit_price_minor) = 'integer' AND unit_price_minor BETWEEN 0 AND 9007199254740991)),
  line_total_minor INTEGER CHECK (line_total_minor IS NULL OR (typeof(line_total_minor) = 'integer' AND line_total_minor BETWEEN 0 AND 9007199254740991)),
  created_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, import_draft_id, transaction_id) REFERENCES import_drafts(household_id, id, transaction_id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE import_references (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  account_id TEXT,
  category_id TEXT,
  monthly_plan_id TEXT,
  transaction_id TEXT,
  reserve_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, id),
  UNIQUE (household_id, source_type, source_record_id),
  CHECK ((account_id IS NOT NULL) + (category_id IS NOT NULL) + (monthly_plan_id IS NOT NULL) + (transaction_id IS NOT NULL) + (reserve_id IS NOT NULL) = 1),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, monthly_plan_id) REFERENCES monthly_plans(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, reserve_id) REFERENCES reserves(household_id, id) ON DELETE RESTRICT
);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, member_id, request_key),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions(household_id, id) ON DELETE RESTRICT
);
