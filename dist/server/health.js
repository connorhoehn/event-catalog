"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeHealthHandler = makeHealthHandler;
const DEFAULT_TIMEOUT_MS = 5000;
async function runWithTimeout(check, timeoutMs) {
    const start = Date.now();
    let timer;
    try {
        const result = await Promise.race([
            check.check(),
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`health check '${check.id}' timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
        const report = {
            id: check.id,
            status: result.status,
            durationMs: Date.now() - start,
        };
        if (result.details !== undefined) {
            report.details = result.details;
        }
        return report;
    }
    catch (err) {
        return {
            id: check.id,
            status: 'unhealthy',
            durationMs: Date.now() - start,
            details: { error: err instanceof Error ? err.message : String(err) },
        };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function rollup(reports) {
    if (reports.some((r) => r.status === 'unhealthy'))
        return 'unhealthy';
    if (reports.some((r) => r.status === 'degraded'))
        return 'degraded';
    return 'healthy';
}
function makeHealthHandler(opts) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return async function healthHandler(_req, res) {
        const reports = await Promise.all(opts.checks.map((c) => runWithTimeout(c, timeoutMs)));
        const status = rollup(reports);
        const httpCode = status === 'unhealthy' ? 503 : 200;
        const body = {
            service: opts.service,
            version: opts.version,
            status,
            checks: reports,
            timestamp: new Date().toISOString(),
        };
        res.status(httpCode).json(body);
    };
}
//# sourceMappingURL=health.js.map