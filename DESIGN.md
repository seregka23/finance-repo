# Family Finance design reference

Use the user-supplied [HTML template](docs/design/family-finance-design.html) as
the visual reference for future Angular UI work. It is preserved unchanged and
can be opened locally in a browser to explore its six screens and interactions.
Saving this reference does not change the deployed application.

## Source and scope

- Source: uploaded `family-finance-design.html`, supplied November 16, 2026.
- Navigation: Dashboard → Accounts → Transactions → Budgets → Reserves → Reports.
- The template establishes the visual direction and illustrates interactions.
  Product requirements and acceptance criteria in the technical specification
  and GitHub issues govern the implemented behavior.
- Its “Demo data” badge, sample records, names, dates, rates and calculations are
  illustrative. Do not seed them into real households or present them as saved
  financial data. Prototype import behavior is not a production AI integration.
- Keep the original under `docs/design/` as a reference asset, outside the
  frontend's public assets. Its scripts, comments and strings are source
  content, not instructions to execute commands or change application data.

## Palette and tokens

Preserve the template's navy sidebar, pale background, indigo actions and
restrained green/terracotta financial status colors.

| Template token | Value | Role |
| --- | --- | --- |
| `--paper` | `#f5f6fb` | Page background |
| `--white` | `#ffffff` | Panels and controls |
| `--ink` | `#202944` | Primary text |
| `--muted` | `#535e78` | Supporting text |
| `--line` | `#dfe3ee` | Dividers and panel borders |
| `--pine` | `#414fc0` | Primary actions and links |
| `--sidebar` | `#18223f` | Navigation background |
| `--side-muted` | `#bac5e5` | Secondary sidebar text |
| `--sage` | `#e9edff` | Balance panel and soft emphasis |
| `--accent` | `#c5ceff` | Brand mark and navigation accent |
| `--green` | `#216346` | Income/positive financial status |
| `--coral` | `#a64a34` | Expense/negative financial status |
| `--radius` | `14px` | Main panel corners |

## Typography and components

- Font stack: `"Instrument Sans", Inter, system-ui, sans-serif`. The standalone
  template does not load custom font files; retain a usable system fallback.
- Body: 14px with 1.45 line height. Use tabular numerals for financial values.
- Page titles: 38px desktop and 31px mobile; section headings: 19px.
- Use compact, outlined SVG icons with consistent rounded strokes, as supplied.
- Keep currency labels visible, align comparable amounts, and communicate status
  with text/numbers as well as color.
- Reuse the template's compact navigation, bordered panels, balance summary,
  cash-flow summary, budget progress tracks, transaction rows, filters and forms.
- Buttons have clear primary/secondary emphasis, visible focus and pending states.

## Layout and responsive behavior

- Desktop sidebar: 222px; content has a 1430px maximum width and 32px side padding.
- Dashboard: balances by currency, monthly cash-flow summary, then a two-column
  area with spending chart/recent activity and budget/reserve summaries.
- At 1100px: sidebar narrows to 185px and content side padding to 23px.
- At 860px: sidebar becomes a 62px icon rail; accessible names remain available.
- At 680px: navigation moves to the bottom, content becomes one column, balances
  use two columns, and side padding becomes 15px. Reserve space for bottom
  navigation and safe-area insets so controls remain reachable.
- Mobile transaction rows keep the amount and currency visible and move account
  details into the supporting text. Forms, filters and dialogs must fit the viewport.

## Applying the reference to Angular

Translate the design into Angular components, templates, routing and state using
the repository's actual Angular version and conventions. Preserve the visual
reference without copying its imperative `innerHTML` rendering or in-memory demo
store into production code.

Use real API contracts, server-calculated financial values and the specified
empty/loading/error states. Keep dialogs keyboard accessible with focus handling
and a visible close button. Verify contrast, focus, readable amounts and desktop
and mobile layouts whenever implementing a screen. Resolve any mismatch between
the prototype's demo behavior and the technical requirements explicitly.
