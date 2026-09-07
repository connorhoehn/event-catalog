import { MetricsRegistry, formatPrometheus } from 'distributed-core';
import type { MetricSample } from 'distributed-core';
import type { Counter, Gauge } from 'distributed-core/monitoring';

/**
 * Prom-formatted metrics surface for the event-catalog service.
 *
 * Separate from `MetricsCollector` (which powers the JSON admin API
 * with per-event stats). This registry is dedicated to the
 * Prometheus `/metrics` scrape endpoint.
 *
 * The two classes both register a metric named `publish_total` but
 * label it differently (`{event}` there, `{event, transport, mode}`
 * here), so they must never share a namespace: one metric family with
 * inconsistent label names is invalid exposition and a scraper drops
 * the whole family. `event_catalog` belongs to this file;
 * `MetricsCollector` uses `COLLECTOR_METRIC_NAMESPACE`
 * (`event_catalog_stats`) so the names stay distinct even if the two
 * registries are ever merged or the JSON one is ever rendered.
 *
 * ## Metric families
 *
 * Publish / consumer flow:
 *   - event_catalog_publish_total{event, transport, mode}          counter
 *   - event_catalog_publish_failures_total{event, reason}          counter
 *   - event_catalog_schema_fetches_total{event}                    counter
 *   - event_catalog_schema_evolution_rejections_total{event, mode} counter
 *
 * Backlog / saturation:
 *   - event_catalog_dlq_entries{event}                             gauge
 *   - event_catalog_dlq_oldest_age_seconds                         gauge
 *   - event_catalog_sse_streams_active                             gauge
 *   - event_catalog_sse_streams_max                                gauge
 *   - event_catalog_sse_streams_rejected_total                     counter
 *
 * Dependency + inventory health:
 *   - event_catalog_transport_up{transport}                        gauge (1/0)
 *   - event_catalog_transport_probe_latency_seconds{transport}     gauge
 *   - event_catalog_registry_events                                gauge
 *   - event_catalog_poisoned_events                                gauge
 *
 * Self-observability:
 *   - event_catalog_metric_label_overflow_total{label}             counter
 *
 * The metric names match the Prometheus convention even though
 * MetricsRegistry uses dotted names internally — `formatPrometheus`
 * rewrites `.` → `_` on render. Counters carry `_total`; gauges do
 * not. Every duration is in seconds and says so in its name.
 *
 * ## Cardinality
 *
 * Two label values on this surface come from input the service does not
 * control: the `event` label, and it reaches us from three places that
 * are NOT all bounded by the ~200 committed declarations —
 *
 *   1. `recordSchemaFetch` / `recordPublish` — a registry name, and the
 *      registry is writable over HTTP (`POST /api/events`, and
 *      `/api/events/bulk` takes 1000 at a time with no ceiling on
 *      requests).
 *   2. `recordFailure` from the dead-letter hook — the `eventName` off a
 *      dead-lettered envelope, which never passed through
 *      `validateEventName` and is frequently an event the catalog has
 *      never heard of (that is often *why* it dead-lettered).
 *   3. `setDLQEntries` from the DLQ scan — same provenance as (2).
 *
 * An unbounded label value is how you take down a Prometheus server, so
 * every event label goes through `eventLabel()`: the first
 * `maxEventLabels` distinct names get their own series and everything
 * after that collapses into `event="other"`, with the collapse itself
 * counted so an operator can see the allowlist is undersized rather
 * than silently losing detail. `transport` / `mode` / `reason` /
 * `transport-name` are closed sets, enforced at runtime rather than
 * trusted from the type signature.
 *
 * ## Escaping
 *
 * distributed-core's `formatPrometheus` interpolates label values into
 * `key="value"` with no escaping at all, so a single event name
 * containing a `"` renders a malformed exposition line and Prometheus
 * drops the ENTIRE scrape — every metric, not just that series.
 * `validateEventName` rejects only control characters, so `evt"x` is a
 * perfectly declarable name today, and DLQ-sourced names bypass that
 * validation entirely. Label values are therefore escaped here, before
 * they are handed to the registry.
 */
