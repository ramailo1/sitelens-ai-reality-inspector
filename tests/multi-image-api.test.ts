/**
 * Multi-image inspection, over the real HTTP API.
 *
 * The unit suite proves the pipeline shape. This file proves the PRODUCT: a real
 * server, a real data directory, real dataset photographs sent over HTTP, and
 * every assertion read back from a server response. A green run here is evidence
 * about the running application, not about a harness.
 *
 * The provider is the deterministic offline fixture and there is no network. That
 * is stated plainly rather than dressed up: what is verified here is the wiring
 * and the reported truth, not that MiniCPM or Nemotron were reachable. The live
 * Nebius run is reported separately.
 *
 * Nothing is left behind: the server is closed and the data directory removed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInspectionServer } from '../src/server.ts';
import { demoCaptures } from '../src/captures.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { WorkspacePersistence } from '../src/persistence.ts';

interface WorkspaceBody {
  readonly project: { readonly id: string } | null;
  readonly activeCaptureId: string | null;
  readonly activeCaptureIds: readonly string[];
  readonly duplicateCaptureIds: readonly string[];
  readonly captures: readonly { readonly id: string }[];
}

interface RunBody {
  readonly outcome: string;
  readonly inferenceOrigin: string;
  readonly images: readonly {
    readonly captureId: string;
    readonly status: string;
    readonly observationCount: number;
  }[];
  readonly observations: readonly { readonly captureId: string }[];
  readonly inspectionFindings: readonly {
    readonly title: string;
    readonly sourceCaptureIds: readonly string[];
    readonly sourceCaptureLabels: readonly string[];
  }[];
}

test('three real photographs become ONE inspection, through the running server', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-multi-api-'));
  const previousDataDir = process.env['SITELENS_DATA_DIR'];
  process.env['SITELENS_DATA_DIR'] = dir;

  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'api test' }),
    persistence: new WorkspacePersistence({ env: process.env }),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  const address = handle.server.address();
  const base = 'http://127.0.0.1:' + (typeof address === 'object' && address !== null ? address.port : 0);

  t.after(() => {
    handle.server.close();
    rmSync(dir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env['SITELENS_DATA_DIR'];
    else process.env['SITELENS_DATA_DIR'] = previousDataDir;
  });

  const postWorkspace = async (path: string, payload: unknown): Promise<number> => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status;
  };
  const upload = async (photo: { bytes: Buffer; mediaType: string; label: string }): Promise<WorkspaceBody> => {
    const res = await fetch(
      base + '/api/upload?name=' + encodeURIComponent(photo.label + '.png')
        + '&type=' + encodeURIComponent(photo.mediaType),
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: photo.bytes },
    );
    return (await res.json()) as WorkspaceBody;
  };
  const workspace = async (): Promise<WorkspaceBody> =>
    (await (await fetch(base + '/api/workspace')).json()) as WorkspaceBody;
  const view = async (): Promise<RunBody> =>
    (await (await fetch(base + '/api/session')).json()) as RunBody;

  // --- a project ---------------------------------------------------------
  assert.equal(await postWorkspace('/api/projects', { name: 'Level 02 re-shoot', location: 'North core' }), 201);
  assert.ok((await workspace()).project !== null);

  // --- three REAL dataset photographs ------------------------------------
  const photos = demoCaptures().slice(0, 3);
  const ids: string[] = [];
  for (const photo of photos) {
    const body = await upload(photo);
    if (body.captures.length > 0) ids.push(body.captures[body.captures.length - 1]!.id);
  }
  assert.equal(ids.length, 3, 'all three real photographs must be accepted');

  // --- ONE group, ONE run, ONE result -----------------------------------
  assert.equal(await postWorkspace('/api/captures/select', { captureIds: ids }), 200);
  assert.equal((await workspace()).activeCaptureIds.length, 3,
    'the workspace must report all three as ONE open group');

  assert.equal(await postWorkspace('/api/run', { captureIds: ids, cache: false }), 200);
  const result = await view();

  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(result.images.length, 3, 'one inspection must report three photographs');
  assert.deepEqual(result.images.map((i) => i.status), ['ANALYSED', 'ANALYSED', 'ANALYSED']);
  assert.ok(result.images.every((i) => i.observationCount > 0),
    'every photograph must have contributed evidence, none analysed to nothing');

  assert.deepEqual(
    [...new Set(result.observations.map((o) => o.captureId))].sort(),
    [...ids].sort(),
    'observations must stay attributed to their own photograph over HTTP',
  );

  // A finding citing SEVERAL photographs is the observable proof that the
  // combined evidence, not the first image alone, produced this result.
  const multi = result.inspectionFindings.filter((f) => f.sourceCaptureIds.length > 1);
  assert.ok(multi.length > 0, 'at least one finding must cite more than one photograph');
  for (const finding of multi) {
    assert.equal(finding.sourceCaptureLabels.length, finding.sourceCaptureIds.length,
      'every source id must carry a label the operator can read');
  }

  // --- a byte-identical copy is refused, and SAID so ---------------------
  await upload(photos[0]!);
  const after = await workspace();
  assert.equal(after.duplicateCaptureIds.length, 1,
    'the workspace must report the refusal, so the UI can say 2 of 3 rather than 3 of 3');
  assert.equal(after.activeCaptureIds.length, 3,
    'a refused duplicate must not change the open group');

  // --- a selection naming something that does not exist is refused --------
  assert.notEqual(await postWorkspace('/api/run', { captureIds: [ids[0], 'cap_does_not_exist'] }), 200,
    'an unknown photograph must not produce an inspection');
});
