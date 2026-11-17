# Household settings surface brief

Issue #5 extends the existing Family Finance interface with sign-in, household
membership, invitations and revocation. This is an ordinary UI extension in
**Operate** mode: manage an existing shared household, or create its initial
empty workspace. It introduces no new visual identity or design system.

## Authority and scope

- Product authority: the supplied `family-finance-technical-spec.md`, especially
  household access, navigation, security and acceptance criteria, plus issue #5.
  The specification places household settings and invitations in profile access.
  This implementation exposes settings directly and through the Profile menu;
  the six financial screens remain in later feature issues.
- Visual authority: [DESIGN.md](../../DESIGN.md) and the preserved
  [HTML reference](../design/family-finance-design.html). The reference's demo
  records and calculations do not define application data or behavior.
- Implementation authority: [application shell](../../frontend/src/app/app.html),
  [settings template](../../frontend/src/app/settings.html) and
  [global styles](../../frontend/src/styles.css). Authentication and API details
  are documented in [Sign-in and household access](../authentication.md).
- The incumbent design reference and saved template remain unchanged. This
  surface brief does not require `PRODUCT.md` or a design-system JSON sidecar.

## User and task

The household holds up to two active or invited people. An owner can create the
household, change its name and time zone, invite the second person, cancel a
pending invitation and revoke another member's access. Members can inspect the
shared household details and people; owner-only settings actions are omitted
from their view. The specification allows both members to view and edit
household financial data. Account ownership supports display and filtering;
it does not establish account-level secrecy.

The task order is household details, people, then invitation management. Desktop
places details and people in the wider left column and invitations on the right.
Mobile stacks these sections and keeps the single implemented navigation item
in a bottom bar. The shell's native disclosure labeled “Profile” reveals the
signed-in email, Household settings link and Sign out link. A household selector
appears when the signed-in person belongs to more than one household.

## Behavior and states

- Signed-out visitors see a public welcome with Sign in and Create account.
  Inline forms use email/password, registration confirmation and pending/error
  states. Sign out revokes the server session before clearing the interface.
- A person without a household can create one. A new household contains an owner
  and no synthetic accounts, transactions, budgets or reserves. The base currency
  is RSD; the default time zone is Europe/Belgrade.
- Owners edit name and optional IANA time zone; members see labeled read-only
  values. Saving and accepting expose pending states. Success uses a status
  message; errors use an alert and relevant retry controls.
- Invitation creation returns a private link for manual sharing. The invitee
  signs in using the invited email and explicitly accepts. The fragment token is
  removed from the address and temporarily retained through sign-in. Tokens are
  returned once, expire after 48 hours and are single-use. Cancellation is
  available for pending invitations.
- Revocation asks for confirmation with “Yes, revoke” and “Keep.” Revoking
  household access is distinct from signing out of the identity provider.

## Incumbent visual treatment

Preserve the navy navigation, pale paper background, indigo primary actions,
white bordered panels and restrained danger text from the existing reference.
Reuse the established CSS tokens rather than introducing a parallel palette.
The surface retains the Instrument Sans/Inter/system fallback stack, 14px body,
38px desktop title, 31px mobile title, 19px section headings, 14px panel corners
and 8px controls. Panels use borders rather than decorative elevation.

The shell follows the incumbent 222px sidebar, 185px narrower sidebar and 62px
icon rail before moving navigation to the bottom at 680px. Forms become one
column with 15px mobile side padding and bottom clearance. Long identities wrap;
labels, visible focus, text statuses and native controls carry meaning beyond
color. Preserve these relationships when extending this surface.

## Evidence and disposition

The integration verification and independent review reported **SHIP**, with no
material defects. Reported browser checks passed household creation, settings
save, invitation creation, fragment-link acceptance, the shared member view and
revocation against the actual Worker and local D1 with signed JWT fixtures.
The final browser pass also checked opening Profile and visibility of its links.
Automated axe checks reported zero WCAG A/AA violations on the three captured
screens, and viewport checks reported no horizontal overflow.

The following local screenshots were inspected for this brief:

| Capture | Evidence |
| --- | --- |
| Desktop owner settings | [Desktop](../verification/issue-5/desktop.png) — details, people and invitation columns |
| Mobile owner settings | [Mobile](../verification/issue-5/mobile.png) — stacked sections, wrapped identity and bottom navigation |
| Newly created household | [New household](../verification/issue-5/new-household.png) — creation confirmation and sole active owner |

These images are verification artifacts, not seeded product records. The
browser flow and accessibility results above are the integration team's
reported checks; this documentation pass inspected the source and screenshots
and did not rerun those checks. The context launcher/detector was unavailable
during this work, as recorded by the orchestrator.

The original issue #5 evidence above used Access fixtures. Native registration
now replaces that provider; see [authentication](../authentication.md) and the
[native authentication acceptance record](../verification/native-auth.md).
This original record does not claim
implementation or testing of all financial screens, financial workflows or
account-specific privacy controls.
