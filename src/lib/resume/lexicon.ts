/**
 * A curated lexicon of technical terms, with the spellings people actually write and what
 * each one implies.
 *
 * It does three jobs without a single model call:
 *  1. **Coverage on Matches** — which of a posting's technical keywords your resume has,
 *     for every row, for free. Running an LLM over 2,000+ postings for a column would
 *     be the expense this feature must not have.
 *  2. **Equivalence** — "k8s" and "Kubernetes" are one skill, so a resume that says one
 *     still counts for a posting that says the other.
 *  3. **The anti-fabrication guard** — a rewritten bullet may not mention a technology
 *     its source bullet did not (or does not directly imply). `implies` is what lets a
 *     Terraform bullet honestly say "infrastructure as code" without opening the door to
 *     it suddenly claiming Kubernetes.
 *
 * Deliberately technical. Soft skills and domain phrases vary too much for a fixed list;
 * the per-job LLM extraction covers those when you actually tailor a resume.
 *
 * `exact` forms are matched case-sensitively — for words that are also ordinary English
 * ("Go", "React", "Express", "Helm"), where a case-insensitive match would light up on
 * "go to market" or "react quickly". When `exact` is set, the canonical term is matched
 * *only* through it; `aliases` stay case-insensitive ("golang", "react.js").
 */

export type LexiconEntry = {
  term: string;
  aliases?: string[];
  exact?: string[];
  implies?: string[];
};

