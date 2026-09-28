# Interface

The design ledger. Every decision here is already made — build to it rather than
re-deriving it. If you need to depart from something, change this file in the same
commit and say why.

Source of truth for intent is PRD §10; this file records what was actually decided and
what is actually built. Tokens live in `src/app/globals.css`.

---

## 1. Brief

A precision instrument for a draining task: calm, high-signal, in control. A mission
console that filters noise, not a dashboard that adds to it.

**Spend the boldness in exactly one place: the fit score.** Everything else recedes.

---

## 2. Color

One interactive accent (indigo), plus three semantic fit-tier colors used sparingly.
Defined as CSS variables in `globals.css` and exposed to Tailwind via `@theme inline`.
Dark mode is class-based (`.dark`, `next-themes`, `attribute="class"`), default light,
system detection off.

| Role | Light | Dark |
|---|---|---|
| paper / `--background` | `#f5f6f8` | `#12141a` |
| surface / `--card` | `#ffffff` | `#1a1d26` |
| raised / `--popover` | `#ffffff` | `#222634` |
| ink / `--foreground` | `#16181d` | `#e7e9ee` |
| muted / `--muted-foreground` | `#5a6472` | `#8a93a6` |
| hairline / `--border` | `#e3e6eb` | `#2a2f3c` |
| accent / `--primary` | `#4c5bd4` | `#4c5bd4` |
| `--destructive` | `#c6453b` | `#e06a60` |

**Fill vs ink.** A colour vivid enough to carry white text as a *fill* is usually too
light to *be* text on a pale surface. Every accent therefore has two tokens: the vivid
one for fills, arcs and rings (judged at 3:1), and a `-ink` variant for text (4.5:1).
Measured, not eyeballed — `src/lib/a11y/contrast.test.ts` fails the build if any
shipping pairing drops below AA.

| Role | Fill | Ink (text) |
|---|---|---|
| accent | `--primary` | `--primary-ink` |
| strong | `--tier-strong` | `--tier-strong-ink` |
| possible | `--tier-possible` | `--tier-possible-ink` |
| stretch | `--tier-stretch` | `--tier-stretch-ink` |

The one exception is the gauge numeral, which uses the **vivid** token: it is large
display type, which AA judges at 3:1, and the number should match the arc it sits in.

**Fit tiers** — semantic, not decorative. Use for the score and tier chips only.

| Tier | Light | Dark | Threshold |
|---|---|---|---|
| `--tier-strong` | `#2e9e6b` | `#35b57b` | overall ≥ 85 |
| `--tier-possible` | `#b77d27` | `#e0a64b` | 65–84 |
| `--tier-stretch` | `#6b7280` | `#8a93a6` | < 65 |

Thresholds are owned by `src/lib/scoring.ts` (`fitTier`, `TIER_LABELS`, `TIER_THRESHOLDS`).
That module is deliberately free of `server-only` so both the pipeline and client
components can use it. **Never hardcode a tier threshold or label in a component.**

**Rule:** the indigo accent means *interactive intent* — never decoration. A tier color
never appears on a button.

---

## 3. Type

| Use | Face | Token |
|---|---|---|
| Score, gauge, page titles | **Manrope** | `--font-display` / `.font-display` |
| Body, UI, tabular data | **Geist Sans** | `--font-sans` |
| Numerals in tables | body face + `tabular-nums` | — |

The score treatment *is* the type moment. Body line length stays under 80ch.
No decorative monospace labels anywhere — `--font-mono` exists only as a fallback.

---

## 4. Radius and elevation

Radii vary by hierarchy; one radius on everything is an anti-pattern (§7). Base is
`0.75rem` with five derived steps:

```
--radius-sm   0.55×      --radius-lg   1×  (base)      --radius-2xl  1.8×
--radius-md   0.75×      --radius-xl   1.35×
```

Elevation is quiet. **One considered shadow, reserved for the match drawer.** Everything
else separates with hairlines and space. `StatStrip` and `EmptyState` are deliberately
bordered-not-shadowed; follow that.

---

## 5. Motion

Premium means **craft, not quantity** — the Revolut/Monzo bar (precise, calm) with the
Instagram/Snapchat feel (butter-smooth, physical, 60fps). M6 expanded this section from the
original five-item set: the goal is fidelity everywhere an interaction already happens, not
motion sprinkled on decoration. Anything not serving clarity or feedback still does not animate,
and §7's anti-patterns (fade-up on every card, hover-lift on every tile) still hold.

