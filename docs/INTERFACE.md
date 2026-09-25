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

**Fit tiers** — semantic, not decorative. Use for the score and tier chips only.

| Tier | Light | Dark | Threshold |
|---|---|---|---|
| `--tier-strong` | `#2e9e6b` | `#35b57b` | overall ≥ 85 |
| `--tier-possible` | `#c98a2b` | `#e0a64b` | 65–84 |
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
| Score, gauge, page titles | **Space Grotesk** | `--font-display` / `.font-display` |
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
2. ✓ **Score gauge sweeps 0 → value once** (`fit-gauge.tsx`, `SPRING.gauge`). ◇ number counts up
   with it.
3. ✓ **Optimistic status flips with rollback** — approve/skip in `review-queue.tsx` via
   `useOptimistic`; the row's disappearance *is* the confirmation (no second success animation).
4. ◇ **Press feedback** on every interactive control (`PRESSABLE`, scale ~0.97, spring back).
5. ◇ **Hover** only where it means something (rows, cards, links) — a quiet lift/tint.
6. ◇ **Focus-visible** rings animate in; inputs transition on focus.
7. ◇ **Nav active indicator slides** between tabs (shared `layoutId`), never cuts.
8. ◇ **Match drawer opens as a shared-element transition** from its row — the signature moment.
9. ◇ **List choreography** — approve/skip collapses height and neighbors settle; matches re-sort
   smoothly (layout animations).
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

## 8. Quality floor — non-negotiable

Responsive to mobile · visible keyboard focus (`outline-ring/50` is applied globally in
`@layer base`) · `prefers-reduced-motion` respected · WCAG AA contrast · no layout shift ·
optimistic UI with rollback.

**Keyboard-first on Matches** (PRD §10.3): `j`/`k` move, `enter` opens, `a` approves,
`s` skips, `e` edits. Focus states always visible.

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
  an `@ai-sdk/*` package, or reference an API key. Everything goes through `@/lib/llm`.
  Enforced by `no-restricted-imports` and `src/lib/llm/boundary.test.ts`.

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
| `review-queue` | client | The draft queue. Inline edit, optimistic approve/skip with rollback, and the guardrail readout |
| `app-nav` | client | Needs `usePathname()` for active state; sets `aria-current="page"` |
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
- **`--sidebar-*` and `--chart-*` token families are unused.** There is no sidebar (nav
  is a horizontal header) and no charts. Leave them until a real need appears, then
  either use or delete — don't half-adopt.
- **The match drawer still has no actions.** Approve / skip / edit live on `/review`;
  the `a` / `s` / `e` shortcuts §10.3 reserves for the matches table are unimplemented.
- **Pipeline screen is still a static shell.** `outreach` has no queries (M4).
- **The review queue is not keyboard-driven.** §10.3 reserves `a` / `s` / `e`; today it
  is pointer- and tab-driven only.
- **Strength chips in the Cites block do not cap.** Five strengths become five rows on a
  phone. Today's card caps at four; this one deliberately does not, because a draft is
  read closely rather than scanned — revisit if it grows further.
