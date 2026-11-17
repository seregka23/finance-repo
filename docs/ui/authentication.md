# Public welcome and native authentication

Mode: **Operate**. This ordinary extension follows [DESIGN.md](../../DESIGN.md)
and the preserved [Family Finance template](../design/family-finance-design.html).
It adds public welcome, email/password registration, sign-in and sign-out within
the existing shell. It does not establish a new visual identity or change the
design reference. No `PRODUCT.md` is present; this brief records implemented
surface behavior rather than inferred product strategy.

## Choices and forms

The public panel presents “Family Finance”, a short household-finance description,
primary **Sign in** and secondary **Create account** actions. Navigation and
Profile appear only with a session. Choosing either form focuses Email address;
the text action below the form switches modes and clears the previous auth error.

Both forms have explicit Email address and Password labels, native required/email
validation and autocomplete hints. Email accepts up to 254 characters. Registration
adds Confirm password and the visible “Use 12 to 128 characters” hint. The password
field references that hint through `aria-describedby`, keeping its accessible
name simply “Password”. Registration fields require 12–128 characters; sign-in
allows existing passwords up to 128 characters. Confirmation mismatch shows
“Passwords do not match. Please check and try again.” before submission.

Submission disables the primary action and mode switch, with “Signing in…” or
“Creating account…” text. Authentication failures appear inside the form with
`role="alert"`. Successful authentication clears the form and loads the session.
Workspace loading has `role="status"`; broader load errors offer Retry and Reload
page. A configuration failure presents a temporary-unavailability message and
Try again, rather than identity-provider setup instructions.

## Visual and responsive behavior

The panel retains white surfaces, pale paper background, navy text/sidebar,
indigo actions, existing type and rounded geometry. Desktop centers a compact
form in the content area; at 680px and below the panel uses 24px padding and 16px
vertical margin within the shell's 15px side gutters. Forms stay in one column,
with full-width fields and submit actions; the welcome choices wrap when needed.
The existing narrow/mobile shell treatment remains in place.

Keyboard focus uses the shared indigo outline (2px with 3px offset). Auth field
boundaries use the existing muted color, scoped to the welcome form: the review
record reports 6.48:1 against white after a low-contrast boundary finding. The
six final captures show these darker boundaries and the focused email field.
This targeted accessibility adjustment preserves the reference palette.

## Session and invitation behavior

Refresh restores an existing session. Signed-in navigation, household selection
when applicable, email identity and the Profile menu return with it. Profile's
Sign out returns to the public choices after success; a failed logout displays
an error and retains the current UI. Account creation alone does not create or
grant access to an existing household.

A pending invitation adds a notice asking visitors to use the invited email.
Its token is removed from the URL and retained through authentication in session
storage. Signed-in visitors see their account email with Accept invitation and
Dismiss actions. Acceptance displays “Accepting…”, then clears the invitation
and refreshes the selected household; dismissal also clears it. Failures retain
the invitation and show an alert. The secret link and matching account email
remain required. Email verification and password-recovery flows are not exposed.

## Evidence and boundaries

Implementation inspected: `frontend/src/app/app.html`, `app.ts` and
`frontend/src/styles.css`. This documentation pass inspected all six final PNGs
under `.cloudflare/auth-verification/`: `desktop-welcome.png`,
`desktop-login.png`, `desktop-register.png`, `mobile-welcome.png`,
`mobile-login.png` and `mobile-register.png`, plus `results.json`.

The [acceptance record](../verification/native-auth.md) reports four passing
desktop/mobile browser groups, six axe WCAG A/AA scans without reported
violations or horizontal overflow, no page errors, and 14 Angular unit tests.
These are integration results, not tests rerun by this documentation pass.
Screenshots establish visual states; the record supplies interaction evidence.
The independent fix confirmation returned **ship**, with the input-boundary
contrast finding resolved in all four recaptured form states. Its scope was
that finding and those screens, not a new backend review.

No additional design drift was identified in the inspected authentication
surfaces. Existing shell conventions are preserved. Deployment, identity and
security limitations remain in [authentication](../authentication.md); this
brief does not redefine their contracts.
