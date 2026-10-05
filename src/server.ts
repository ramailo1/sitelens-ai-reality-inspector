/**
 * Local inspection server.
 *
 * Serves the Reality Inspector UI and a small JSON API over a single inspection
 * session. It binds to loopback only: this is a local demonstration surface, not
 * a service, and it must not be reachable off the machine.
 *
 * The API never returns the API key, the base URL or provider internals.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createProvider, ProviderError } from './providers/factory.ts';
import { InspectionSession, listCaptures, findCapture } from './session.ts';
import type { SessionView } from './session.ts';
import { defaultCapture } from './captures.ts';
import type { DemoCapture } from './captures.ts';
import type { AIProvider } from './providers/provider.ts';
import { acceptCapture, MAX_CAPTURE_BYTES } from './upload.ts';
import { INDEX_HTML, APP_CSS, APP_JS } from './ui-assets.ts';
import {
  DEFAULT_EXPECTED_PRESET_ID,
  EXPECTED_PRESETS,
  cloneExpectedState,
  defaultExpectedState,
  findExpectedPreset,
} from './expected-state.ts';
import { inspectionCache } from './cache.ts';
import type { ExpectedState } from './types/inspection.ts';
import { ELEMENT_KINDS, EXPECTATIONS } from './types/inspection.ts';

const LOOPBACK = '127.0.0.1';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/**
 * Read a request body, refusing anything past the cap.
 *
 * Streamed and counted rather than accumulated blindly, so an oversized upload
 * is rejected while it is still arriving.
 */