/**
 * Namespace prefixed onto every metric rendered at `/metrics`.
 * Owned exclusively by this class — see the class doc above.
 */
export const PROM_METRIC_NAMESPACE = 'event_catalog';

export type PublishMode = 'strict' | 'warn' | 'off';
export type FailureReason = 'schema' | 'transport' | 'network';
export type TransportName = 'redis' | 'message-queue';

/** Closed sets — anything outside them is bucketed rather than trusted. */
const PUBLISH_MODES: ReadonlySet<string> = new Set(['strict', 'warn', 'off']);
const TRANSPORTS: ReadonlySet<string> = new Set(['signal', 'durable', 'both']);
const FAILURE_REASONS: ReadonlySet<string> = new Set(['schema', 'transport', 'network']);
const TRANSPORT_NAMES: ReadonlySet<string> = new Set(['redis', 'message-queue']);

/** Label value used for anything outside a closed set or past the cap. */
export const OVERFLOW_LABEL = 'other';

/**
 * Ceiling on distinct `event` label values across the whole surface.
 *
 * The committed registry snapshot holds 194 events; 512 leaves generous
 * head-room for legitimate growth while keeping the worst-case series
 * count on this endpoint in the low thousands. Override with
 * `EVENT_CATALOG_MAX_METRIC_EVENT_LABELS`.
 */
export const DEFAULT_MAX_EVENT_LABELS = 512;

/**
 * Ceiling on the rendered length of one label value.
 * `MAX_EVENT_NAME_LENGTH` is 512 characters, which is a lot of bytes to
 * repeat on every series of every scrape.
 */
export const MAX_LABEL_VALUE_LENGTH = 200;

/**
 * Escape a label value for the Prometheus text exposition format.
 *
 * The format escapes exactly three characters inside a quoted label
 * value: `\`, `"` and newline. Other C0 control characters and DEL are
 * not escapable and break line-oriented parsers, so they are dropped —
 * they cannot appear in a declared name (`validateEventName` rejects
 * them) but can arrive on the DLQ path.
 */
export function escapeLabelValue(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (code <= 0x1f || code === 0x7f) continue;
    else out += ch;
  }
  return out;
}

