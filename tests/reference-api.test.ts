/**
 * Reference management and project/preset isolation over HTTP.
 *
 * The invariant being protected: a comparison is always attributable to the
 * reference that produced it, and one project's reference never silently
 * becomes another's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectionServer } from '../src/server.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';

const ITEMS = [
  { element: 'COLUMN', expectation: 'COUNT', expectedCount: 4 },
  { element: 'WALL', expectation: 'PRESENT' },
];

interface JsonResult { status: number; body: any }
interface Call {
  json(method: string, path: string, payload?: unknown): Promise<JsonResult>;
}

async function withServer(fn: (call: Call) => Promise<void>): Promise<void> {
  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const call: Call = {
    async json(method, path, payload) {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(base + path, init);
      return { status: res.status, body: await res.json() };
    },
  };

  try {
    await fn(call);
  } finally {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()));
  }
}

test('a new project starts on the default reference', async () => {
  await withServer(async (call) => {
    const res = await call.json('POST', '/api/projects', { name: 'A' });
    assert.equal(res.body.reference.presetId, 'north-core');
    assert.equal(res.body.reference.edited, false);
    assert.equal(res.body.reference.itemCount, 6);
    assert.equal(res.body.reference.deletable, false, 'a built-in reference is not deletable');
  });
});

test('selecting a reference changes what the project compares against', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'A' });
    const res = await call.json('POST', '/api/expected', { presetId: 'south-wing' });
    assert.equal(res.body.reference.presetId, 'south-wing');
    assert.equal(res.body.reference.zone, 'South Wing');
    assert.equal(res.body.reference.itemCount, 3);
  });
});

test('a custom reference can be created, used and deleted', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'A' });
    const created = await call.json('POST', '/api/presets', {
      name: 'Podium Deck', zone: 'Level 01', items: ITEMS,
    });
    assert.equal(created.status, 201);
    const id = created.body.presets.filter((p: { name: string }) => p.name === 'Podium Deck')[0].id;

    const used = await call.json('POST', '/api/expected', { presetId: id });
    assert.equal(used.body.reference.presetId, id);
    assert.equal(used.body.reference.deletable, true);

    const removed = await call.json('DELETE', `/api/presets/${id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.presets.some((p: { id: string }) => p.id === id), false);
  });
});

test('a built-in reference cannot be deleted through the API', async () => {
  await withServer(async (call) => {
    const res = await call.json('DELETE', '/api/presets/north-core');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'SYSTEM_PRESET');
  });
});

test('deleting the reference in use falls back to the default', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'A' });
    const created = await call.json('POST', '/api/presets', { name: 'Temp', zone: 'Z', items: ITEMS });
    const id = created.body.presets.filter((p: { name: string }) => p.name === 'Temp')[0].id;
    await call.json('POST', '/api/expected', { presetId: id });

    const removed = await call.json('DELETE', `/api/presets/${id}`);
    assert.equal(removed.body.reference.presetId, 'north-core');
  });
});

test('renaming a reference is reflected in the workspace payload', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/expected', { presetId: 'south-wing' });
    const res = await call.json('PATCH', '/api/presets/south-wing', { name: 'South Wing — Cladding' });
    assert.equal(res.status, 200);
    assert.equal(res.body.reference.name, 'South Wing — Cladding');
    assert.equal(res.body.reference.edited, true);
  });
});

test('an invalid reference payload is refused with a reason', async () => {
  await withServer(async (call) => {
    assert.equal((await call.json('POST', '/api/presets', { name: '', zone: 'Z', items: ITEMS })).status, 400);
    assert.equal((await call.json('POST', '/api/presets', { name: 'N', zone: 'Z', items: [] })).status, 400);
    const bad = await call.json('POST', '/api/presets', {
      name: 'N', zone: 'Z', items: [{ element: 'NOT_REAL', expectation: 'PRESENT' }],
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'BAD_ELEMENT');
  });
});

test('references do not leak between projects', async () => {
  await withServer(async (call) => {
    const a = await call.json('POST', '/api/projects', { name: 'A' });
    await call.json('POST', '/api/expected', { presetId: 'south-wing' });

    const b = await call.json('POST', '/api/projects', { name: 'B' });
    assert.equal(b.body.reference.presetId, 'north-core', 'B must not inherit A reference');
    assert.equal(b.body.reference.zone, 'North Core');

    const back = await call.json('POST', '/api/projects/switch', { projectId: a.body.project.id });
    assert.equal(back.body.reference.presetId, 'south-wing', 'A keeps its own reference');
  });
});

test('an operator edit is recorded against the project, not the shared reference', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'A' });
    const edited = await call.json('POST', '/api/expected', {
      zone: 'Zone 9', items: [{ element: 'WALL', expectation: 'COUNT', expectedCount: 3 }],
    });
    assert.equal(edited.body.reference.edited, true);
    assert.equal(edited.body.reference.source, 'OPERATOR');
    assert.equal(edited.body.reference.itemCount, 1);

    const listed = edited.body.presets.filter((p: { id: string }) => p.id === 'north-core')[0];
    assert.equal(listed.itemCount, 6, 'the catalogue entry must be untouched');
  });
});

test('changing the reference discards the comparison it produced', async () => {
  await withServer(async (call) => {
    const run = await call.json('POST', '/api/run', {});
    assert.ok(run.body.comparison.length > 0, 'the run must produce rows first');

    const after = await call.json('POST', '/api/expected', { presetId: 'south-wing' });
    assert.equal(
      after.body.view === null || after.body.view.comparison.length === 0,
      true,
      'rows computed against the old reference must not survive',
    );
  });
});

test('re-running after a reference change compares against the new one', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/expected', { presetId: 'south-wing' });
    const run = await call.json('POST', '/api/run', {});
    assert.equal(run.body.comparison.length, 3);
    assert.equal(run.body.expected.zone, 'South Wing');
    assert.equal(run.body.comparison[0].expectedText.includes('facade'), true);
  });
});

test('an unknown reference is refused', async () => {
  await withServer(async (call) => {
    await call.json('POST', '/api/projects', { name: 'A' });
    assert.equal((await call.json('POST', '/api/expected', { presetId: 'nope' })).status, 404);
  });
});