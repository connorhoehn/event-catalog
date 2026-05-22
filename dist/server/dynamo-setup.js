"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTable = ensureTable;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
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
async function ensureTTL(client, tableName) {
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
    console.log(`[dynamo-setup] TTL enabled on ${tableName}`);
}
async function ensureTable() {
    const client = makeDynamoClient();
    try {
        await client.send(new client_dynamodb_1.DescribeTableCommand({ TableName: DLQ_TABLE_NAME }));
        await ensureTTL(client, DLQ_TABLE_NAME);
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
        console.log(`[dynamo-setup] created table ${DLQ_TABLE_NAME}`);
    }
    catch (err) {
        if (!(err instanceof client_dynamodb_1.ResourceInUseException)) {
            throw err;
        }
    }
    await waitForActive(client, DLQ_TABLE_NAME);
    await ensureTTL(client, DLQ_TABLE_NAME);
}
//# sourceMappingURL=dynamo-setup.js.map