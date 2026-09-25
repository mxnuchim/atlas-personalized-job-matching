# Atlas — Candidate Profile (seed data)

*This is what Atlas scores jobs against. Paste it into the Claude Code session at
M2, or drop it in the repo as `docs/candidate-profile.md` and seed it. The JSON
block at the bottom maps directly to the `profile`, `strengths`, and `evidence`
tables in PRD §7.*

*Weights are 1–10 (how central the strength is to the target roles). Evidence links
to a strength by `strength_key`. Everything here is drawn from the four CVs — edit
before seeding. The three **dealbreakers** in particular are my suggestions;
confirm or change them.*

---

## Readable profile

**Name:** Manuchimso Oliver ("Manuchim") · GitHub `mxnuchim`
**Contact:** manuchimoliver779@gmail.com · manuchim.com · linkedin.com/in/manuchimoliver

**Headline:** Senior software engineer who **builds and operates** reliable,
money-moving systems — distributed backends, full-stack products (web + mobile),
and production AI/ML integration — with fintech-grade reliability and
regulated-environment security.

**Target roles (priority order):**
1. Forward Deployed Engineer *(primary reach — relocation-minded)*
2. AI-Systems Engineer *(primary positioning)*
3. Full-Stack Engineer *(proven base)*
4. Backend Engineer *(proven base)*
5. Frontend / Design Engineer *(proven base)*

**Seniority:** Senior / Lead — 7+ years. Has held Lead across backend, frontend,
and cloud; first-infrastructure-hire / platform-level scope at Senta.

**Location & relocation:** Based in Port Harcourt, Nigeria. Open to fully remote
(global) **and actively open to relocation abroad** (US, UK, EU, Canada) —
relocation is a deliberate goal for FDE roles, not a fallback.

**Dealbreakers (suggested — edit):** relocation roles with no visa sponsorship;
purely non-technical / management-only roles; unpaid or equity-only comp.

**Education & credentials:** MSc Computer Science, University of East London (2025).
BTech Civil Engineering, Rivers State University. Google Africa Developers
Scholarship / Google Cloud Computing Professional Certificate. ISO/IEC 27001 Lead
Auditor. (Also: Database Engineer, iOS Developer, React Native, DevOps on AWS certs.)

**Career in one paragraph (`cv_text`):** 7+ years shipping secure, resilient
cloud-native systems, heavily in **fintech and payments** — StartButton Africa
(payments/transaction workflows across 15+ African markets), Senta Finance
(distributed payments platform, 2M+ daily requests at 99.9%, and as first infra
hire building AWS 0→production for 10M+ transactions/month), Padiepay and LinqPay
(remittances and cross-border payments, PCI-DSS), The Rock Empire (10M+ daily
transactions at 99.99% uptime, $50M+/month with zero financial discrepancies), and
Cabbagesoup (Go security SaaS, SOC 2). **Distributed-systems and reliability** are
the spine: event-driven microservices on RabbitMQ/Kafka, retries, idempotency,
fault tolerance, ACID transaction workflows. **Polyglot backend** across Node.js
(Express/NestJS), Go, Java (Spring Boot), and Python, with heavy query/latency
optimization (8.4s→420ms at Senta; −76% response time at Rock Empire; −68% auth
latency at Andela). **Full-stack and design-engineering** across React, Next.js,
React Native, and TypeScript (founding frontend engineer at Padiepay; 500+-partner
dashboards at Phonelyne; WCAG AA; Framer Motion). **Cloud/DevOps**: AWS
(EKS/EC2/RDS/S3/VPC/IAM), Kubernetes, Terraform (−70% provisioning), CI/CD
(40min→<10min), observability (<5min MTTR); built a production Kubernetes
Backup/Restore Operator in Go. **AI/ML systems**: Node orchestration for Python ML
services (250K+ inferences/day, sub-400ms) and RAG with vector databases (−61% DB
load) at BreezeLearn, now extending into agentic-AI reliability work.
**Security/compliance** in regulated environments: PCI-DSS, SOC 2, ISO 27001,
least-privilege IAM, secrets rotation. Unusual origin (civil engineering) that
brings systems-and-failure-modes thinking to software reliability.

