# Yandex Cloud MCP: general-purpose management extension

Date: 2026-10-06. Base: vadyusha/yandex-cloude-mcp main.
Fork: Grenguar/yandex-cloude-mcp. Branch: feat/yandex-cloud-management.

## Objective

Run a tested local Docker MCP server usable from Codex and Claude, with discovery,
read and management operations across Yandex Cloud services. BRICS supplies an
initial real-world validation environment, not hardcoded configuration.
Keep BRICS application code and infrastructure unchanged during development.

## Public contribution requirements

Keep runtime configuration generic: no customer IDs, names, domains, credentials,
or production inventory in committed fixtures or documentation. Preserve the fork
relationship and upstream attribution. Write reusable setup and API documentation
suitable for a future upstream pull request. Keep actual live test details local.

## Evidence and scope

The upstream contains index.ts and a README only. Its three tools list S3 buckets,
list objects and download an object. It has no manifest, build, tests or container.
The BRICS infra/terraform modules and production environment use:

- Resource Manager folders/clouds and IAM service accounts/access bindings.
- Compute VMs, disks, images/snapshots and instance groups.
- Application Load Balancer: load balancers, backend/target groups, routers, virtual hosts.
- VPC networks, subnets, security groups, addresses, gateways and route tables.
- Managed PostgreSQL clusters, databases, users and backups.
- Object Storage buckets and S3 objects; Container Registry repositories/images.
- Lockbox secrets/versions; Certificate Manager certificates; Cloud Logging groups/logs.
- Postbox identities/configuration, and Cloud Quota Manager quotas (including Postbox).

BRICS uses Dragonfly inside its VMs; that is not a separate managed Redis service.
Cloud DNS/Monitoring can be exposed where supported, but must not be described as
confirmed BRICS infrastructure solely from a generic Yandex service catalog.

## Implementation sequence

1. Bootstrap strict TypeScript, pinned dependency lockfile, build/test commands.
   Retain upstream history and document changes to legacy S3 tools.
2. Add Yandex SDK authentication: IAM token/file and service-account key file.
   Use explicit credential sources; do not fall back to VM metadata locally.
   Host-side yc profile support generates tokens without putting keys into the image.
3. Build a bounded service/method registry and request-schema discovery from SDK
   declarations. Validate requests before dispatch; preserve pagination tokens;
   report asynchronous operation IDs without claiming completion. Add get/wait
   operation support with a bounded timeout.
4. Separate Postbox adapter for its documented SES-compatible API; keep S3 object
   support with bounded downloads. SDK is the source of truth for supported gRPC
   services, rather than shell-command execution.
5. Default to read-only. Classify each allowed method, require opt-in for writes,
   expose accurate MCP readOnly/destructive annotations, redact returned credentials,
   bound request duration/output size, and ensure errors do not leak authentication.
6. Package in a non-root Docker image with no embedded credentials. Support stdio
   for client-launched containers and localhost-only Streamable HTTP for a running
   local service. Provide Codex/Claude setup and launch scripts.
7. Validate: typecheck/build, unit and adapter tests, MCP initialize/tools/list/call
   integration tests, Docker smoke tests, and real BRICS read-only service inventory.
   Test write dispatch with mocks; do not start/stop/change production resources or
   send production email as a test. Record permissions/API gaps honestly.
8. Commit and push the feature branch to the user's fork. Do not merge it upstream.

## Completion evidence

- A reproducible Docker build and MCP client connection.
- Working discovery and live read calls for authorized BRICS service APIs.
- Management methods implemented and contract-tested; live mutation scope explicitly
  distinguished from read-only verification.
- Setup documented, local Codex/Claude connection configured, no credentials in Git.

## Sources

- https://github.com/vadyusha/yandex-cloude-mcp
- https://github.com/yandex-cloud/nodejs-sdk
- https://yandex.cloud/en/docs/postbox/api-ref/authentication
- https://yandex.cloud/en/docs/postbox/aws-compatible-api/api-ref/
- https://ts.sdk.modelcontextprotocol.io/server
