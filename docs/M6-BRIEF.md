# M6 — Design pass: enterprise-grade polish

The brief for the "premium" milestone. Design intent lives in [INTERFACE.md](INTERFACE.md)
(§10 of the PRD is the source for intent); this file is the standing target for M6 and the
quality bar it must hit. Progress is logged in [EXECUTION.md](EXECUTION.md).

## North star

Ship Atlas at the quality bar of **Revolut / Monzo** (fintech precision, calm density,
trustworthy restraint) with the interaction fluidity of **Instagram / Snapchat**
(butter-smooth, physics-based, 60fps, never janky). Premium = **craft, not quantity**:
every motion is intentional, every state is designed, nothing stutters. If an animation
doesn't add clarity or delight, it doesn't ship.

## Hard constraints (do not break)

- The architecture in INTERFACE.md §9: server components for read screens, server actions
  for mutations, client islands for interactivity, the `@/lib/llm` boundary, `force-dynamic`
  where config is read per request.
- The dropped-sending simplification (copy-ready drafts + "Mark sent"). No Gmail.
- Ink & Signal tokens (§2/§3): Space Grotesk for score/titles, Geist for UI.
- Every change respects `prefers-reduced-motion` (collapse to **instant**, not slow), WCAG AA
  contrast, visible keyboard focus, and **zero layout shift**.
- Update the ledger as you go: EXECUTION per phase, LEARNINGS for reusable lessons, and
  INTERFACE **in the same commit** as any design decision it records — especially the revised
  motion system.

## Motion system (revises INTERFACE.md §5)

- Library: `motion/react`. Animate **only `transform` + `opacity`** (GPU); never
  width/top/left. Sustained 60fps; no interaction may cause a long task.
- **Physics, not linear tweens.** All easings, springs and durations live in one module
  (`src/lib/motion.ts`); components import them — no magic numbers.
- The expanded, still-curated permitted set:
  1. **Press feedback** on every interactive control (scale ~0.97, spring back).
  2. **Hover** only where it means something (rows, cards, links) — a quiet lift/tint.
  3. **Focus-visible** rings animate in; inputs transition on focus.
  4. **Nav active indicator slides** between tabs (shared `layoutId`).
  5. **Match drawer opens as a shared-element transition** from its row — the signature moment.
  6. **List choreography**: review-queue approve/skip collapses + neighbors settle; matches
     re-sort smoothly.
  7. **Route/page transitions**: fast, subtle cross-fade/settle; no flash.
  8. **Fit gauge**: arc sweep + number count-up on first paint.
  9. **Toasts**: choreographed enter/exit + stacking; optimistic flips with rollback.
  10. **Skeletons shimmer; never spinners.** Content transitions in.
- Everything not serving clarity/feedback still does not animate. Keep §7 anti-patterns.

## Per-surface polish (both themes, 375 / 768 / 1280)

Login · Today · Matches (finish `a`/`s`/`e`) · Match drawer (shared-element open, add actions) ·
Review queue (keyboard-drive it) · Pipeline funnel · Runs · Settings · Jobs · Nav · theme toggle ·
every empty / loading / error / partial state (INTERFACE §6).

## Consistency & debt (close INTERFACE §11 open items)

Converge `cn` on `@/lib/utils`; decide the unused `--sidebar`/`--chart` token families; cap
strength chips that overflow on mobile; remove any drift toward the SaaS-card anti-pattern.

## Performance budget (verify, don't assume)

CLS ~0 · 60fps on drawer open / list reorder / table scroll · no interaction long-task >50ms ·
route-level code splitting · lazy heavy islands · fonts without FOUT · lean client bundle.

## Verification

Self-review every screen via a temporary dev-only preview route rendering real components with
seeded data (the established pattern — created then **deleted** before commit). No password
entry. Check both themes, all three breakpoints, full keyboard paths, and reduced-motion
(must be instant). Screenshot each screen. Iterate — do not ship the first render.

## Phases

1. Motion-token foundation + revised INTERFACE §5.
2. Interaction primitives (press / hover / focus, nav indicator, toasts).
3. Signature moments (drawer shared-element, gauge count-up, list choreography, review-queue keyboard).
4. Per-screen audit + all states + consistency/debt.
5. Performance + full verification pass.

## Definition of done

Every screen feels deliberate and calm; every interaction is smooth and physical; every state
is designed; keyboard + a11y + reduced-motion + zero-CLS hold; gates green (lint, tsc, tests,
build); INTERFACE / EXECUTION / LEARNINGS updated; one commit per coherent phase.