Library: **`motion`**, imported from `motion/react`. Never `framer-motion` (transitive only).

**Tokens, not magic numbers.** All easings, springs and durations live in
[`src/lib/motion.ts`](../src/lib/motion.ts) (`EASE`, `DURATION`, `SPRING`, `TRANSITION`,
`REVEAL`, `STAGGER_STEP`, `PRESSABLE`); their CSS mirror is `--ease-*` / `--duration-*` in
`globals.css`. House curve is `EASE.emphasized` `[0.22, 1, 0.36, 1]`. Components import the
tokens — no inline curves or durations. `motion.test.ts` guards their shape.

**Rules.** Animate only `transform` and `opacity` (GPU); never layout properties. Sustained
60fps; no interaction may cause a long task. Durations stay short (≤ `DURATION.slow`, 320ms).

The permitted set (✓ built · ◇ M6 target):

1. ✓ **One orchestrated reveal** — Today's top matches stagger in once on load (`match-card.tsx`,
   `REVEAL` + `TRANSITION.enter`, `STAGGER_STEP`). Once, on first paint only.
2. ✓ **Score gauge sweeps 0 → value once** (`fit-gauge.tsx`, `SPRING.gauge`), with the number
   counting up in step — a tween, so it never overshoots its own value on the way to settling.
3. ✓ **Optimistic status flips with rollback** — approve/skip in `review-queue.tsx` via
   `useOptimistic`; the row's disappearance *is* the confirmation (no second success animation).
4. ✓ **Press feedback** on interactive controls (`ui/button.tsx`: dip + scale 0.98 on the shared curve).
5. ◇ **Hover** only where it means something (rows, cards, links) — a quiet lift/tint.
6. ◇ **Focus-visible** rings animate in; inputs transition on focus.
7. ✓ **Nav active indicator slides** between items (`app-shell.tsx` sidebar, shared `layoutId`, `SPRING.snappy`).
8. ◇ **Match drawer opens as a shared-element transition** from its row — the signature moment.
9. ✓ **List choreography** — the review queue collapses a decided card and its neighbors settle
   (`review-queue.tsx`, layout + exit). The matches table is left still by design: a 200-row `<tr>`
   list that re-sorts under motion is the §7 "fade-up on every row" anti-pattern.
10. ◇ **Route/page transitions** — a fast, subtle cross-fade/settle; no flash.
11. ◇ **Toasts** — choreographed enter/exit and stacking.
12. ✓ **Skeletons, never spinners.** Content transitions in, no pop.

`prefers-reduced-motion` collapses all of it to **instant** — not slower. JS motion via
`useReducedMotion()` at each call site; CSS motion via the global guard in `globals.css`.

---

## 6. States

Every state is designed. A screen is not done until all of these are:

| State | Treatment |
|---|---|
| Loading | Skeleton matching final layout. No layout shift, no spinner. |
| Empty | **Direction, not apology** — "Next run at 6:00. Nothing to review right now." Use `EmptyState` with an icon and, where there's a next action, an action slot. |
| Error | Specific and actionable: what happened, how to fix it. In the interface's voice, never apologizing. |
| Partial | Show what succeeded; name what didn't. A run that scores 7 of 12 says so. |
| Success | Confirm with the same verb the button used. |

**Copy:** plain and active. A button says what happens ("Approve & send"); the toast uses
the same verb ("Sent"). Empty states invite the next action.

---

## 7. Anti-patterns — do not ship

From PRD §10.5. These read as AI-generated:

- Cream + serif + terracotta.
- Near-black + a single acid-green or vermilion accent.
- The SaaS-card kit: identical rounded cards, one radius on everything, the same soft
  grey shadow under each, gradient washes as decoration.
- Tracked-out ALL-CAPS eyebrow labels.
- `→` on buttons or links. Middle-dot meta strings. `WORD — fragment` labels.
- Tinted-black-for-black. Monospace labels.
- Fade-and-slide-up on every card; hover-lift on every tile. Motion is §5 only.

---

## 7a. Accessibility and performance — enforced, not aspirational

Three properties are checked automatically, because each fails silently and none is
visible in a screenshot:

