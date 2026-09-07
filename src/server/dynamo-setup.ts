import {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTimeToLiveCommand,
  ResourceInUseException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { LogWriter, type CatalogLogger } from '../utils/logger.js';

const DLQ_TABLE_NAME = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';

function makeDynamoClient(): DynamoDBClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT || process.env.LOCALSTACK_ENDPOINT;
  const localConfig = endpoint
    ? { endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
    : {};
  return new DynamoDBClient({ ...localConfig });
}

async function waitForActive(client: DynamoDBClient, tableName: string): Promise<void> {
  const maxWait = 30_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (desc.Table?.TableStatus === 'ACTIVE') return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Table ${tableName} did not become ACTIVE within ${maxWait}ms`);
}

async function ensureTTL(
  client: DynamoDBClient,
  tableName: string,
  log: LogWriter,
): Promise<void> {
  const ttlDesc = await client.send(
    new DescribeTimeToLiveCommand({ TableName: tableName }),
  );
  const status = ttlDesc.TimeToLiveDescription?.TimeToLiveStatus;
  if (status === 'ENABLED' || status === 'ENABLING') return;

  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: {
        Enabled: true,
        AttributeName: 'ttl',
      },
    }),
  );
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
export async function ensureTable(logger?: CatalogLogger): Promise<void> {
  const client = makeDynamoClient();
  const log = new LogWriter(logger);

  try {
    await client.send(new DescribeTableCommand({ TableName: DLQ_TABLE_NAME }));
    await ensureTTL(client, DLQ_TABLE_NAME, log);
    return;
  } catch (err: unknown) {
    if (!(err instanceof ResourceNotFoundException)) {
      throw err;
    }
  }

  try {
    await client.send(
      new CreateTableCommand({
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
      }),
    );
    log.info(`[dynamo-setup] created table ${DLQ_TABLE_NAME}`, {
      component: 'dynamo-setup',
      table: DLQ_TABLE_NAME,
      action: 'table-created',
    });
  } catch (err: unknown) {
    if (!(err instanceof ResourceInUseException)) {
      throw err;
    }
  }

  await waitForActive(client, DLQ_TABLE_NAME);
  await ensureTTL(client, DLQ_TABLE_NAME, log);
}
