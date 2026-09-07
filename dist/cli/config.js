"use strict";
// src/cli/config.ts
//
// One place where every runtime knob the server reads is named, defaulted
// and validated — so a misconfigured deployment dies at boot with a line
// naming the offending variable instead of binding NaN, dialling
// localhost from inside a container, or surfacing a node-redis
// AggregateError with an empty `.message` ten seconds later.
//
// Design rules:
//
//   * PURE. `resolveServerConfig()` takes an env record and CLI flags and
//     returns a result — it never reads `process.env` implicitly, never
//     throws, and never calls `process.exit()`. That keeps it trivially
//     testable and lets the caller decide how to render failures.
//   * ALL errors at once. A container with three bad env vars should need
//     one restart to learn about all three, not three.
//   * Every message names the variable AND the flag that overrides it,
//     because the operator reading a container log has neither the source
//     nor the `--help` output in front of them.
//   * `REDIS_URL` is REQUIRED. It used to default to
//     `redis://localhost:6379`, which is right on a laptop and silently
//     wrong in every container — the service came up "healthy", the
//     registry ran degraded and in-memory, and nothing said why. An
//     explicit value (or an explicit `--redis-url`) is now the contract.
//     `MESSAGE_QUEUE_URL` keeps its default: the durable transport is
//     genuinely optional and its absence is already visible on /health.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS = exports.DEFAULT_SUBSCRIBER_TTL_SECONDS = exports.DEFAULT_DLQ_TABLE_NAME = exports.DEFAULT_MESSAGE_QUEUE_URL = exports.DEFAULT_HOSTNAME = exports.DEFAULT_PORT = void 0;
exports.resolveServerConfig = resolveServerConfig;
exports.describeConfig = describeConfig;
exports.redactUrl = redactUrl;
exports.DEFAULT_PORT = 3010;
exports.DEFAULT_HOSTNAME = '0.0.0.0';
exports.DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3004';
exports.DEFAULT_DLQ_TABLE_NAME = 'event-catalog-dlq';
exports.DEFAULT_SUBSCRIBER_TTL_SECONDS = 1800;
exports.DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS = 3;
/** Treat "" the same as unset — an empty env var in compose is not a value. */
function read(env, name) {
    const raw = env[name];
    if (raw === undefined)
        return undefined;
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
}
function describeSource(flag, flagName, envName) {
    return flag !== undefined ? `--${flagName}` : `$${envName}`;
}
/**
 * Parse an integer that must be exactly an integer — `Number()` accepts
 * "3.5", " 3 ", "0x10" and "1e3", all of which silently become a port or a
 * TTL nobody typed.
 */
function parseIntStrict(raw) {
    if (!/^[+-]?\d+$/.test(raw))
        return undefined;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : undefined;
}
function validateUrl(raw, protocols) {
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return 'is not a valid URL';
    }
    if (!protocols.includes(parsed.protocol)) {
        return `must use ${protocols.map(p => `${p}//`).join(' or ')} (got "${parsed.protocol}//")`;
    }
    if (parsed.hostname === '')
        return 'is missing a hostname';
    return undefined;
}
/**
 * Resolve + validate the server's runtime configuration.
 *
 * Never throws. On failure returns every problem found, each as one line
 * naming the variable (or flag) at fault and what was expected.
 */