- **Contrast** — `a11y/contrast.test.ts` parses the tokens straight out of `globals.css`
  and asserts every shipping pairing against AA, in both themes, compositing
  translucent tints onto their real backdrop first.
- **Reduced motion** — `a11y/motion.test.ts` asserts every component rendering
  `<motion.*>` also calls `useReducedMotion()`, and that the CSS neutraliser exists. The
  failure mode is a *new* component that forgets, which testing the existing ones never
  catches.
- **Compositor-only animation** — the same file rejects animating `width`, `height`,
  `top`, `left`, `margin` or `padding`, and rejects inline easings or springs that
  bypass `lib/motion`.

Measured on the component gallery: **CLS 0**, no layout-shift events, 39 interactive
elements all labelled, heading order with no skipped levels, no unlabelled SVG.

## 8. Quality floor — non-negotiable

Responsive to mobile · visible keyboard focus (`outline-ring/50` is applied globally in
`@layer base`) · `prefers-reduced-motion` respected · WCAG AA contrast · no layout shift ·
optimistic UI with rollback.

**Keyboard-first** (PRD §10.3). Matches: `j`/`k` move, `enter` opens the drawer.
Review: `j`/`k` move, `a` approves (or marks sent), `s` skips, `e` edits, `esc` cancels.
Focus states always visible.

**A keyboard path must be exitable by keyboard.** Any control that captures typing —
the draft editor, the matches filter — takes `esc` to leave, and hands focus back to the
element it came from. Dropping focus on `<body>` silently kills `j`/`k`, which is the
same trap the match drawer had before `onCloseAutoFocus`.

---

## 9. Architecture rules that shape the UI

These are not style preferences — they decide where code goes.

- **Read screens are Server Components.** Today, Matches, Match detail, Runs fetch on the
  server. Set `export const dynamic = "force-dynamic"` on any page whose data or config
  is read per request; without it the page prerenders and freezes values at build time.
- **Mutations are Server Actions.** Approve, skip, edit, send, save profile/strengths.
- **Route handlers (`app/api/*`) only** for the scheduled pipeline entry, OAuth callbacks
  and webhooks. Never for internal data fetching.
- **Client Components are islands** inside server-rendered shells — the keyboard-navigable
  table, the drawer, optimistic controls, toasts. App logic never lives in a client
  component; interactive controls are never server-rendered.
- **Never read config at module scope in a page.** It freezes at build. Build it inside
  the component (see `settings/page.tsx`).
- **The LLM boundary.** No component, page, action or pipeline module may import `ai`,
  an `@ai-sdk/*` package, or reference an **LLM provider** key (`ANTHROPIC_`, `OPENAI_`,
  `GEMINI_`, `GOOGLE_GENERATIVE_AI_`, `GROQ_API_KEY`). Everything goes through
  `@/lib/llm`. Enforced by `no-restricted-imports` and `src/lib/llm/boundary.test.ts`.
  The rule is about keeping **model vendors** swappable; it deliberately does not cover
  credentials no model ever sees, such as a paid job-board aggregator's key, which
  belongs to whichever layer uses it.

---

## 9a. Where jobs come from

Breadth is a data problem, not a UI one, but it decides what every screen can show.

- **Two kinds of source, and the difference matters.** `greenhouse` / `lever` / `ashby`
  are **per-company** ATS boards: no search, no geography parameter, so each employer
  costs one `sources` row. `api` is the **cross-company** aggregators (Remotive,
  Arbeitnow, Himalayas, Jobicy), discriminated by `config.adapter` rather than by new
  `source_kind` enum values — so the fifth aggregator needs no migration.
- **The catalogue is verified, not guessed.** `src/db/sources.catalogue.ts` holds 66
  sources, each confirmed live before being written down. Load it with
  `npm run db:seed:sources`; it matches on name, so correcting a board token is a
  re-run. It never overwrites `enabled` — turning a noisy board off is the user's call.
- **The relevance gate runs at ingest, before anything is stored.**
  `src/pipeline/relevance.ts` is pure, tested, and derived from the stored profile, so
  changing `target_roles` or `locations` retunes it with no code edit. It exists because
  66 boards is ~11,900 postings and scoring is one LLM call each. It is deliberately
  biased toward keeping: an unknown or unrecognised location is kept, because the model
  judges `location_fit` properly and a filter should not pre-empt it.