async function readBody(
  req: IncomingMessage,
  limitBytes = 64 * 1024,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limitBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Read a JSON request body. */
async function readJsonBody(req: IncomingMessage, limitBytes?: number): Promise<string> {
  return (await readBody(req, limitBytes)).toString('utf8');
}

export interface ServerOptions {
  readonly provider: AIProvider;
  readonly projectId: string | null;
  readonly zoneId: string | null;
  readonly initialCaptureId: string | null;
}

/**
 * Resolve an expected-state payload from the browser.
 *
 * Two shapes are accepted: a preset id (the fast demo path) or an explicit
 * item list (the real path). An explicit list from the browser is ALWAYS marked
 * `source: 'OPERATOR'`, so a preset can never be passed off as the project's own
 * programme and an operator edit can never be passed off as a preset.
 *
 * Every field is re-validated here: the browser is an untrusted client even
 * though it is loopback-only.
 */
export function resolveExpectedState(
  payload: unknown,
): { ok: true; state: ExpectedState } | { ok: false; reason: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'expected state must be a JSON object' };
  }
  const record = payload as Record<string, unknown>;

  // Shape 1: pick a named preset.
  const presetId = record['presetId'];
  if (typeof presetId === 'string' && presetId.length > 0) {
    const preset = findExpectedPreset(presetId);
    if (preset === null) return { ok: false, reason: `unknown preset: ${presetId}` };
    return { ok: true, state: cloneExpectedState(preset) };
  }

  // Shape 2: an explicit list.
  const items = record['items'];
  if (!Array.isArray(items)) {
    return { ok: false, reason: 'expected state must supply presetId or an items array' };
  }

  const zoneRaw = record['zone'];
  const zone = typeof zoneRaw === 'string' && zoneRaw.trim().length > 0 ? zoneRaw.trim() : 'Unspecified zone';

  const parsed: ExpectedState['items'][number][] = [];
  for (const [index, raw] of items.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, reason: `items[${index}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;
    const element = entry['element'];
    const expectation = entry['expectation'];
    if (typeof element !== 'string' || !(ELEMENT_KINDS as readonly string[]).includes(element)) {
      return { ok: false, reason: `items[${index}].element is not a known element kind` };
    }
    if (
      typeof expectation !== 'string' ||
      !(EXPECTATIONS as readonly string[]).includes(expectation)
    ) {
      return { ok: false, reason: `items[${index}].expectation must be PRESENT, COUNT or ABSENT` };
    }
    const countRaw = entry['expectedCount'];
    let expectedCount: number | null = null;
    if (expectation === 'COUNT') {
      if (
        typeof countRaw !== 'number' ||
        !Number.isInteger(countRaw) ||
        countRaw < 0 ||
        countRaw > 500
      ) {
        return { ok: false, reason: `items[${index}] needs an integer expectedCount` };
      }
      expectedCount = countRaw;
    }
    const note = typeof entry['note'] === 'string' ? entry['note'].slice(0, 200) : '';

    parsed.push({
      id: typeof entry['id'] === 'string' && entry['id'].length > 0 ? entry['id'] : `exp_${index}`,
      element: element as ExpectedState['items'][number]['element'],
      expectation: expectation as ExpectedState['items'][number]['expectation'],
      expectedCount,
      note,
    });
  }

  return {
    ok: true,
    state: { zone, items: parsed, source: 'OPERATOR' },
  };
}

export interface InspectionServerHandle {
  readonly server: ReturnType<typeof createServer>;
  session: InspectionSession;
}

export function createInspectionServer(options: ServerOptions): InspectionServerHandle {
  const initialCapture = findCapture(options.initialCaptureId ?? '') ?? defaultCapture();

  let session = new InspectionSession(
    options.provider,
    initialCapture,
    options.projectId,
    options.zoneId,
    // The comparison reference outlives any single capture: an inspector sets
    // it once and expects it to still apply to the next photograph.
    defaultExpectedState(),
  );

  // The most recent accepted upload, so its bytes can still be rendered
  // after a re-render. Null until an operator supplies one.
  let uploaded: DemoCapture | null = null;

  /**
   * Whether an inspection may be served from the local result cache.
   *
   * Off by default. A cached result is a real AI answer but it is not a fresh
   * one, so serving it silently would be a false claim about what just
   * happened. It is an explicit, visible opt-in for iterating on the UI.
   */
  let cacheEnabled = false;

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      sendJson(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${LOOPBACK}`).pathname;

    if (req.method === 'GET' && path === '/api/captures') {
      sendJson(res, 200, { captures: listCaptures() });
      return;
    }

        if (req.method === 'GET' && path === '/api/upload-image') {
      if (uploaded === null) {
        sendJson(res, 404, { error: 'no uploaded capture' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': uploaded.mediaType,
        'Content-Length': uploaded.bytes.length,
        'Cache-Control': 'no-store',
      });
      res.end(uploaded.bytes);
      return;
    }

    if (req.method === 'GET' && path === '/api/session') {
      sendJson(res, 200, session.view());
      return;
    }

    // --- expected state (the comparison reference) ---------------------------
    if (req.method === 'GET' && path === '/api/expected') {
      sendJson(res, 200, {
        current: session.getExpectedState(),
        presets: Object.entries(EXPECTED_PRESETS).map(([id, state]) => ({
          id,
          zone: state.zone,
          itemCount: state.items.length,
        })),
        defaultPreset: DEFAULT_EXPECTED_PRESET_ID,
        elementKinds: ELEMENT_KINDS,
        expectations: EXPECTATIONS,
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/expected') {
      const body = await readJsonBody(req);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }

      const resolved = resolveExpectedState(payload);
      if (!resolved.ok) {
        sendJson(res, 400, { error: resolved.reason });
        return;
      }
      sendJson(res, 200, session.setExpectedState(resolved.state));
      return;
    }

    if (req.method === 'GET' && path.startsWith('/api/capture-image/')) {
      const id = decodeURIComponent(path.slice('/api/capture-image/'.length));
      const found = findCapture(id);
      if (!found) {
        sendJson(res, 404, { error: 'unknown capture' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': found.mediaType,
        'Content-Length': found.bytes.length,
        'Cache-Control': 'no-store',
      });
      res.end(found.bytes);
      return;
    }

    if (req.method === 'POST' && path === '/api/run') {
      const raw = await readJsonBody(req);
      let captureId: unknown = null;
      if (raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw) as { captureId?: unknown; cache?: unknown };
          captureId = parsed.captureId;
          // Caching is opt-in per request AND gated by the server switch, so a
          // cached answer can never be served without the UI asking for it.
          if (typeof parsed.cache === 'boolean') cacheEnabled = parsed.cache;
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        if (typeof captureId === 'string') {
          // An operator upload is a real capture too: prefer the in-memory
          // upload when the id matches, and only then the generated fixtures.
          const next =
            uploaded !== null && uploaded.id === captureId ? uploaded : findCapture(captureId);
          if (!next) {
            sendJson(res, 404, { error: 'unknown capture' });
            return;
          }
          // Switching capture starts a fresh session so observations from one
          // image can never be displayed against another. The expected state is
          // carried over, because the reference belongs to the ZONE, not to the
          // photograph.
          session = new InspectionSession(
            options.provider,
            next,
            options.projectId,
            options.zoneId,
            session.getExpectedState(),
          );
        }
      }
      sendJson(res, 200, await session.run({ useCache: cacheEnabled }));
      return;
    }

    // Cache transparency: the UI shows this so "CACHED" is never a surprise.
    if (req.method === 'GET' && path === '/api/cache') {
      sendJson(res, 200, { enabled: cacheEnabled, ...inspectionCache.getStats() });
      return;
    }

    if (req.method === 'POST' && path === '/api/cache/clear') {
      inspectionCache.clear();
      sendJson(res, 200, { cleared: true, ...inspectionCache.getStats() });
      return;
    }

    // Capture upload
    if (req.method === 'POST' && path === '/api/upload') {
      const query = new URL(req.url ?? '/', 'http://' + LOOPBACK).searchParams;
      const filename = (query.get('name') ?? 'capture').slice(0, 200);
      const declared = query.get('type') ?? undefined;

      let bytes: Buffer;
      try {
        bytes = await readBody(req, MAX_CAPTURE_BYTES + 1024);
      } catch {
        const mb = (MAX_CAPTURE_BYTES / (1024 * 1024)).toFixed(0);
        sendJson(res, 413, {
          error: 'capture too large',
          message: 'That capture is larger than ' + mb + ' MB. Reduce it before inspecting.',
        });
        return;
      }

      const result = acceptCapture({ bytes, filename, declaredMediaType: declared });
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason, message: result.message });
        return;
      }

      // A new capture always begins a new session, so observations from a
      // previous image can never be displayed against this one. The expected
      // state is carried over: the reference belongs to the zone, not the photo.
      session = new InspectionSession(
        options.provider,
        result.capture,
        options.projectId,
        options.zoneId,
        session.getExpectedState(),
      );
      uploaded = result.capture;

      sendJson(res, 200, {
        capture: {
          id: result.capture.id,
          label: result.capture.label,
          content: result.capture.content,
          width: result.capture.dimensions.width,
          height: result.capture.dimensions.height,
          byteLength: result.capture.bytes.length,
          mediaType: result.capture.mediaType,
        },
        view: session.view(),
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/review') {
      const body = await readJsonBody(req);
      let payload: {
        observationId?: unknown;
        decision?: unknown;
        reviewer?: unknown;
        note?: unknown;
      };
      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const { observationId, decision, reviewer, note } = payload;
      if (typeof observationId !== 'string' || observationId.length === 0) {
        sendJson(res, 400, { error: 'observationId is required' });
        return;
      }
      if (decision !== 'VERIFIED' && decision !== 'REJECTED' && decision !== 'NEEDS_REVIEW') {
        sendJson(res, 400, { error: 'decision must be VERIFIED, REJECTED or NEEDS_REVIEW' });
        return;
      }
      if (typeof reviewer !== 'string' || reviewer.trim().length === 0) {
        // Anonymous review is refused rather than stored unattributed, which
        // would make the verification trail meaningless.
        sendJson(res, 400, { error: 'a named reviewer is required' });
        return;
      }
      sendJson(
        res,
        200,
        session.review({
          observationId,
          decision,
          reviewer: reviewer.trim(),
          note: typeof note === 'string' ? note : null,
        }),
      );
      return;
    }
    if (req.method === 'POST' && path === '/api/review-finding') {
      const body = await readJsonBody(req);
      let payload: {
        findingId?: unknown;
        decision?: unknown;
        reviewer?: unknown;
        note?: unknown;
      };
      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const { findingId, decision, reviewer, note } = payload;
      if (typeof findingId !== 'string' || findingId.length === 0) {
        sendJson(res, 400, { error: 'findingId is required' });
        return;
      }
      if (decision !== 'VERIFIED' && decision !== 'REJECTED' && decision !== 'NEEDS_REVIEW') {
        sendJson(res, 400, { error: 'decision must be VERIFIED, REJECTED or NEEDS_REVIEW' });
        return;
      }
      if (typeof reviewer !== 'string' || reviewer.trim().length === 0) {
        // Anonymous verification is refused rather than stored unattributed,
        // which would make the verification trail meaningless.
        sendJson(res, 400, { error: 'a named reviewer is required' });
        return;
      }
      sendJson(
        res,
        200,
        session.reviewFinding({
          findingId,
          decision,
          reviewer: reviewer.trim(),
          note: typeof note === 'string' ? note : null,
        }),
      );
      return;
    }

    if (req.method === 'POST' && path === '/api/finding-state') {
      const body = await readJsonBody(req);
      let payload: { findingId?: unknown; state?: unknown };
      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const { findingId, state } = payload;
      if (typeof findingId !== 'string') {
        sendJson(res, 400, { error: 'findingId is required' });
        return;
      }
      if (state !== 'OPEN' && state !== 'ACKNOWLEDGED' && state !== 'CLOSED') {
        sendJson(res, 400, { error: 'state must be OPEN, ACKNOWLEDGED or CLOSED' });
        return;
      }
      sendJson(res, 200, session.setFindingState(findingId, state));
      return;
    }

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(INDEX_HTML);
      return;
    }

    if (req.method === 'GET' && path === '/app.css') {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(APP_CSS);
      return;
    }

    if (req.method === 'GET' && path === '/app.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(APP_JS);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  return { server, session };
}

/** Entry point used by `npm run ui`. */
export async function startInspectionServer(port = 4317): Promise<void> {
  let provider: AIProvider;
  try {
    provider = createProvider(process.env);
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      console.error(`  CONFIGURATION ERROR (${error.kind}): ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const handle = createInspectionServer({
    provider,
    projectId: process.env['DEMO_PROJECT_ID'] ?? 'proj_demo_site_a',
    zoneId: process.env['DEMO_ZONE_ID'] ?? 'zone_level_02',
    initialCaptureId: process.env['DEMO_CAPTURE'] ?? null,
  });

  handle.server.listen(port, LOOPBACK, () => {
    console.log('\n  SiteLens AI Reality Inspector');
    console.log(`  provider  : ${provider.name}`);
    console.log(`  model     : ${provider.model}`);
    console.log(`  listening : http://${LOOPBACK}:${port}\n`);
    console.log('  Loopback only. Press Ctrl+C to stop.\n');
  });
}

export type { SessionView };
