# @connorhoehn/event-catalog

A catalog of versioned event contracts shared across a set of services. Each
service declares the events it publishes and consumes, with a JSON Schema for
every payload, and the catalog validates them, tracks who uses what, and checks
that schema changes stay compatible. It covers both ephemeral signals (Redis
pub/sub) and durable events with persistent subscriptions (through
`message-queue`), and ships an admin UI for browsing the registry and watching
live event flow.

It is not a broker. Messages travel over Redis and `message-queue`; this
package holds the declarations, the client library and the registry service.

## What's in the repo

- `src/` - the TypeScript library (declare, publish, subscribe, signal and
  durable transports, dead-letter handling) and the registry HTTP service.
- `src/declarations/` - the event declarations and feature bundles that make up
  the shared contract.
- `src/admin/` - the admin UI, a React app served by the registry service. It
  lists events, schemas, subscribers, bundles, the dead-letter queue and the
  audit log, and shows a live topology of event flow.
- `contracts/` - generated AsyncAPI documents, a hand-maintained OpenAPI
  document and a fingerprint snapshot for downstream CI. See
  [`contracts/README.md`](contracts/README.md).
- `openapi/` - OpenAPI description of the registry's own HTTP API.
- `scripts/` - code generation, snapshot and packaging checks, and a local
  dev-stack launcher.
- `templates/` - CI workflow and git hook templates for linting CRD files against the
  bundle catalog.
- `tests/` - unit, integration and end-to-end tests.
- `dist/` - compiled output, committed so the package installs from git.

## Getting started

Install it as a git dependency. The package's own dependencies are private, so
npm needs an SSH key in your agent:

```bash
npm install github:connorhoehnslalom/event-catalog#<tag-or-commit>
```

Developing in this repo:

```bash
npm install
npm run build        # compile the library and service to dist/
npm test             # unit and integration tests (vitest)
npm run lint         # type-check without emitting
npm run test:e2e     # end-to-end tests (playwright)
```

CI: `.github/workflows/ci.yml` runs typecheck and tests on push; it has not run yet (no GitHub access from the machine that wrote it).

To run the service, `REDIS_URL` is required:

```bash
INSECURE_DEV_MODE=true REDIS_URL=redis://localhost:6379 npm run dev   # service on :3010
npm run dev:stack                              # redis, message-queue and this service
docker compose up --build                      # the same stack in containers
```

Without `EVENT_CATALOG_AUTH_TOKEN` (or an injected auth middleware) the server
refuses to boot unless `INSECURE_DEV_MODE=true` is set and `NODE_ENV` is not
`production`; an unset `NODE_ENV` counts as production. `HOST` defaults to
`127.0.0.1`; the Docker image sets `0.0.0.0`.

To work on the admin UI:

```bash
cd src/admin
npm install
npm run dev          # vite dev server
npm run build        # type-check and bundle
npm test             # component tests
npm run lint
```

From the repo root, `npm run build:admin` and `npm run lint:admin` run the same
build and lint.

Other useful scripts: `npm run generate-types` (payload types),
`npm run generate-asyncapi` and `npm run snapshot:regen` (the files in
`contracts/`).

## Related repositories

- [`connorhoehn/service-runtime`](https://github.com/connorhoehn/service-runtime) -
  shared service helpers, used here for signed service-to-service requests.
- [`connorhoehnslalom/message-queue`](https://github.com/connorhoehnslalom/message-queue) -
  the broker behind durable events.
- [`connorhoehnslalom/ui-components`](https://github.com/connorhoehnslalom/ui-components) -
  the component library the admin UI is built on.

Consumers of the catalog include
[`connorhoehn/realtime-modules`](https://github.com/connorhoehn/realtime-modules),
[`connorhoehn/realtime-examples`](https://github.com/connorhoehn/realtime-examples),
[`connorhoehn/platform-api`](https://github.com/connorhoehn/platform-api) and
[`connorhoehn/live-video-streaming`](https://github.com/connorhoehn/live-video-streaming).

## Documentation

- [`contracts/README.md`](contracts/README.md) - the published contract files
  and how they are generated.
- [`CHANGELOG.md`](CHANGELOG.md) - release history.