- **Ingest reports the split** (`seen` / `filtered` / `collapsed` / `inserted` /
  `duplicates`). Surface it anywhere ingest is shown: a filter that is quietly too tight
  looks exactly like a quiet week, and the counts are the only thing that tells them
  apart.
- **One role, one row.** A role advertised in many cities arrives as many postings;
  `src/pipeline/dedupe.ts` collapses them after the gate and merges the locations. Never
  show the same job twice in a list.
- **Show when a role was posted, never when Atlas ingested it.** `first_seen_at` is the
  same instant for thousands of rows after a first run, so it sorts arbitrarily and makes
  a 2023 requisition look new. Use `posted_at` via `relativeAge`, pre-formatted on the
  server (computing it in a client island mismatches on hydration), and mark anything
  open past 180 days as **Long open** — the fit score cannot tell you that.
- **Any list of postings states its window.** The Jobs screen defaults to 48 hours with
  per-window counts on the switcher. A count with no window attached gets read as "today",
  and the reader will assume the flattering interpretation. When a page cap truncates the
  list, say so — print the real total, then "Showing the first N".
- **There is still no sources screen.** Adding or disabling a board means editing the
  catalogue and re-seeding. For a tool whose output quality is bounded by its inputs,
  this is the most valuable screen not yet built.

---

## 9b. Reporting a run honestly

- **State coverage before any count.** A run that lost a third of its boards produces
  fewer matches, and fewer matches is exactly what a genuinely quiet day looks like.
  `CoverageBanner` sits *above* the figures it qualifies — a caveat placed under the
  numbers has already been missed — and renders nothing when coverage was complete, so
  it keeps its meaning.
- **A shared rule lives in `lib/`, not in a query module.** The outreach state machine
  is in `src/lib/outreach.ts` without `server-only`, so the client island offers exactly
  the moves the server enforces. Importing it from `@/db/queries/*` type-checks and
  fails the build. Same arrangement as `lib/scoring.ts`.
- **Never label a symptom with an unestablished cause.** A count is evidence; the reason
  for it usually is not. When a signal has several possible causes and the screen cannot
  distinguish them, name the signal and list the causes.
- **A destructive control states what it destroys.** Deleting a source cascades into
  jobs, matches and drafts — invisible from the button — so the confirmation carries the
  row count and the action re-counts server-side and refuses a stale number.

---

## 9c. The daily email

Not the web. The constraints are different enough to be worth stating, and
`src/lib/email.ts` is pure so the template can be rendered to a file and looked at
without sending anything.

- **Tables, never flexbox or grid.** Outlook 2016–2021 renders through Word.
- **Inline styles for anything load-bearing.** Gmail strips `<style>` on forward and
  clips messages past ~102 KB. The `<style>` block carries only dark mode and the
  small-screen tweak — enhancements that may be dropped without loss.
- **No images at all.** Every client blocks remote images by default, so the fit scores
  are styled table cells, not SVG.
- **Web fonts are an enhancement.** Apple Mail and iOS honour the Manrope link; Gmail
  and Outlook get the fallback stack. Nothing may depend on Manrope's metrics.
- **A VML button for Outlook**, which ignores padding on an anchor.
- **A preheader**, or the client scrapes the wordmark for the preview line.
- **Every colour comes from `globals.css`**, copied into `email.ts` as literals — the
  email cannot import CSS variables, so the values are duplicated deliberately and
  noted as such.
- **Dark mode is opt-in per element.** A `.ink` / `.muted` / `.hairline` class *and*
  the inline colour: the class flips, the inline value is the default. Row titles with
  only the inline colour rendered black-on-black in dark mode — caught by looking at
  it, not by a test.

---

## 9d. Ownership

Atlas is multi-user. One person uses it today; the rules below are what make the second
a row in `users` rather than a rewrite.

- **Everything keys on `profile.id`, never `profile.version`.** A version number is
  unique only within a user — two people both start at 1 — so `(job_id, version)`
  collides and one person's score overwrites the other's. The profile *row* identifies
  an owner; `strengths`, `matches` and, through matches, `drafts` and `outreach`
  inherit it transitively. No table carries a duplicated `user_id` that can drift.
