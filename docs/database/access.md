# Household access database contract

Cloudflare Access JWTs must be verified by the server, including issuer and subject; `identity_subject` is the server's stable encoding of that verified issuer and subject. Never trust an identity or role supplied by the client. Membership and household status remain live in D1.

For a household-scoped mutation, put the following statement first in the same atomic D1 batch as the mutation, binding the verified identity and the target household:

```sql
INSERT INTO household_access_checks (household_id, identity_subject, required_role)
VALUES (?, ?, ?);
```

`required_role` is `member` (either active role) or `owner`. The assertion raises `household_access_denied` if the household or membership is inactive, the identity does not match, or the role is invalid or insufficient. The view stores no rows. Every subsequent statement must still constrain its own data to the target household; the assertion is not row-level security. Reads also need an active membership check. Place authorization and mutations in one batch to prevent a membership change between separate requests.

`household_invitations.token_hash` stores a SHA-256 hash of a high-entropy token, never the token itself. Email is normalized to lowercase by the application. An invitation reserves a slot only while pending and `expires_at` is greater than the database's current Unix time in seconds. Active members and unexpired pending invitations together cannot exceed two; at most one active member may be an owner. Pending invitations are unique per household and email even after expiry: revoke an expired pending invitation before creating another for that address. A capacity violation raises `household_capacity_exceeded`; a second active owner raises `household_owner_exists`.

To accept an invitation, put `INSERT INTO invitation_acceptance_checks (token_hash, email) VALUES (?, ?)` first in the atomic batch, using the hashed token and verified normalized email. It raises `invitation_invalid` unless the matching invitation is pending and unexpired, the household is active, and its inviting owner remains active. Inviting an already active member is rejected with `invitation_member_exists`. Then mark it accepted before inserting or activating its member. Set `accepted_by_member_id` after the member exists (the composite foreign key requires it); all operations must be in the same batch so a failure rolls back the acceptance. Use conditional updates and check affected rows to handle concurrent acceptance or revocation. Application operations must authorize invitation creation and revocation and enforce invitation lifecycle rules; constraints do not perform those checks.

Migration 0003 is additive and does not alter existing records. Triggers govern subsequent inserts and updates, but do not retroactively validate data created before this migration. Audit existing households for more than two active members or more than one active owner before deploying; resolve violations deliberately. Recovery should use a D1 backup or a forward migration; dropping these objects removes access enforcement and invitation data.
