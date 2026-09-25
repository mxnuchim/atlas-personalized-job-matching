# Pipeline

The batch pipeline lives here from **M1** onward. It is a plain TypeScript module the
route handler at `src/app/api/pipeline/run/route.ts` invokes — **not** a queue, worker, or
service (PRD §6/§8).

Planned stages (top-to-bottom, ~2 min):

```
ingest → normalize → dedupe → score(LLM) → draft(LLM) → persist → notify
```

- **M1** — ingest + dedupe (one source; idempotent on `(source_id, external_id)`)
- **M2** — strength-aware scoring (the §9 schema)
- **M3** — strength-grounded drafting (cites real evidence)
- **M4** — dropped. Atlas drafts; you copy and send from your own mail client, and
  mark it sent so the tracker follows it. No mailbox access, no deliverability surface.
- **M5** — the twice-daily schedule, notification, and run recording