- **An owner parameter is required, never optional.** `getCurrentProfile(userId)`,
  `listDailyQueue(profileId, …)`, `getMatchCounts(profileId)`. An optional owner is how
  "whose data is this?" becomes a question nobody asks — the first caller that omits it
  silently reads whichever profile sorts first, and that bug is invisible until there
  are two users.
- **Pages read through `requireProfile()`**, which pairs the session with its profile.
  A profile of `null` is a real state — a new account has none until it is seeded — so
  screens render an empty state rather than throwing.
- **The corpus is shared; the opinions are not.** Ingest runs once for everyone, and
  its relevance gate keeps a posting relevant to *any* profile. Scoring, drafting and
  the daily email are per user, each email addressed to its own recipient. A shared
  summary would tell you about roles you cannot see.

---

## 10. Component inventory

| Component | Kind | Notes |
|---|---|---|
| `page-header` | server | `h1` in `font-display text-2xl`, optional action slot |
| `stat-strip` | server | One bordered `<dl>` strip with hairline dividers — deliberately not shadowed cards |
| `empty-state` | server | Dashed border, centered, icon + title + description + optional action |
| `fit-gauge` | client | **The hero.** 260° dial, tier-coloured, sweeps once. Sizes `sm` 44px (table) / `md` 64px (card, drawer) / `lg` 104px. Arc math is the pure, tested `gaugeArc()` |
| `tier-chip` | server | Tier label + colour from the `--tier-*` tokens via `color-mix`. The only place a tier is styled |
| `matches-table` | client | The console table. Sort, filter, roving tabindex, `j`/`k`/`enter`/`/` |
| `match-drawer` | client | Radix Dialog as a right sheet. The one component with a real shadow |
| `match-card` | client | A top match on Today. Gauge + why-you + strength chips + red flags. Participates in the orchestrated reveal |
| `review-queue` | client | The draft queue. Keyboard-driven (`j`/`k`/`a`/`s`/`e`/`esc`), inline edit, optimistic approve/skip with rollback |
| `app-shell` | client | The frame: collapsible left sidebar (desktop, cookie-persisted width) + mobile drawer (Radix Dialog). Owns nav, active pill, account footer. Content offset tracks `--sidebar-w` |
| `avatar` | server | Face or name-derived initials tile; `image` prop, `avatarFor(email)` supplies the two known photos |
| `theme-toggle` | client | Renders both icons and swaps with `dark:hidden`/`dark:block` to avoid hydration mismatch |
| `user-menu` | client | Radix dropdown; sign-out is a `<form action={signOutAction}>` |
| `logo` | server | Inline SVG four-point star, `currentColor` |
| `ui/*` | mixed | shadcn-style primitives |

---

## 10a. Guardrail readouts

Anywhere an action is gated, show *what* gates it rather than disabling the control
with no explanation. The review queue's readout is the pattern: one dot per check,
green when satisfied and amber when not, with the unmet one stated in plain words
("No recipient yet — sending lands in M4").

Dots use `--tier-strong` / `--tier-possible`, not new colours: satisfied and
caveat already have semantics in this system.

## 11. Open items

Known inconsistencies. Fix when you're next in the file; don't add to them.

- **`cn` has two import paths.** App components import from `@/lib/utils`; every `ui/*`
  file imports from `"cn"` directly. `@/lib/utils` is a one-line re-export of the same
  function. Pick `@/lib/utils` and converge.
- **`--sidebar-*` and `--chart-*` token families are unused.** The sidebar (`app-shell`) uses
  the semantic tokens (`bg-card`, `border`) rather than the `--sidebar-*` family, and there are no
  charts. Leave them until a real need appears, then
  either use or delete — don't half-adopt.
- **The matches table has no `a`/`s`/`e` shortcuts — by design.** A match is not approved or
  skipped; that is the review queue, which now drives `a`/`s`/`e` (M6 phase 3). The table stays
  navigation-only (`j`/`k`/`enter`/`/`). The drawer's primary action is **Apply** (open the
  posting link); "Draft email" appears only when the posting exposes a real address, since
  almost every role applies through an ATS form, not by email.
- **Pipeline screen is still a static shell.** `outreach` has no queries (M4).
- **Strength chips in the Cites block do not cap.** Five strengths become five rows on a
  phone. Today's card caps at four; this one deliberately does not, because a draft is
  read closely rather than scanned — revisit if it grows further.
