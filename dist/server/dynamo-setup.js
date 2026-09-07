"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTable = ensureTable;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const logger_js_1 = require("../utils/logger.js");
const DLQ_TABLE_NAME = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';
function makeDynamoClient() {
    const endpoint = process.env.DYNAMODB_ENDPOINT || process.env.LOCALSTACK_ENDPOINT;
    const localConfig = endpoint
        ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
        : {};
    return new client_dynamodb_1.DynamoDBClient({ ...localConfig });
}
async function waitForActive(client, tableName) {
    const maxWait = 30_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        const desc = await client.send(new client_dynamodb_1.DescribeTableCommand({ TableName: tableName }));
        if (desc.Table?.TableStatus === 'ACTIVE')
            return;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Table ${tableName} did not become ACTIVE within ${maxWait}ms`);
}
async function ensureTTL(client, tableName, log) {
    const ttlDesc = await client.send(new client_dynamodb_1.DescribeTimeToLiveCommand({ TableName: tableName }));
    const status = ttlDesc.TimeToLiveDescription?.TimeToLiveStatus;
    if (status === 'ENABLED' || status === 'ENABLING')
        return;
    await client.send(new client_dynamodb_1.UpdateTimeToLiveCommand({
        TableName: tableName,
        TimeToLiveSpecification: {
            Enabled: true,
            AttributeName: 'ttl',
        },
    }));
    log.info(`[dynamo-setup] TTL enabled on ${tableName}`, {
        component: 'dynamo-setup',
        table: tableName,
        action: 'ttl-enabled',
    });
}
/**
 * Provision the DLQ table if it is missing. Runs once at boot.
 *
 * `logger` is threaded from `ServerConfig`; omitted, the two lines below
 * go to `console.log` exactly as they always did.
 */
async function ensureTable(logger) {
    const client = makeDynamoClient();
    const log = new logger_js_1.LogWriter(logger);
    try {
        await provision(client, log);
    }
    finally {
        // This client is boot-scoped and nothing else ever uses it, but the
        // AWS SDK's default request handler pools keep-alive sockets, and a
        // pooled socket is a `ref`'d handle. Left undestroyed it kept the
        // event loop alive on its own — with no variable still pointing at it,
        // the shutdown path could not have released it even in principle.
        client.destroy();
    }
}
async function provision(client, log) {
    try {
        await client.send(new client_dynamodb_1.DescribeTableCommand({ TableName: DLQ_TABLE_NAME }));
        await ensureTTL(client, DLQ_TABLE_NAME, log);
        return;
    }
    catch (err) {
        if (!(err instanceof client_dynamodb_1.ResourceNotFoundException)) {
            throw err;
        }
    }
    try {
        await client.send(new client_dynamodb_1.CreateTableCommand({
            TableName: DLQ_TABLE_NAME,
            KeySchema: [
                { AttributeName: 'pk', KeyType: 'HASH' },
                { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
            AttributeDefinitions: [
                { AttributeName: 'pk', AttributeType: 'S' },
                { AttributeName: 'sk', AttributeType: 'S' },
            ],
            BillingMode: 'PAY_PER_REQUEST',
        }));
        log.info(`[dynamo-setup] created table ${DLQ_TABLE_NAME}`, {
            component: 'dynamo-setup',
            table: DLQ_TABLE_NAME,
            action: 'table-created',
        });
    }
    catch (err) {
        if (!(err instanceof client_dynamodb_1.ResourceInUseException)) {
            throw err;
        }
    }
    await waitForActive(client, DLQ_TABLE_NAME);
    await ensureTTL(client, DLQ_TABLE_NAME, log);
}
//# sourceMappingURL=dynamo-setup.js.map