function resolveServerConfig(env, flags = {}) {
    const errors = [];
    const warnings = [];
    // --- port ---------------------------------------------------------------
    // EVENT_CATALOG_PORT is accepted because that is the name CLAUDE.md and the
    // deploy notes have always used, while the code only ever read PORT — so
    // setting the documented variable silently left the service on 3010.
    const envPortName = read(env, 'PORT') !== undefined ? 'PORT' : 'EVENT_CATALOG_PORT';
    const rawPort = flags.port ?? read(env, 'PORT') ?? read(env, 'EVENT_CATALOG_PORT');
    let port = exports.DEFAULT_PORT;
    if (rawPort !== undefined) {
        const parsed = parseIntStrict(rawPort);
        if (parsed === undefined || parsed < 0 || parsed > 65535) {
            errors.push(`invalid ${describeSource(flags.port, 'port', envPortName)} "${rawPort}" — `
                + 'expected an integer between 0 and 65535');
        }
        else {
            port = parsed;
        }
    }
    if (read(env, 'PORT') !== undefined && read(env, 'EVENT_CATALOG_PORT') !== undefined
        && read(env, 'PORT') !== read(env, 'EVENT_CATALOG_PORT')) {
        warnings.push(`$PORT (${read(env, 'PORT')}) and $EVENT_CATALOG_PORT `
            + `(${read(env, 'EVENT_CATALOG_PORT')}) disagree — using $PORT.`);
    }
    // --- hostname -----------------------------------------------------------
    // AdmissionHttpServer defaults to 127.0.0.1, which is unreachable from
    // outside a container; 0.0.0.0 is the deployment-correct default.
    const hostname = read(env, 'HOST') ?? exports.DEFAULT_HOSTNAME;
    // --- redis --------------------------------------------------------------
    const rawRedis = flags['redis-url'] ?? read(env, 'REDIS_URL');
    let redisUrl = '';
    if (rawRedis === undefined) {
        errors.push('$REDIS_URL is required and was not set — the registry, the signal '
            + 'transport and the audit log all need it. Set it (e.g. '
            + 'REDIS_URL=redis://localhost:6379) or pass --redis-url=<url>.');
    }
    else {
        const problem = validateUrl(rawRedis, ['redis:', 'rediss:']);
        if (problem) {
            errors.push(`invalid ${describeSource(flags['redis-url'], 'redis-url', 'REDIS_URL')} "${rawRedis}" — it ${problem}`);
        }
        else {
            redisUrl = rawRedis;
        }
    }
    // --- message-queue ------------------------------------------------------
    const rawMq = flags['message-queue-url'] ?? read(env, 'MESSAGE_QUEUE_URL');
    let messageQueueUrl = exports.DEFAULT_MESSAGE_QUEUE_URL;
    if (rawMq === undefined) {
        warnings.push(`$MESSAGE_QUEUE_URL is unset — defaulting to ${exports.DEFAULT_MESSAGE_QUEUE_URL}. `
            + 'Durable publishes will fail until message-queue is reachable there.');
    }
    else {
        const problem = validateUrl(rawMq, ['http:', 'https:']);
        if (problem) {
            errors.push(`invalid ${describeSource(flags['message-queue-url'], 'message-queue-url', 'MESSAGE_QUEUE_URL')} `
                + `"${rawMq}" — it ${problem}`);
        }
        else {
            messageQueueUrl = rawMq;
        }
    }
    // --- DLQ table ----------------------------------------------------------
    const dlqTableName = read(env, 'DLQ_TABLE_NAME') ?? exports.DEFAULT_DLQ_TABLE_NAME;
    // --- subscriber sweep TTL ----------------------------------------------
    const rawTtl = read(env, 'SUBSCRIBER_TTL_SECONDS');
    let subscriberTtlSeconds = exports.DEFAULT_SUBSCRIBER_TTL_SECONDS;
    if (rawTtl !== undefined) {
        const parsed = parseIntStrict(rawTtl);
        if (parsed === undefined || parsed < 0) {
            errors.push(`invalid $SUBSCRIBER_TTL_SECONDS "${rawTtl}" — expected a `
                + 'non-negative integer (0 disables the heartbeat sweeper)');
        }
        else {
            subscriberTtlSeconds = parsed;
        }
    }
    // --- boot-bounded redis reconnect budget -------------------------------
    const rawAttempts = read(env, 'REDIS_BOOT_CONNECT_ATTEMPTS');
    let redisBootConnectAttempts = exports.DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS;
    if (rawAttempts !== undefined) {
        const parsed = parseIntStrict(rawAttempts);
        if (parsed === undefined || parsed < 1) {
            errors.push(`invalid $REDIS_BOOT_CONNECT_ATTEMPTS "${rawAttempts}" — `
                + 'expected an integer >= 1');
        }
        else {
            redisBootConnectAttempts = parsed;
        }
    }
    // --- strict mode --------------------------------------------------------
    // Historically this was `=== 'true'`, so EVENT_CATALOG_STRICT=1 and
    // =yes silently meant "not strict". Accept the obvious spellings and
    // reject anything else rather than guessing.
    const rawStrict = read(env, 'EVENT_CATALOG_STRICT');
    let strict = false;
    if (rawStrict !== undefined) {
        const lowered = rawStrict.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(lowered))
            strict = true;
        else if (['false', '0', 'no', 'off'].includes(lowered))
            strict = false;
        else {
            errors.push(`invalid $EVENT_CATALOG_STRICT "${rawStrict}" — expected true or false`);
        }
    }
    // --- optional URLs ------------------------------------------------------
    const rawAlert = read(env, 'ALERT_WEBHOOK_URL');
    if (rawAlert !== undefined) {
        const problem = validateUrl(rawAlert, ['http:', 'https:']);
        if (problem)
            errors.push(`invalid $ALERT_WEBHOOK_URL "${rawAlert}" — it ${problem}`);
    }
    const rawDynamo = read(env, 'DYNAMODB_ENDPOINT') ?? read(env, 'LOCALSTACK_ENDPOINT');
    if (rawDynamo !== undefined) {
        const problem = validateUrl(rawDynamo, ['http:', 'https:']);
        if (problem) {
            errors.push(`invalid $${read(env, 'DYNAMODB_ENDPOINT') !== undefined ? 'DYNAMODB_ENDPOINT' : 'LOCALSTACK_ENDPOINT'} `
                + `"${rawDynamo}" — it ${problem}`);
        }
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        warnings,
        config: {
            port,
            hostname,
            redisUrl,
            messageQueueUrl,
            dlqTableName,
            subscriberTtlSeconds,
            redisBootConnectAttempts,
            strict,
            alertWebhookUrl: rawAlert,
            dynamoEndpoint: rawDynamo,
        },
    };
}
/** One line per setting, for the startup banner. Never prints credentials. */
function describeConfig(config) {
    return [
        `port                        ${config.port}`,
        `host                        ${config.hostname}`,
        `redis                       ${redactUrl(config.redisUrl)}`,
        `message-queue               ${redactUrl(config.messageQueueUrl)}`,
        `dlq table                   ${config.dlqTableName}`,
        `subscriber ttl (s)          ${config.subscriberTtlSeconds || 'disabled'}`,
        `redis boot attempts         ${config.redisBootConnectAttempts}`,
        `strict declarations         ${config.strict}`,
    ];
}
/**
 * Strip userinfo from a URL before logging it — `redis://:hunter2@host`
 * in a container log is a credential leak, and Redis URLs routinely
 * carry one.
 */
function redactUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.username || u.password) {
            u.username = '***';
            u.password = '';
        }
        return u.toString();
    }
    catch {
        return raw;
    }
}
//# sourceMappingURL=config.js.map