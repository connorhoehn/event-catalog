// src/server/routes/events.ts
//
// The /api/events family: listing, single-event reads (schema fetch),
// declaration (single + bulk), deletion, bulk export, and the
// poison / producer-attribution side-surfaces that hang off an event.

import type { Request, Response } from '../http-router.js';
import { computeSchemaFingerprint } from '../../registry/fingerprint.js';
import { auditEmitter } from '../audit-emitter.js';
import type { EventDeclaration, TransportType } from '../../types/index.js';
import {
  badRequest,
  enumParam,
  eventNotFound,
  isJsonObject,
  jsonBody,
  resolveParams,
  singleParam,
  type ParamResult,
  type RoutesDeps,
} from './_shared.js';
import {
  MAX_BULK_EVENTS,
  MAX_BULK_EXPORT_NAMES,
  validateEventName,
  withinArrayLimit,
} from './limits.js';

/** The transport values `?transport=` accepts, mirroring TransportType. */
const TRANSPORTS: readonly TransportType[] = ['signal', 'durable', 'both'];

/**
 * EC-7 — resolve the effective compat-gate enforcement level for a POST
 * /events request. Precedence:
 *   1. incoming declaration's `compatMode` (operator changing it for this
 *      registration, including the first one)
 *   2. existing registry entry's `compatMode` (sticky from prior decl)
 *   3. per-request header `x-event-catalog-strict: true` ⇒ 'strict'
 *   4. env var `EVENT_CATALOG_STRICT=true` ⇒ 'strict'
 *   5. fallback: 'off'
 */
function resolveCompatMode(
  incoming: 'off' | 'warn' | 'strict' | undefined,
  existing: 'off' | 'warn' | 'strict' | undefined,
  headerStrict: boolean,
  envStrict: boolean,
): 'off' | 'warn' | 'strict' {
  if (incoming) return incoming;
  if (existing) return existing;
  if (headerStrict) return 'strict';
  if (envStrict) return 'strict';
  return 'off';
}

