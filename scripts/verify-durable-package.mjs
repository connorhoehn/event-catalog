import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'catalog-durable-package-'));
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: repo, encoding: 'utf8' }));
  assert.ok(pack.filename);
  const target = join(temporary, 'node_modules/@connorhoehn/event-catalog');
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', join(temporary, pack.filename), '--strip-components=1', '-C', target]);
  // Only dependencies come from the installed SHA-pinned tree. Catalog source
  // and sibling repositories cannot supply a missing packed runtime artifact.
  symlinkSync(join(repo, 'node_modules'), join(target, 'node_modules'), 'dir');
  writeFileSync(join(temporary, 'verify.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DurableTransport } from '@connorhoehn/event-catalog/durable';
import { EventCatalog } from '@connorhoehn/event-catalog';
const require = createRequire(import.meta.url);
assert.equal(require('@connorhoehn/event-catalog/durable').DurableTransport, DurableTransport);
assert.equal(require('@connorhoehn/event-catalog').EventCatalog, EventCatalog);
assert.equal(Object.keys(require.cache).some(p => /message-queue[\\\\/]dist[\\\\/]server/.test(p)), false);
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  const body = url.endsWith('/ready') ? { status: 'ready' } : init.method === 'PUT' ? { status: 'created' } : { message_id: 'accepted' };
  return new Response(JSON.stringify(body));
};
const transport = new DurableTransport({ url: 'http://packed.invalid' });
await transport.connect();
await transport.publish('work.fifo', { eventName: 'work:requested', payload: {}, metadata: { id: 'stable', producer: 'packed', timestamp: 1 } }, { fifo: true }, { groupId: 'team' });
assert.deepEqual(JSON.parse(calls.at(-1).init.body).message_deduplication_id, 'stable');
await transport.disconnect();
console.log('Packed catalog root/durable import + require identity and owner-client publish passed on ' + process.version);
`);
  execFileSync(process.execPath, [join(temporary, 'verify.mjs')], { stdio: 'inherit', timeout: 15000 });
  writeFileSync(join(temporary, 'consumer.ts'), `
import { EventCatalog, type DurableHandlerContext, type PublishOptions } from '@connorhoehn/event-catalog';
import { DurableTransport, type DurableSubscription } from '@connorhoehn/event-catalog/durable';
const options: PublishOptions = { groupId: 'team', deduplicationId: 'event', signal: new AbortController().signal };
export async function consume(catalog: EventCatalog, transport: DurableTransport) {
  await catalog.publish('work:requested', {}, options);
  const subscription: DurableSubscription = transport.subscribe('work', async (_, context: DurableHandlerContext) => { context.signal.throwIfAborted(); });
  subscription(); await subscription.done;
}
`);
  writeFileSync(join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, noEmit: true, skipLibCheck: true,
  }, files: ['consumer.ts'] }));
  execFileSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(temporary, 'tsconfig.json')], { stdio: 'inherit', timeout: 30000 });
  console.log('Packed catalog durable public types compile');
} finally { rmSync(temporary, { recursive: true, force: true }); }
