import {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTimeToLiveCommand,
  ResourceInUseException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';

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

async function ensureTTL(client: DynamoDBClient, tableName: string): Promise<void> {
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
  console.log(`[dynamo-setup] TTL enabled on ${tableName}`);
}

export async function ensureTable(): Promise<void> {
  const client = makeDynamoClient();

  try {
    await client.send(new DescribeTableCommand({ TableName: DLQ_TABLE_NAME }));
    await ensureTTL(client, DLQ_TABLE_NAME);
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
    console.log(`[dynamo-setup] created table ${DLQ_TABLE_NAME}`);
  } catch (err: unknown) {
    if (!(err instanceof ResourceInUseException)) {
      throw err;
    }
  }

  await waitForActive(client, DLQ_TABLE_NAME);
  await ensureTTL(client, DLQ_TABLE_NAME);
}