export function createEventHandlers(deps: RoutesDeps) {
  const {
    registry, metrics, metricsObserver, signal, promMetrics,
    manifestStore, attribution, poisonDetector, coordinator,
  } = deps;

  // List all events
  function list(req: Request, res: Response): void {
    // Every filter is single-valued: a repeated key used to be cast
    // straight through as `string`, so `?transport=a&transport=b` put an
    // array into RegistryFilter and quietly returned an empty list.
    const q = resolveParams(res, {
      transport: enumParam(req, 'transport', TRANSPORTS),
      producer: singleParam(req, 'producer'),
      subscriber: singleParam(req, 'subscriber'),
      tag: singleParam(req, 'tag'),
      // Phase E7 — namespace filter.
      namespace: singleParam(req, 'namespace'),
    });
    if (!q) return;

    const entries = registry.list(q);

    const enriched = entries.map(entry => ({
      ...entry,
      stats: metrics.getStats(entry.name),
    }));

    res.json({ events: enriched, total: enriched.length });
  }

  // wave26-e — list all poisoned events (MUST be registered before
  // /events/:name to avoid clash)
  function listPoisoned(_req: Request, res: Response): void {
    const poisoned = poisonDetector ? poisonDetector.listPoisoned() : [];
    res.json({ count: poisoned.length, items: poisoned });
  }

  // Get single event — also serves as the schema-fetch endpoint for
  // downstream validators (Wave 3 EC-6).
  //
  // Optional `?version=N` selects a historical version from
  // schemaHistory; otherwise the latest schema is returned. Response
  // is the full RegistryEntry plus stats for backwards compatibility
  // with the admin UI, plus an explicit `validationMode` field that
  // defaults to `off` system-wide (per-event overrides arrive in EC-7).
  function get(req: Request, res: Response): void {
    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }

    // Parse + validate ?version=N before counting the fetch — a 400
    // shouldn't bump the consumer-pull counter.
    let selectedVersion = entry.version;
    let selectedSchema = entry.schema;
    const versionParam = singleParam(req, 'version');
    if (!versionParam.ok) {
      badRequest(res, versionParam.error);
      return;
    }
    const rawVersion = versionParam.value;
    if (rawVersion !== undefined) {
      const parsed = Number(rawVersion);
      if (!Number.isInteger(parsed) || parsed < 1) {
        badRequest(res, `version must be a positive integer, got "${String(rawVersion)}"`);
        return;
      }
      if (parsed !== entry.version) {
        const historical = entry.schemaHistory.find(h => h.version === parsed);
        if (!historical) {
          res.status(404).json({
            error: `Version ${parsed} not found in history for "${entry.name}"`,
          });
          return;
        }
        selectedVersion = historical.version;
        selectedSchema = historical.schema;
      }
    }

    // Every GET on an event's declaration counts as a schema fetch —
    // surfaces consumer-pull demand in /metrics.
    promMetrics?.recordSchemaFetch(entry.name);

    // EC-6: validation mode defaults to `off` system-wide so MQ rollout
    // stays safe; per-event overrides land in EC-7.
    const validationMode: 'off' | 'warn' | 'strict' = 'off';

    res.json({
      ...entry,
      // Override version + schema when ?version=N selected a historical
      // entry. Other fields (producer, transport, etc.) reflect the
      // current declaration.
      version: selectedVersion,
      schema: selectedSchema,
      validationMode,
      stats: metrics.getStats(entry.name),
    });
  }

  /**
   * Resolve the proposed schema for a compat check from whichever
   * transport the caller used.
   *
   * The route was originally GET-with-a-JSON-body, which browsers cannot
   * send and many proxies and HTTP clients drop — the check was therefore
   * unreachable for a large class of callers. POST-with-a-body is now the
   * canonical form; the GET route stays for existing CI callers and takes
   * the schema as a URL-encoded JSON `?schema=` param instead. A body is
   * still honored on either method so nothing that works today breaks.
   */
  function readProposedSchema(req: Request): ParamResult<Record<string, unknown> | undefined> {
    const fromBody = jsonBody(req)?.schema;
    if (fromBody !== undefined) {
      if (!isJsonObject(fromBody)) {
        return { ok: false, error: 'schema must be a JSON object' };
      }
      return { ok: true, value: fromBody };
    }

    const fromQuery = singleParam(req, 'schema');
    if (!fromQuery.ok) return fromQuery;
    if (fromQuery.value === undefined) return { ok: true, value: undefined };

    let parsed: unknown;
    try {
      parsed = JSON.parse(fromQuery.value);
    } catch {
      return { ok: false, error: '?schema= must be a URL-encoded JSON object' };
    }
    if (!isJsonObject(parsed)) {
      return { ok: false, error: 'schema must be a JSON object' };
    }
    return { ok: true, value: parsed };
  }

  // Check schema compatibility without declaring
  function checkSchema(req: Request, res: Response): void {
    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }

    const proposed = readProposedSchema(req);
    if (!proposed.ok) {
      badRequest(res, proposed.error);
      return;
    }
    const schema = proposed.value;
    if (!schema) {
      badRequest(
        res,
        'schema is required — send it in the request body (POST) '
        + 'or as a URL-encoded JSON ?schema= query param (GET)',
      );
      return;
    }

    const result = registry.checkSchemaCompat(req.params.name, schema);
    res.json({
      eventName: req.params.name,
      currentVersion: entry.version,
      compatibilityMode: entry.compatibilityMode,
      ...result,
    });
  }

  // Get event stats
  function stats(req: Request, res: Response): void {
    const found = metrics.getStats(req.params.name);
    if (!found) {
      res.status(404).json({ error: `No stats for "${req.params.name}"` });
      return;
    }
    res.json(found);
  }

  // Get event history (recent messages)
  async function history(req: Request, res: Response): Promise<void> {
    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }

    const countParam = singleParam(req, 'count');
    if (!countParam.ok) {
      badRequest(res, countParam.error);
      return;
    }
    const count = parseInt(countParam.value ?? '', 10) || 50;

    if (entry.transport === 'signal') {
      const messages = await signal.getHistory(entry.name, count);
      res.json({ messages, transport: 'signal' });
    } else {
      // For durable, we don't have a peek — return empty for now
      res.json({ messages: [], transport: 'durable', note: 'Durable history via message-queue peek not yet implemented' });
    }
  }

  // Declare/register an event
  async function declare(req: Request, res: Response): Promise<void> {
    const {
      name, schema, transport, producer, description, tags, compatibilityMode, compatMode,
      // E3 fields:
      channel, discriminator, queue, retention, fifo, dlqAfterAttempts, dlqRetention, aliases,
      // E7 — explicit namespace (auto-derived if absent).
      namespace,
    } = req.body as Partial<EventDeclaration>;

    if (!name || !transport || !producer) {
      badRequest(res, 'name, transport, and producer are required');
      return;
    }

    if (transport !== 'signal' && transport !== 'durable' && transport !== 'both') {
      badRequest(res, 'transport must be "signal", "durable", or "both"');
      return;
    }

    // Reject names that can't survive being used as an object key or a
    // log/SSE line before anything is written to the registry.
    const nameError = validateEventName(name);
    if (nameError) {
      badRequest(res, nameError);
      return;
    }

    // EC-7 — resolve enforcement BEFORE mutating the registry, then run
    // the same compat check the library uses against the prior version.
    // If strict and breaking, return 409 without applying the update so
    // the registry stays on the prior valid schema.
    const existing = registry.get(name);
    const headerStrict = req.header('x-event-catalog-strict') === 'true';
    const envStrict = process.env.EVENT_CATALOG_STRICT === 'true';
    const effectiveMode = resolveCompatMode(
      compatMode,
      existing?.compatMode,
      headerStrict,
      envStrict,
    );

    if (existing && schema && Object.keys(schema).length > 0 && effectiveMode !== 'off') {
      const compat = registry.checkSchemaCompat(name, schema);
      if (!compat.compatible) {
        // Recorded in both modes: the `mode` label separates changes the gate
        // actually blocked from ones it only would have, which is what tells
        // you whether flipping an event to strict is safe yet.
        promMetrics?.recordEvolutionRejection(name, effectiveMode === 'strict' ? 'strict' : 'warn');
        if (effectiveMode === 'strict') {
          // Phase E6 — surface both fingerprints on the 409 so the caller
          // can confirm in one round-trip whether their local cache matches
          // the registry's current schema vs. the proposed one.
          res.status(409).json({
            error: {
              code: 'COMPAT_VIOLATION',
              eventName: name,
              violations: compat.violations,
              currentFingerprint: existing.schemaFingerprint,
              proposedFingerprint: computeSchemaFingerprint(schema),
            },
          });
          return;
        }
        // 'warn' — fall through to declare, but log advisory. The
        // violations are also surfaced on the 201 response below.
        console.warn(
          `[event-catalog] compat-warn for "${name}": ${compat.violations.join('; ')}`,
        );
      }
    }

    // wave23-c — manifest-aware deploy gate. When `?check-manifests=`
    // is set and a fingerprint change is proposed, look up every
    // pinned consumer manifest and find ones whose pin matches the
    // CURRENT fingerprint (those consumers think they're fresh; the
    // proposed declare would silently make them stale).
    //
    //   strict → 409 with affected_consumers list, no declare
    //   warn   → 201 with affected_consumers field, declare proceeds
    //   off    → no check (default)
    const affectedConsumers: Array<{ consumerName: string; pinnedFingerprint: string }> = [];
    const checkManifestsMode = (() => {
      const q = req.query['check-manifests'];
      if (q === 'strict' || q === 'warn' || q === 'off') return q;
      return 'off';
    })();
    if (
      manifestStore
      && checkManifestsMode !== 'off'
      && existing
      && schema
      && Object.keys(schema).length > 0
    ) {
      const proposedFp = computeSchemaFingerprint(schema);
      if (proposedFp !== existing.schemaFingerprint) {
        const all = await manifestStore.list();
        for (const m of all) {
          for (const evt of m.events) {
            if (evt.name === name && evt.fingerprint === existing.schemaFingerprint) {
              affectedConsumers.push({
                consumerName: m.consumerName,
                pinnedFingerprint: evt.fingerprint,
              });
              break; // one entry per consumer is enough
            }
          }
        }
        if (affectedConsumers.length > 0 && checkManifestsMode === 'strict') {
          res.status(409).json({
            error: {
              code: 'PINNED_CONSUMER_BREAK',
              eventName: name,
              currentFingerprint: existing.schemaFingerprint,
              proposedFingerprint: proposedFp,
              affectedConsumers,
            },
          });
          return;
        }
        if (affectedConsumers.length > 0) {
          console.warn(
            `[event-catalog] check-manifests warn: declare("${name}") would stale ${affectedConsumers.length} pinned consumer(s)`,
          );
        }
      }
    }

    // Snapshot the prior version BEFORE Registry.declare runs (it
    // mutates `existing` in place, so reading existing.version
    // afterwards gives us the new value).
    const priorVersion = existing?.version;

    let result: ReturnType<typeof registry.declare>;
    try {
      result = registry.declare({
        name,
        schema: schema ?? {},
        transport,
        producer,
        description,
        tags,
        compatibilityMode,
        ...(typeof namespace === 'string' && namespace.length > 0 ? { namespace } : {}),
        ...(compatMode ? { compatMode } : {}),
        // Pass through E3 fields when present. `channel` and `partitionKey`
        // can be functions which don't serialize over HTTP, so only the
        // string form of `channel` is accepted here.
        ...(typeof channel === 'string' ? { channel } : {}),
        ...(discriminator ? { discriminator } : {}),
        ...(queue ? { queue } : {}),
        ...(typeof retention === 'number' ? { retention } : {}),
        ...(typeof fifo === 'boolean' ? { fifo } : {}),
        ...(typeof dlqAfterAttempts === 'number' ? { dlqAfterAttempts } : {}),
        ...(typeof dlqRetention === 'number' ? { dlqRetention } : {}),
        ...(aliases ? { aliases } : {}),
      });
    } catch (err) {
      badRequest(res, (err as Error).message);
      return;
    }

    metricsObserver.observe(name, transport).catch(() => {});

    // wave22-d — audit emit. priorVersion was captured above before
    // Registry.declare mutated existing in place.
    const after = registry.get(name);
    if (after) {
      auditEmitter.publish({
        kind: priorVersion !== undefined && after.version > priorVersion
          ? 'event.version.bumped'
          : 'event.declared',
        timestamp: new Date().toISOString(),
        eventName: after.name,
        namespace: after.namespace,
        version: after.version,
        fingerprint: after.schemaFingerprint,
        violations: result.violations,
      });
    }

    // wave26-d — broadcast to peer replicas.
    const declaredEntry = registry.get(name);
    if (declaredEntry) {
      coordinator?.broadcast('declare', declaredEntry).catch(() => {});
    }

    const response: Record<string, unknown> = {
      declared: name,
      version: result.version,
      compatible: result.compatible,
      // Phase E6 — return the fingerprint so consumers can cache it
      // immediately rather than re-fetching via GET /api/events/:name.
      schemaFingerprint: result.schemaFingerprint,
    };
    if (result.violations) {
      response.violations = result.violations;
    }
    // wave23-c — surface warn-mode pinned-consumer breaks on the 201
    // so CI can flag deploys that are technically allowed but would
    // stale a pinned consumer's manifest.
    if (affectedConsumers.length > 0) {
      response.affectedConsumers = affectedConsumers;
      // Emit a drift audit event so operators see manifest staleness in
      // the real-time audit SSE stream without polling the drift report.
      const afterDrift = registry.get(name);
      auditEmitter.publish({
        kind: 'event.manifest.drift',
        timestamp: new Date().toISOString(),
        eventName: name,
        namespace: afterDrift?.namespace,
        version: afterDrift?.version,
        fingerprint: afterDrift?.schemaFingerprint,
        affectedConsumers,
      });
    }
    res.status(201).json(response);
  }

  // Bulk register events (called by services at startup)
  function declareBulk(req: Request, res: Response): void {
    const { serviceName, events } = req.body as {
      serviceName?: string;
      events?: Array<Partial<EventDeclaration>>;
    };

    if (!serviceName || !events || !Array.isArray(events)) {
      badRequest(res, 'serviceName and events[] are required');
      return;
    }
    // The 1 MiB body cap bounds the bytes, not the number of registry
    // entries + metric handles + Redis writes one request creates.
    if (!withinArrayLimit(res, events, MAX_BULK_EVENTS, 'events')) return;

    const declared: string[] = [];
    const rejected: Array<{ name: string; error: string }> = [];

    for (const event of events) {
      if (!event.name || !event.transport) continue;

      const nameError = validateEventName(event.name);
      if (nameError) {
        rejected.push({ name: event.name.slice(0, 128), error: nameError });
        continue;
      }

      // Snapshot the prior version BEFORE declare mutates `before` in
      // place (same gotcha as the singleton route above).
      const priorVersion = registry.get(event.name)?.version;
      try {
        registry.declare({
          name: event.name,
          schema: event.schema ?? {},
          transport: event.transport,
          producer: event.producer ?? serviceName,
          description: event.description,
          tags: event.tags,
          // Phase E7 — pass through explicit namespace if provided; the
          // Registry auto-derives from the event name otherwise.
          ...(typeof event.namespace === 'string' && event.namespace.length > 0
            ? { namespace: event.namespace }
            : {}),
        });
      } catch (err) {
        console.warn(`[event-catalog] bulk declare skipped "${event.name}":`, (err as Error).message);
        continue;
      }

      // wave22-d — emit one audit record per declared event in the bulk.
      const after = registry.get(event.name);
      if (after) {
        auditEmitter.publish({
          kind: priorVersion !== undefined && after.version > priorVersion
            ? 'event.version.bumped'
            : 'event.declared',
          timestamp: new Date().toISOString(),
          eventName: after.name,
          namespace: after.namespace,
          version: after.version,
          fingerprint: after.schemaFingerprint,
        });
      }

      metricsObserver.observe(event.name, event.transport).catch(() => {});
      declared.push(event.name);
      // wave26-d — broadcast each declared event to peer replicas.
      if (after) coordinator?.broadcast('declare', after).catch(() => {});
    }

    // `rejected` is omitted entirely on a clean bulk so the response
    // shape existing callers parse is unchanged.
    res.status(201).json({
      declared,
      count: declared.length,
      ...(rejected.length > 0 ? { rejected } : {}),
    });
  }

  // wave26-c — observed vs declared producer attribution
  function observedProducers(req: Request, res: Response): void {
    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }
    const declared = Array.isArray(entry.producer) ? entry.producer : [entry.producer];
    const observed = attribution ? attribution.getObserved(req.params.name) : [];
    const declaredSet = new Set(declared);
    const observedSet = new Set(observed);
    const undeclaredProducers = observed.filter(p => !declaredSet.has(p));
    const deadDeclaredProducers = declared.filter(p => !observedSet.has(p));
    res.json({
      eventName: req.params.name,
      declared,
      observed,
      undeclaredProducers,
      deadDeclaredProducers,
      mismatch: undeclaredProducers.length > 0 || deadDeclaredProducers.length > 0,
    });
  }

  // wave26-e — clear (dismiss) poison state for one event
  function clearPoison(req: Request, res: Response): void {
    if (!poisonDetector) {
      res.status(404).json({ error: 'poison detector not enabled' });
      return;
    }
    const entry = registry.get(req.params.name);
    const cleared = poisonDetector.clearPoison(req.params.name);
    if (cleared && entry) {
      auditEmitter.publish({
        kind: 'event.poison.cleared',
        timestamp: new Date().toISOString(),
        eventName: req.params.name,
        namespace: entry.namespace,
        version: entry.version,
      });
    }
    res.json({ cleared: req.params.name, wasPoison: cleared });
  }

  // wave26-f — bulk export event schemas as JSON archive
  function exportBulk(req: Request, res: Response): void {
    const namesParam = singleParam(req, 'names');
    if (!namesParam.ok) {
      badRequest(res, namesParam.error);
      return;
    }
    const nameList: string[] = (namesParam.value ?? '')
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);
    if (!withinArrayLimit(res, nameList, MAX_BULK_EXPORT_NAMES, 'names')) return;

    const entries = nameList.length > 0
      ? nameList.map(n => registry.get(n)).filter(Boolean)
      : registry.list();

    const archive = {
      exportedAt: new Date().toISOString(),
      eventCount: entries.length,
      events: entries.map(e => ({
        name: e!.name,
        namespace: e!.namespace,
        transport: e!.transport,
        producer: e!.producer,
        version: e!.version,
        schemaFingerprint: e!.schemaFingerprint,
        schema: e!.schema,
        description: e!.description,
        tags: e!.tags,
        deprecation: e!.deprecation,
      })),
    };

    res.setHeader('Content-Disposition', 'attachment; filename="event-catalog-export.json"');
    res.json(archive);
  }

  // Delete an event declaration
  function remove(req: Request, res: Response): void {
    const before = registry.get(req.params.name);
    const removed = registry.remove(req.params.name);
    if (!removed) {
      eventNotFound(res, req.params.name);
      return;
    }
    if (before) {
      auditEmitter.publish({
        kind: 'event.removed',
        timestamp: new Date().toISOString(),
        eventName: before.name,
        namespace: before.namespace,
        version: before.version,
      });
    }
    coordinator?.broadcast('remove', { name: req.params.name }).catch(() => {});
    res.json({ removed: req.params.name });
  }

  return {
    list,
    listPoisoned,
    get,
    checkSchema,
    stats,
    history,
    declare,
    declareBulk,
    observedProducers,
    clearPoison,
    exportBulk,
    remove,
  };
}