/** Escape, then bound the length so one name cannot bloat every scrape. */
function sanitizeLabelValue(raw: string): string {
  const escaped = escapeLabelValue(raw);
  if (escaped.length <= MAX_LABEL_VALUE_LENGTH) return escaped;
  // Truncating could land on a lone trailing backslash and re-break the
  // escaping, so trim any odd run of trailing backslashes back off.
  let cut = escaped.slice(0, MAX_LABEL_VALUE_LENGTH);
  let trailing = 0;
  while (trailing < cut.length && cut[cut.length - 1 - trailing] === '\\') trailing++;
  if (trailing % 2 === 1) cut = cut.slice(0, -1);
  return cut;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export interface PromMetricsOptions {
  /** Max distinct `event` label values before collapsing to `other`. */
  maxEventLabels?: number;
}

export class PromMetrics {
  private readonly registry: MetricsRegistry;
  private readonly publishCounters = new Map<string, Counter>();
  private readonly failureCounters = new Map<string, Counter>();
  private readonly schemaFetchCounters = new Map<string, Counter>();
  private readonly evolutionCounters = new Map<string, Counter>();
  private readonly dlqGauges = new Map<string, Gauge>();
  private readonly transportUpGauges = new Map<string, Gauge>();
  private readonly transportLatencyGauges = new Map<string, Gauge>();
  private readonly overflowCounters = new Map<string, Counter>();
  private readonly collectors = new Set<() => void>();

  /** raw event name → bounded, escaped label value. */
  private readonly eventLabels = new Map<string, string>();
  private readonly maxEventLabels: number;

  private registryGauge: Gauge | null = null;
  private poisonedGauge: Gauge | null = null;
  private dlqOldestAgeGauge: Gauge | null = null;
  private sseActiveGauge: Gauge | null = null;
  private sseMaxGauge: Gauge | null = null;
  private sseRejectedCounter: Counter | null = null;

  constructor(registry?: MetricsRegistry, options: PromMetricsOptions = {}) {
    // Use 'event_catalog' as namespace so the rendered name becomes
    // `event_catalog_publish_total` (formatPrometheus joins namespace
    // and name with `_`).
    this.registry = registry ?? new MetricsRegistry('event-catalog', { namespace: PROM_METRIC_NAMESPACE });
    this.maxEventLabels = options.maxEventLabels
      ?? envInt('EVENT_CATALOG_MAX_METRIC_EVENT_LABELS', DEFAULT_MAX_EVENT_LABELS);
  }

  // -------------------------------------------------------------------
  // Label bounding
  // -------------------------------------------------------------------

  /**
   * Map a raw event name to the label value used on the wire.
   *
   * The first `maxEventLabels` distinct names each get a series; every
   * name after that collapses into `other` so an unbounded source (a
   * DLQ full of undeclared names, a flooded bulk-declare) cannot mint
   * unbounded series. The collapse is itself counted.
   */
  private eventLabel(raw: string): string {
    const cached = this.eventLabels.get(raw);
    if (cached !== undefined) return cached;
    if (this.eventLabels.size >= this.maxEventLabels) {
      this.overflow('event');
      return OVERFLOW_LABEL;
    }
    const value = sanitizeLabelValue(raw);
    this.eventLabels.set(raw, value);
    return value;
  }

  /** Constrain a value to a closed set, bucketing anything unexpected. */
  private closed(value: string, allowed: ReadonlySet<string>, label: string): string {
    if (allowed.has(value)) return value;
    this.overflow(label);
    return OVERFLOW_LABEL;
  }

  private overflow(label: string): void {
    let counter = this.overflowCounters.get(label);
    if (!counter) {
      counter = this.registry.counter(
        'metric_label_overflow_total',
        { label },
        'Times a label value was bucketed into "other" because it exceeded the cardinality cap or fell outside its closed set.',
      );
      this.overflowCounters.set(label, counter);
    }
    counter.inc();
  }

  /** Distinct event label values currently held (for tests / diagnostics). */
  get eventLabelCount(): number {
    return this.eventLabels.size;
  }

  // -------------------------------------------------------------------
  // Publish flow
  // -------------------------------------------------------------------

  /** Record an observed publish on the catalog service. */
  recordPublish(event: string, transport: 'signal' | 'durable' | 'both', mode: PublishMode = 'off'): void {
    const e = this.eventLabel(event);
    const t = this.closed(transport, TRANSPORTS, 'transport');
    const m = this.closed(mode, PUBLISH_MODES, 'mode');
    const key = `${e}|${t}|${m}`;
    let counter = this.publishCounters.get(key);
    if (!counter) {
      counter = this.registry.counter(
        'publish_total',
        { event: e, transport: t, mode: m },
        'Total events published through the catalog, by transport and validation mode.',
      );
      this.publishCounters.set(key, counter);
    }
    counter.inc();
  }

  /** Record a publish failure with categorical reason. */
  recordFailure(event: string, reason: FailureReason): void {
    const e = this.eventLabel(event);
    const r = this.closed(reason, FAILURE_REASONS, 'reason');
    const key = `${e}|${r}`;
    let counter = this.failureCounters.get(key);
    if (!counter) {
      counter = this.registry.counter(
        'publish_failures_total',
        { event: e, reason: r },
        'Total publish failures, categorized by failure mode.',
      );
      this.failureCounters.set(key, counter);
    }
    counter.inc();
  }

  /** Record a schema fetch (used by consumers pulling declarations). */
  recordSchemaFetch(event: string): void {
    const e = this.eventLabel(event);
    let counter = this.schemaFetchCounters.get(e);
    if (!counter) {
      counter = this.registry.counter(
        'schema_fetches_total',
        { event: e },
        'Total schema fetches from the catalog registry.',
      );
      this.schemaFetchCounters.set(e, counter);
    }
    counter.inc();
  }

  /**
   * Record a declaration rejected by the schema-evolution compat gate.
   *
   * `mode` is the enforcement level the gate was running at, so a
   * dashboard can separate "we blocked this" (`strict`) from "we would
   * have blocked this" (`warn`) — the second is what tells an operator a
   * strict rollout is safe.
   */
  recordEvolutionRejection(event: string, mode: 'warn' | 'strict'): void {
    const e = this.eventLabel(event);
    const m = this.closed(mode, PUBLISH_MODES, 'mode');
    const key = `${e}|${m}`;
    let counter = this.evolutionCounters.get(key);
    if (!counter) {
      counter = this.registry.counter(
        'schema_evolution_rejections_total',
        { event: e, mode: m },
        'Declarations rejected (strict) or flagged (warn) by the schema-evolution compatibility gate.',
      );
      this.evolutionCounters.set(key, counter);
    }
    counter.inc();
  }

  // -------------------------------------------------------------------
  // DLQ
  // -------------------------------------------------------------------

  /**
   * Set the current DLQ depth for one event.
   *
   * Prefer `syncDLQEntries` for a periodic refresh: this method only
   * ever raises or lowers gauges it is told about, so an event whose
   * DLQ has drained keeps reporting its last non-zero depth forever.
   */
  setDLQEntries(event: string, count: number): void {
    this.dlqGauge(this.eventLabel(event)).set(count);
  }

  /**
   * Replace the whole DLQ-depth picture from one scan.
   *
   * Every event present in `counts` is set to its count and every event
   * that has a gauge but is absent from `counts` is set to 0 — an event
   * whose DLQ drained must read zero, not keep displaying the depth it
   * had the last time it was non-empty. Gauges are zeroed rather than
   * deleted so `rate`/`delta` queries see the drop instead of a series
   * that silently vanishes.
   *
   * Callers must not invoke this with a partial scan (e.g. after the DLQ
   * store threw) — that would report an empty DLQ during exactly the
   * outage where the depth matters.
   */
  syncDLQEntries(counts: ReadonlyMap<string, number>): void {
    const seen = new Set<string>();
    for (const [event, count] of counts) {
      const label = this.eventLabel(event);
      // Overflowed names all share the `other` label, so accumulate
      // rather than overwrite or the last one wins.
      const gauge = this.dlqGauge(label);
      gauge.set(seen.has(label) ? gauge.get() + count : count);
      seen.add(label);
    }
    for (const [label, gauge] of this.dlqGauges) {
      if (!seen.has(label)) gauge.set(0);
    }
  }

  /** Age of the oldest entry anywhere in the DLQ, in seconds. */
  setDLQOldestAgeSeconds(seconds: number): void {
    if (!this.dlqOldestAgeGauge) {
      this.dlqOldestAgeGauge = this.registry.gauge(
        'dlq_oldest_age_seconds',
        {},
        'Age in seconds of the oldest entry in the dead-letter queue; 0 when the DLQ is empty.',
      );
    }
    this.dlqOldestAgeGauge.set(seconds);
  }

  private dlqGauge(label: string): Gauge {
    let gauge = this.dlqGauges.get(label);
    if (!gauge) {
      gauge = this.registry.gauge(
        'dlq_entries',
        { event: label },
        'Current dead-letter queue depth per event.',
      );
      this.dlqGauges.set(label, gauge);
    }
    return gauge;
  }

  // -------------------------------------------------------------------
  // SSE saturation
  // -------------------------------------------------------------------

  /**
   * Current and maximum concurrent SSE streams.
   *
   * Both are exported so saturation is a single query
   * (`active / max`) instead of requiring the operator to remember what
   * `DEFAULT_MAX_SSE_STREAMS` was compiled as. `max` is 0 when the cap
   * is disabled.
   */
  setSseStreams(active: number, max: number): void {
    if (!this.sseActiveGauge) {
      this.sseActiveGauge = this.registry.gauge(
        'sse_streams_active',
        {},
        'Currently open Server-Sent-Events streams across /api/flow and /api/audit.',
      );
    }
    if (!this.sseMaxGauge) {
      this.sseMaxGauge = this.registry.gauge(
        'sse_streams_max',
        {},
        'Configured ceiling on concurrent SSE streams; 0 when the cap is disabled.',
      );
    }
    this.sseActiveGauge.set(active);
    this.sseMaxGauge.set(max);
  }

  /** An SSE connection was refused because the cap was already reached. */
  recordSseRejected(): void {
    if (!this.sseRejectedCounter) {
      this.sseRejectedCounter = this.registry.counter(
        'sse_streams_rejected_total',
        {},
        'SSE connections refused because the concurrent-stream cap was saturated.',
      );
    }
    this.sseRejectedCounter.inc();
  }

  // -------------------------------------------------------------------
  // Dependency health + inventory
  // -------------------------------------------------------------------

  /** 1 when the transport's last probe was connected, 0 otherwise. */
  setTransportUp(transport: TransportName, up: boolean): void {
    const t = this.closed(transport, TRANSPORT_NAMES, 'transport_name');
    let gauge = this.transportUpGauges.get(t);
    if (!gauge) {
      gauge = this.registry.gauge(
        'transport_up',
        { transport: t },
        'Whether the last health probe of this transport succeeded (1) or not (0).',
      );
      this.transportUpGauges.set(t, gauge);
    }
    gauge.set(up ? 1 : 0);
  }

  /**
   * Last observed health-probe latency for a transport, in seconds.
   *
   * `SignalTransport.healthCheck()` / `DurableTransport.healthCheck()`
   * report milliseconds; convert at the call site, because the metric
   * name promises seconds.
   */
  setTransportProbeLatencySeconds(transport: TransportName, seconds: number): void {
    const t = this.closed(transport, TRANSPORT_NAMES, 'transport_name');
    let gauge = this.transportLatencyGauges.get(t);
    if (!gauge) {
      gauge = this.registry.gauge(
        'transport_probe_latency_seconds',
        { transport: t },
        'Latency in seconds of the most recent health probe against this transport.',
      );
      this.transportLatencyGauges.set(t, gauge);
    }
    gauge.set(seconds);
  }

  /**
   * Events currently marked poisoned by `PoisonEventDetector`.
   *
   * Kept as a single count rather than a per-event series: the names are
   * the same unbounded source as everything else here, and the alert an
   * operator wants is "anything is poisoned", with
   * `GET /api/events/poisoned` for the detail.
   */
  setPoisonedEvents(count: number): void {
    if (!this.poisonedGauge) {
      this.poisonedGauge = this.registry.gauge(
        'poisoned_events',
        {},
        'Events currently marked poisoned for exceeding the rolling failure threshold.',
      );
    }
    this.poisonedGauge.set(count);
  }

  /** Number of declarations currently in the registry. */
  setRegistrySize(count: number): void {
    if (!this.registryGauge) {
      this.registryGauge = this.registry.gauge(
        'registry_events',
        {},
        'Number of event declarations currently held in the registry.',
      );
    }
    this.registryGauge.set(count);
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  /**
   * Register a scrape-time collector for pull-style values (registry
   * size, SSE occupancy, transport health). Returns an unregister fn.
   *
   * Collectors run immediately before the snapshot is taken so a gauge
   * reflects the moment of the scrape rather than the last time
   * something happened to push it. A throwing collector is swallowed:
   * one broken source must not take the whole endpoint down.
   */
  collect(fn: () => void): () => void {
    this.collectors.add(fn);
    return () => this.collectors.delete(fn);
  }

  /** Render the registry as Prometheus text format. */
  renderProm(): string {
    for (const fn of this.collectors) {
      try {
        fn();
      } catch (err) {
        console.warn('[prom-metrics] collector failed:', (err as Error).message);
      }
    }
    return renderExposition(this.registry.getSnapshot());
  }

  /** Expose the underlying registry (for tests / advanced wiring). */
  getRegistry(): MetricsRegistry {
    return this.registry;
  }
}

// -------------------------------------------------------------------
// Exposition rendering
// -------------------------------------------------------------------

/**
 * Cached `name{label="value",…}` prefix for one series.
 *
 * Keyed on the labels object rather than a string, because
 * `MetricsRegistry` builds that object exactly once — at
 * `counter()`/`gauge()` registration time, as
 * `{...defaultLabels, ...labels}` — stores it on the series, and hands
 * back that same reference in every subsequent `getSnapshot()`. So:
 *
 *   - a new series is a new object, therefore a guaranteed cache miss;
 *   - an existing series' labels never change, so an entry can never
 *     go stale (only the metric's numeric VALUE moves between scrapes,
 *     and that is read fresh every time — it is not part of the key or
 *     the cached string);
 *   - a WeakMap means a dropped registry is collected with its cache.
 *
 * One labels object belongs to exactly one series, so the metric name
 * does not need to be part of the key.
 *
 * This exists because `labelStr` inside distributed-core's
 * `formatPrometheus` is 42% of the whole `/metrics` render: it does an
 * `Object.keys().sort().map().join()` for all ~470 series on every
 * single scrape, to rebuild strings that are byte-identical to the
 * ones it built on the previous scrape. Nothing about the scrape can
 * change them.
 */
const seriesPrefixes = new WeakMap<object, string>();

/** Mangled (`.` → `_`) metric names, also invariant per series name. */
const mangledNames = new Map<string, string>();

function mangleName(name: string): string {
  let mangled = mangledNames.get(name);
  if (mangled === undefined) {
    mangled = name.replace(/\./g, '_');
    mangledNames.set(name, mangled);
  }
  return mangled;
}

/** `mangled_name{a="1",b="2"}` — computed once per series, then cached. */
function seriesPrefix(sample: MetricSample): string {
  const cached = seriesPrefixes.get(sample.labels);
  if (cached !== undefined) return cached;
  const keys = Object.keys(sample.labels).sort();
  const mangled = mangleName(sample.name);
  const prefix = keys.length === 0
    ? mangled
    : `${mangled}{${keys.map((k) => `${k}="${sample.labels[k]}"`).join(',')}}`;
  seriesPrefixes.set(sample.labels, prefix);
  return prefix;
}

/**
 * Render a registry snapshot as Prometheus text exposition format
 * (0.0.4), byte-for-byte identical to distributed-core's
 * `formatPrometheus` — see `tests/prom-render-equivalence.test.ts`,
 * which asserts exactly that against a populated registry so an
 * upstream format change cannot silently diverge from this copy.
 *
 * The only reason it is not just a call to `formatPrometheus` is the
 * per-series prefix cache above. Everything else is the same walk:
 * group samples by metric name so all label-variants share one
 * `# TYPE` header, emit an optional `# HELP`, then one line per series
 * carrying the scrape timestamp.
 *
 * Histograms are NOT reimplemented here — `PromMetrics` registers only
 * counters and gauges, and the histogram branch involves an
 * interpolated bucket estimate that is not worth duplicating. A
 * snapshot containing one falls straight through to `formatPrometheus`,
 * so a future histogram is a performance regression rather than a
 * correctness bug.
 */
export function renderExposition(snapshot: {
  timestamp: number;
  nodeId: string;
  metrics: MetricSample[];
}): string {
  const { metrics, timestamp } = snapshot;
  if (metrics.length === 0) return '';

  const groups = new Map<string, MetricSample[]>();
  for (const sample of metrics) {
    if (sample.type === 'histogram') return formatPrometheus(snapshot);
    const existing = groups.get(sample.name);
    if (existing) existing.push(sample);
    else groups.set(sample.name, [sample]);
  }

  const lines: string[] = [];
  for (const [baseName, samples] of groups) {
    const mangled = mangleName(baseName);
    const help = samples[0].help;
    if (help !== undefined) lines.push(`# HELP ${mangled} ${help}`);
    lines.push(`# TYPE ${mangled} ${samples[0].type}`);
    for (const sample of samples) {
      lines.push(`${seriesPrefix(sample)} ${sample.value as number} ${timestamp}`);
    }
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push('');
  return lines.join('\n');
}