---

## Strengths (6 core + 3 differentiators)

**Core**
1. **Distributed systems & transaction reliability** `distributed-reliability` — w10
2. **Payments & fintech engineering** `payments-fintech` — w10
3. **Polyglot backend & API engineering** `backend-polyglot` — w9
4. **Full-stack & design-engineering (web + mobile)** `fullstack-frontend` — w8
5. **Cloud infrastructure & DevOps (AWS / K8s / Terraform)** `cloud-devops` — w8
6. **AI / ML systems integration** `ai-systems` — w9

**Differentiators (the rare combinations that make you *you*)**
7. **Fintech-grade reliability + AI systems** `fintech-reliability-plus-ai` — w10
8. **Builds *and* operates (full-stack + DevOps + on-call)** `build-and-operate` — w9
9. **Security & compliance in regulated environments** `regulated-security` — w7

---

## Seed JSON (maps to PRD §7)

```json
{
  "profile": {
    "version": 1,
    "headline": "Senior software engineer who builds and operates reliable, money-moving systems — distributed backends, full-stack products (web + mobile), and production AI/ML integration, with fintech-grade reliability and regulated-environment security.",
    "target_roles": ["Forward Deployed Engineer", "AI-Systems Engineer", "Full-Stack Engineer", "Backend Engineer", "Frontend Engineer"],
    "seniority": "Senior / Lead (7+ years; Lead across backend, frontend, cloud; platform/first-infra-hire scope)",
    "locations": ["Remote (global)", "Port Harcourt, Nigeria (base)", "Open to relocation: US, UK, EU, Canada"],
    "relocation": true,
    "dealbreakers": ["Relocation role with no visa sponsorship", "Purely non-technical / management-only role", "Unpaid or equity-only compensation"],
    "cv_text": "7+ years building secure, resilient cloud-native systems, heavily in fintech and payments (StartButton, Senta Finance, Padiepay, LinqPay, The Rock Empire, Cabbagesoup). Distributed-systems and reliability spine: event-driven microservices on RabbitMQ/Kafka with retries, idempotency, fault tolerance, and ACID transaction workflows. Polyglot backend across Node.js (Express/NestJS), Go, Java (Spring Boot), Python. Full-stack and design-engineering across React, Next.js, React Native, TypeScript, Tailwind, Framer Motion. Cloud/DevOps on AWS (EKS/EC2/RDS/S3/VPC/IAM), Kubernetes, Terraform, CI/CD, observability; built a production Kubernetes Backup/Restore Operator in Go. AI/ML systems integration: Node orchestration for Python ML services and RAG with vector databases, now extended into agentic-AI reliability work. Security/compliance in regulated environments: PCI-DSS, SOC 2, ISO 27001 Lead Auditor, least-privilege IAM, secrets rotation. MSc Computer Science (UEL, 2025); civil-engineering origin."
  },
  "strengths": [
    { "key": "distributed-reliability", "label": "Distributed systems & transaction reliability", "kind": "core", "weight": 10, "summary": "Event-driven microservices and high-throughput transaction systems built for reliability under failure — queues (RabbitMQ/Kafka), retries, idempotency, fault tolerance, ACID workflows." },
    { "key": "payments-fintech", "label": "Payments & fintech engineering", "kind": "core", "weight": 10, "summary": "Deep, repeated experience building and operating payment and transaction systems across multiple fintechs and markets, with financial-correctness guarantees." },
    { "key": "backend-polyglot", "label": "Polyglot backend & API engineering", "kind": "core", "weight": 9, "summary": "Production microservices and APIs in Node.js (Express/NestJS), Go, and Java (Spring Boot), with heavy database and latency optimization." },
    { "key": "fullstack-frontend", "label": "Full-stack & design-engineering (web + mobile)", "kind": "core", "weight": 8, "summary": "Owns frontend architecture across web (Next.js), admin (React), and mobile (React Native) with TypeScript, performance tuning, accessibility, and polished UI." },
    { "key": "cloud-devops", "label": "Cloud infrastructure & DevOps (AWS / K8s / Terraform)", "kind": "core", "weight": 8, "summary": "Builds and operates production AWS infrastructure: Kubernetes (EKS), Terraform IaC, CI/CD, observability, cost control." },
    { "key": "ai-systems", "label": "AI / ML systems integration", "kind": "core", "weight": 9, "summary": "Integrates ML/LLM systems into production: orchestration layers for ML inference, RAG with vector databases, and agentic-AI reliability work." },
    { "key": "fintech-reliability-plus-ai", "label": "Fintech-grade reliability + AI systems", "kind": "differentiator", "weight": 10, "summary": "The uncopyable combination: makes AI/ML reliable inside regulated, money-moving systems — payments reliability plus production ML/RAG plus compliance." },
    { "key": "build-and-operate", "label": "Builds and operates (full-stack + DevOps + on-call)", "kind": "differentiator", "weight": 9, "summary": "Owns the full lifecycle — architects the backend, ships the infrastructure, and runs it in production. The exact profile Forward Deployed Engineering rewards." },
    { "key": "regulated-security", "label": "Security & compliance in regulated environments", "kind": "differentiator", "weight": 7, "summary": "Delivers PCI-DSS and SOC 2 systems; ISO 27001 Lead Auditor; least-privilege IAM and secrets management." }
  ],
  "evidence": [
    { "strength_key": "distributed-reliability", "claim": "Architected a Node.js/TypeScript backend processing 10M+ daily transactions at 99.99% uptime with sub-150ms responses; scaled concurrency from 200K to 1.2M users", "context": "The Rock Empire", "metric": "10M+ daily txns, 99.99% uptime, <150ms", "source": "CV" },
    { "strength_key": "distributed-reliability", "claim": "Led backend for a distributed payments platform at 2M+ daily requests and 99.9% availability, event-driven via RabbitMQ on Kubernetes (EKS) with fault-tolerant async processing", "context": "Senta Finance", "metric": "2M+ req/day, 99.9% availability", "source": "CV" },
    { "strength_key": "distributed-reliability", "claim": "Built event-driven processing pipelines (RabbitMQ/Kafka) with retry strategies, idempotency, and fault-tolerant workflows for payments across 15+ African markets", "context": "StartButton Africa", "metric": "15+ markets", "source": "CV" },
    { "strength_key": "payments-fintech", "claim": "Designed fault-tolerant transaction workflows with ACID guarantees, ensuring zero financial discrepancies across $50M+ monthly volume", "context": "The Rock Empire", "metric": "$50M+/month, zero discrepancies", "source": "CV" },
    { "strength_key": "payments-fintech", "claim": "Built the cloud foundation for a fintech platform processing 10M+ transactions per month at under 0.05% error rate", "context": "Senta Finance", "metric": "10M+ txns/month, <0.05% error", "source": "CV" },
    { "strength_key": "payments-fintech", "claim": "Led a cross-border payments mobile app with multi-currency wallets and card tokenization; integrated Apple/Google Pay, Plaid, SumSub; improved checkout success 18%; PCI-DSS compliant", "context": "LinqPay", "metric": "+18% checkout success", "source": "CV" },
    { "strength_key": "backend-polyglot", "claim": "Reduced critical query latency from 8.4s to 420ms via PostgreSQL schema and Redis caching optimization", "context": "Senta Finance", "metric": "8.4s to 420ms", "source": "CV" },
    { "strength_key": "backend-polyglot", "claim": "Cut authentication latency 68% integrating Spring Security, JWT, and Redis session management across Java/Go microservices serving 2M+ daily requests", "context": "Andela", "metric": "-68% auth latency", "source": "CV" },
    { "strength_key": "backend-polyglot", "claim": "Built a Go/PostgreSQL security-SaaS backend processing 100K+ daily scan requests at 99.8% uptime and sub-200ms responses; RBAC + rate limiting for SOC 2", "context": "Cabbagesoup", "metric": "100K+ scans/day, 99.8%", "source": "CV" },
    { "strength_key": "fullstack-frontend", "claim": "Founding frontend engineer: built web (Next.js), admin (React), and mobile (React Native) from scratch; +50% feature velocity, 80%+ test coverage, -60% production bugs", "context": "Padiepay", "metric": "+50% velocity, 80%+ coverage, -60% bugs", "source": "CV" },
    { "strength_key": "fullstack-frontend", "claim": "Built dashboards for 500+ partners; SSR and code-splitting cut initial load times 35%; met WCAG 2.1 AA; real-time WebSockets", "context": "Phonelyne", "metric": "-35% load, 500+ partners", "source": "CV" },
    { "strength_key": "cloud-devops", "claim": "First infrastructure hire: built AWS 0→production (VPC, IAM, EC2, EKS, S3, RDS); modular Terraform cut provisioning ~70%; CI/CD cut deploys 40min→<10min; AWS spend down 35-40%; <5min MTTR", "context": "Senta Finance", "metric": "-70% provisioning, <10min deploys, -35-40% cost, <5min MTTR", "source": "CV" },
    { "strength_key": "cloud-devops", "claim": "Built a production-grade Kubernetes Backup & Restore Operator in Go (controller-runtime) with cron scheduling, retention cleanup, restore workflows, and event-driven reconciliation", "context": "Technical project (open source)", "metric": "Go, controller-runtime", "source": "CV" },
    { "strength_key": "ai-systems", "claim": "Built a Node.js orchestration layer between the frontend and Python ML services, processing 250K+ daily inference requests at sub-400ms latency", "context": "BreezeLearn", "metric": "250K+ inferences/day, <400ms", "source": "CV" },
    { "strength_key": "ai-systems", "claim": "Implemented RAG workflows with vector databases and Redis caching, reducing primary database load 61% while supporting thousands of concurrent users", "context": "BreezeLearn", "metric": "-61% DB load", "source": "CV" },
    { "strength_key": "ai-systems", "claim": "Currently building agentic-AI reliability tooling (chaos engineering / resilience testing for AI agents) and other AI-systems projects", "context": "Current work", "metric": null, "source": "self" },
    { "strength_key": "fintech-reliability-plus-ai", "claim": "Rare combination: makes AI/ML reliable inside regulated, money-moving systems — payments reliability (Senta, Rock Empire) plus production ML/RAG integration (BreezeLearn) plus PCI-DSS/SOC 2 security", "context": "Career arc", "metric": null, "source": "synthesis" },
    { "strength_key": "build-and-operate", "claim": "At Senta was both lead backend architect and first infrastructure hire — designed the services AND built and operated the platform they run on, with observability and <5min MTTR", "context": "Senta Finance", "metric": "<5min MTTR", "source": "CV" },
    { "strength_key": "regulated-security", "claim": "ISO/IEC 27001 Lead Auditor; delivered PCI-DSS (Senta, LinqPay) and SOC 2 (Cabbagesoup) systems; least-privilege IAM across 40+ roles; automated secrets rotation", "context": "Multiple", "metric": "ISO 27001, PCI-DSS, SOC 2, 40+ IAM roles", "source": "CV" }
  ]
}
```

---

## How to use this in the Claude Code session

1. Save this file in the repo as `docs/candidate-profile.md`.
2. At **M2**, tell Claude Code: *"Seed the `profile`, `strengths`, and `evidence`
   tables from the JSON block in docs/candidate-profile.md."*
3. The scorer (PRD §9) reads these strengths + weights + evidence summaries on
   every job, so the fit score reflects *your* actual edge, and the drafter (§ App.
   C) cites a real evidence item — not generic enthusiasm.
4. When your search focus shifts (e.g. leaning harder into FDE), bump the relevant
   `weight` values and re-score; the `profile.version` bump keeps history clean.
