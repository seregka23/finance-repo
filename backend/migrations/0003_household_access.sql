-- Additive access metadata. JWT verification remains the application's responsibility.
ALTER TABLE household_members ADD COLUMN email TEXT CHECK (email IS NULL OR (length(email) > 0 AND email = lower(email)));
CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK (length(email) > 0 AND email = lower(email)),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer'),
  created_by_member_id TEXT NOT NULL,
  accepted_by_member_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, created_by_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (household_id, accepted_by_member_id) REFERENCES household_members(household_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX household_invitations_pending_email_idx
  ON household_invitations(household_id, email) WHERE status = 'pending';
CREATE INDEX household_invitations_slots_idx
  ON household_invitations(household_id, status, expires_at);

-- Active members and unexpired pending invitations share two available slots.
CREATE TRIGGER household_members_capacity_insert BEFORE INSERT ON household_members
WHEN NEW.status = 'active'
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM household_members WHERE household_id = NEW.household_id AND status = 'active') +
    (SELECT count(*) FROM household_invitations WHERE household_id = NEW.household_id AND status = 'pending' AND expires_at > unixepoch()) >= 2
    THEN RAISE(ABORT, 'household_capacity_exceeded') END;
  SELECT CASE WHEN NEW.role = 'owner' AND EXISTS (
    SELECT 1 FROM household_members WHERE household_id = NEW.household_id AND status = 'active' AND role = 'owner'
  ) THEN RAISE(ABORT, 'household_owner_exists') END;
END;
CREATE TRIGGER household_members_capacity_update BEFORE UPDATE ON household_members
WHEN NEW.status = 'active'
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM household_members WHERE household_id = NEW.household_id AND status = 'active' AND id <> OLD.id) +
    (SELECT count(*) FROM household_invitations WHERE household_id = NEW.household_id AND status = 'pending' AND expires_at > unixepoch()) >= 2
    THEN RAISE(ABORT, 'household_capacity_exceeded') END;
  SELECT CASE WHEN NEW.role = 'owner' AND EXISTS (
    SELECT 1 FROM household_members WHERE household_id = NEW.household_id AND status = 'active' AND role = 'owner' AND id <> OLD.id
  ) THEN RAISE(ABORT, 'household_owner_exists') END;
END;
CREATE TRIGGER household_invitations_capacity_insert BEFORE INSERT ON household_invitations
WHEN NEW.status = 'pending' AND NEW.expires_at > unixepoch()
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM household_members WHERE household_id = NEW.household_id AND status = 'active' AND email = NEW.email
  ) THEN RAISE(ABORT, 'invitation_member_exists') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM household_members WHERE household_id = NEW.household_id AND status = 'active') +
    (SELECT count(*) FROM household_invitations WHERE household_id = NEW.household_id AND status = 'pending' AND expires_at > unixepoch()) >= 2
    THEN RAISE(ABORT, 'household_capacity_exceeded') END;
END;
CREATE TRIGGER household_invitations_capacity_update BEFORE UPDATE ON household_invitations
WHEN NEW.status = 'pending' AND NEW.expires_at > unixepoch()
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM household_members WHERE household_id = NEW.household_id AND status = 'active') +
    (SELECT count(*) FROM household_invitations WHERE household_id = NEW.household_id AND status = 'pending' AND expires_at > unixepoch() AND id <> OLD.id) >= 2
    THEN RAISE(ABORT, 'household_capacity_exceeded') END;
END;

-- A write-only assertion; it stores no authorization state.
CREATE VIEW household_access_checks AS
  SELECT CAST(NULL AS TEXT) AS household_id, CAST(NULL AS TEXT) AS identity_subject,
         CAST(NULL AS TEXT) AS required_role WHERE 0;
CREATE TRIGGER household_access_checks_insert INSTEAD OF INSERT ON household_access_checks
BEGIN
  SELECT CASE WHEN NEW.required_role IS NULL OR NEW.required_role NOT IN ('member', 'owner') OR NOT EXISTS (
    SELECT 1 FROM household_members m JOIN households h ON h.id = m.household_id
    WHERE m.household_id = NEW.household_id AND m.identity_subject = NEW.identity_subject
      AND m.status = 'active' AND h.status = 'active'
      AND (NEW.required_role = 'member' OR m.role = 'owner')
  ) THEN RAISE(ABORT, 'household_access_denied') END;
END;

-- Assert invitation validity in the same batch before accepting it.
CREATE VIEW invitation_acceptance_checks AS
  SELECT CAST(NULL AS TEXT) AS token_hash, CAST(NULL AS TEXT) AS email WHERE 0;
CREATE TRIGGER invitation_acceptance_checks_insert INSTEAD OF INSERT ON invitation_acceptance_checks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM household_invitations i
    JOIN households h ON h.id = i.household_id AND h.status = 'active'
    JOIN household_members m ON m.household_id = i.household_id AND m.id = i.created_by_member_id AND m.status = 'active' AND m.role = 'owner'
    WHERE i.token_hash = NEW.token_hash AND i.email = NEW.email
      AND i.status = 'pending' AND i.expires_at > unixepoch()
  ) THEN RAISE(ABORT, 'invitation_invalid') END;
END;
