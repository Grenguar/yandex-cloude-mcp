# Validation record

Validated locally on 2026-10-06 against SDK 3.2.0 and the Docker image built from this branch.
The server exposes 8 MCP tools, 42 SDK services (389 unary methods), and a Postbox
adapter (21 methods). BRICS was the initial read-only validation environment;
configuration, schemas and fixtures contain no customer resource identifiers.

## Automated checks

- Build and generated catalog: passed.
- Strict TypeScript check including source, scripts and tests: passed.
- 22 automated tests: passed, with no skipped tests.
- Formatting: passed.
- Dependency audit: zero reported vulnerabilities at validation time.
- Docker build and localhost HTTP health check: passed.

Tests cover every advertised SDK method's service/request-codec resolution,
request validation, enum conversion, explicit authentication and token rotation,
read/write classification, pagination, bounded operation waits, cancellation,
redaction, output limits, Postbox request contracts, and S3 download boundaries.
MCP integration tests exercise initialization, discovery, calls and errors through
real SDK transports, plus HTTP bearer authentication, host and origin checks.

Write dispatch is tested with mocked backends, including IAM, ALB, instance groups,
PostgreSQL, Lockbox and Postbox. These tests establish adapter behavior; they do
not establish that every cloud API accepts every possible request or IAM policy.
The cloud API remains responsible for required-field and cross-field constraints.

## Live read-only checks

`npm run smoke` completed 23 calls through the running container: IAM service
accounts; Compute instances, instance groups and operations; ALB load balancers,
backend groups and HTTP routers; VPC networks, subnets and security groups;
PostgreSQL clusters; Storage buckets; Container Registry; Lockbox secret metadata;
Certificate Manager; Logging groups and a bounded log read; Postbox identities,
identity details and configuration sets; Resource Manager folder details; and
cloud-level Postbox quota limits.

The smoke script refuses to run when writes are enabled and prints only counts
and statuses. Existing authorized service-account credentials were used; no cloud
resources, IAM roles or keys were created or changed, and no email was sent.

Both client paths completed initialization, listed all 8 tools and performed a
live Compute read:

- Local stdio bridge to the authenticated Docker HTTP endpoint.
- Direct Docker stdio transport.

Codex was configured with the local bridge; a new session is required to discover
it. Claude Code's connection check reported connected. Client configuration stores
the bridge path, with credentials read from ignored local files.

## Boundaries

Live checks cover representative reads, not all 410 methods. No live mutations,
S3 object downloads or email sends were performed. IAM permissions and populated
resources vary by deployment. DNS and Monitoring dashboards are available in the
catalog but were not part of the live environment checks. Arbitrary log/object
contents are not guaranteed secret-free by field-based output redaction.

Reproduce the local checks with:

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run format:check
npm audit
docker compose up -d --build
npm run smoke
npx tsx scripts/verify-clients.ts
```

The last three commands require Docker and configured local credentials. Keep
`.local/`, `.env`, cloud inventory and test logs out of version control.