export const LEXICON: LexiconEntry[] = [
  // Languages
  { term: "JavaScript", aliases: ["ecmascript", "es6"] },
  { term: "TypeScript" },
  { term: "Python" },
  { term: "Java" },
  { term: "Kotlin" },
  { term: "Swift", exact: ["Swift"] },
  { term: "Objective-C" },
  { term: "Go", aliases: ["golang"], exact: ["Go"] },
  { term: "Rust" },
  { term: "C++", aliases: ["cpp"] },
  { term: "C#", aliases: ["csharp"] },
  { term: "Ruby" },
  { term: "PHP" },
  { term: "Scala" },
  { term: "Elixir" },
  { term: "Erlang" },
  { term: "Haskell" },
  { term: "Clojure" },
  { term: "Dart" },
  { term: "SQL" },
  { term: "Bash", aliases: ["shell scripting"] },
  { term: "PowerShell" },
  { term: "Solidity" },

  // Frontend
  { term: "React", aliases: ["react.js", "reactjs"], exact: ["React"] },
  { term: "Next.js", aliases: ["nextjs"], implies: ["React"] },
  { term: "Vue", aliases: ["vue.js", "vuejs"] },
  { term: "Nuxt", aliases: ["nuxt.js"], implies: ["Vue"] },
  { term: "Angular" },
  { term: "Svelte" },
  { term: "SvelteKit", implies: ["Svelte"] },
  { term: "Remix", exact: ["Remix"], implies: ["React"] },
  { term: "Redux", implies: ["React"] },
  { term: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"], implies: ["CSS"] },
  { term: "HTML", aliases: ["html5"] },
  { term: "CSS", aliases: ["css3"] },
  { term: "Sass", aliases: ["scss"], implies: ["CSS"] },
  { term: "Webpack" },
  { term: "Vite" },
  { term: "React Native", implies: ["React"] },
  { term: "Flutter", implies: ["Dart"] },
  { term: "iOS" },
  { term: "Android" },
  { term: "GraphQL" },
  { term: "REST APIs", aliases: ["rest api", "rest apis", "restful", "restful apis"] },
  { term: "gRPC" },
  { term: "WebSockets", aliases: ["websocket"] },
  { term: "Storybook" },
  { term: "Jest" },
  { term: "Vitest" },
  { term: "Playwright" },
  { term: "Cypress" },

  // Backend & runtimes
  { term: "Node.js", aliases: ["nodejs"], implies: ["JavaScript"] },
  { term: "Express", aliases: ["express.js", "expressjs"], exact: ["Express"], implies: ["Node.js"] },
  { term: "NestJS", aliases: ["nest.js"], implies: ["Node.js", "TypeScript"] },
  { term: "Django", implies: ["Python"] },
  { term: "Flask", implies: ["Python"] },
  { term: "FastAPI", implies: ["Python"] },
  { term: "Ruby on Rails", aliases: ["rails"], implies: ["Ruby"] },
  { term: "Spring Boot", aliases: ["spring framework"], implies: ["Java"] },
  { term: ".NET", aliases: ["dotnet", "asp.net"], implies: ["C#"] },
  { term: "Laravel", implies: ["PHP"] },
  { term: "Microservices", aliases: ["microservice", "micro-services"] },
  { term: "Serverless" },
  { term: "Distributed Systems", aliases: ["distributed system"] },
  { term: "Event-Driven Architecture", aliases: ["event driven", "event-driven"] },
  { term: "System Design" },
  { term: "API Design" },

  // Data stores & pipelines
  { term: "PostgreSQL", aliases: ["postgres", "psql"], implies: ["SQL"] },
  { term: "MySQL", implies: ["SQL"] },
  { term: "SQLite", implies: ["SQL"] },
  { term: "MongoDB", aliases: ["mongo"] },
  { term: "Redis" },
  { term: "Elasticsearch", aliases: ["elastic search"] },
  { term: "OpenSearch" },
  { term: "DynamoDB", implies: ["AWS"] },
  { term: "Cassandra" },
  { term: "ClickHouse", implies: ["SQL"] },
  { term: "Snowflake", implies: ["SQL"] },
  { term: "BigQuery", implies: ["GCP", "SQL"] },
  { term: "Redshift", implies: ["AWS", "SQL"] },
  { term: "Kafka", aliases: ["apache kafka"] },
  { term: "RabbitMQ" },
  { term: "SQS", aliases: ["amazon sqs"], implies: ["AWS"] },
  { term: "Pub/Sub", aliases: ["pubsub"], implies: ["GCP"] },
  { term: "Spark", aliases: ["apache spark", "pyspark"], exact: ["Spark"] },
  { term: "Airflow", aliases: ["apache airflow"] },
  { term: "dbt" },
  { term: "Databricks" },
  { term: "Flink", aliases: ["apache flink"] },
  { term: "ETL", aliases: ["elt"] },
  { term: "Data Pipelines", aliases: ["data pipeline"] },
  { term: "Prisma" },
  { term: "Drizzle" },
  { term: "Supabase", implies: ["PostgreSQL"] },
  { term: "Firebase" },

  // Cloud, infrastructure, delivery
  { term: "AWS", aliases: ["amazon web services"] },
  { term: "GCP", aliases: ["google cloud", "google cloud platform"] },
  { term: "Azure", aliases: ["microsoft azure"] },
  { term: "Kubernetes", aliases: ["k8s"] },
  { term: "Docker", aliases: ["containerization"] },
  { term: "Terraform", implies: ["Infrastructure as Code"] },
  { term: "Pulumi", implies: ["Infrastructure as Code"] },
  { term: "CloudFormation", implies: ["Infrastructure as Code", "AWS"] },
  { term: "Ansible" },
  { term: "Helm", exact: ["Helm"], implies: ["Kubernetes"] },
  { term: "Infrastructure as Code", aliases: ["iac", "infrastructure-as-code"] },
  { term: "Lambda", aliases: ["aws lambda"], exact: ["Lambda"], implies: ["AWS", "Serverless"] },
  { term: "EC2", implies: ["AWS"] },
  { term: "S3", aliases: ["amazon s3"], implies: ["AWS"] },
  { term: "ECS", implies: ["AWS", "Docker"] },
  { term: "EKS", implies: ["AWS", "Kubernetes"] },
  { term: "GKE", implies: ["GCP", "Kubernetes"] },
  { term: "Cloudflare" },
  { term: "Vercel" },
  { term: "Linux" },
  { term: "Nginx" },
  { term: "CI/CD", aliases: ["ci / cd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { term: "GitHub Actions", implies: ["CI/CD"] },
  { term: "GitLab CI", aliases: ["gitlab ci/cd"], implies: ["CI/CD"] },
  { term: "Jenkins", implies: ["CI/CD"] },
  { term: "CircleCI", implies: ["CI/CD"] },
  { term: "Argo CD", aliases: ["argocd"], implies: ["CI/CD", "Kubernetes"] },
  { term: "Git" },
  { term: "Prometheus", implies: ["Observability"] },
  { term: "Grafana", implies: ["Observability"] },
  { term: "Datadog", implies: ["Observability"] },
  { term: "OpenTelemetry", aliases: ["otel"], implies: ["Observability"] },
  { term: "Sentry" },
  { term: "Observability" },
  { term: "Site Reliability Engineering", aliases: ["sre"] },
  { term: "Incident Response", aliases: ["incident management", "on-call", "on call"] },
  { term: "High Availability" },
  { term: "Service Mesh", aliases: ["istio", "envoy"] },
  { term: "HashiCorp Vault" },

  // AI / ML
  { term: "Machine Learning", aliases: ["ml"] },
  { term: "Deep Learning" },
  { term: "PyTorch", implies: ["Machine Learning", "Python"] },
  { term: "TensorFlow", implies: ["Machine Learning", "Python"] },
  { term: "scikit-learn", aliases: ["sklearn"], implies: ["Machine Learning", "Python"] },
  { term: "LLMs", aliases: ["llm", "large language models", "large language model"] },
  { term: "RAG", aliases: ["retrieval-augmented generation", "retrieval augmented generation"], implies: ["LLMs"] },
  { term: "NLP", aliases: ["natural language processing"] },
  { term: "Computer Vision" },
  { term: "MLOps" },
  { term: "Hugging Face", aliases: ["huggingface"], implies: ["Machine Learning"] },
  { term: "LangChain", implies: ["LLMs"] },
  { term: "Vector Databases", aliases: ["vector database", "vector db", "pgvector", "pinecone"] },
  { term: "Embeddings" },
  { term: "Prompt Engineering" },
  { term: "Fine-tuning", aliases: ["fine tuning", "finetuning"] },
  { term: "Pandas", implies: ["Python"] },
  { term: "NumPy", implies: ["Python"] },

  // Practices, security, domains
  { term: "Agile" },
  { term: "Scrum", implies: ["Agile"] },
  { term: "TDD", aliases: ["test-driven development", "test driven development"] },
  { term: "OAuth", aliases: ["oauth2", "oauth 2.0"] },
  { term: "SSO", aliases: ["single sign-on", "single sign on"] },
  { term: "Payments" },
  { term: "Stripe", implies: ["Payments"] },
  { term: "PCI DSS", aliases: ["pci", "pci-dss"] },
  { term: "SOC 2", aliases: ["soc2"] },
  { term: "GDPR" },
  { term: "Mentoring", aliases: ["mentorship", "mentored"] },
];
