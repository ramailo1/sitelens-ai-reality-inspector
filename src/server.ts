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
import { INDEX_HTML, APP_CSS, APP_JS } from './ui-assets.ts';

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

async function readBody(req: IncomingMessage, limitBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Bound the body so a malformed or hostile request cannot exhaust memory.
    if (total > limitBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface ServerOptions {
  readonly provider: AIProvider;
  readonly projectId: string | null;
  readonly zoneId: string | null;
  readonly initialCaptureId: string | null;
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
  );

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

    if (req.method === 'GET' && path === '/api/session') {
      sendJson(res, 200, session.view());
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
      const raw = await readBody(req);
      if (raw.trim().length > 0) {
        let captureId: unknown;
        try {
          captureId = (JSON.parse(raw) as { captureId?: unknown }).captureId;
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        if (typeof captureId === 'string') {
          const next = findCapture(captureId);
          if (!next) {
            sendJson(res, 404, { error: 'unknown capture' });
            return;
          }
          // Switching capture starts a fresh session so observations from one
          // image can never be displayed against another.
          session = new InspectionSession(
            options.provider,
            next,
            options.projectId,
            options.zoneId,
          );
          sendJson(res, 200, await session.run());
          return;
        }
      }
      sendJson(res, 200, await session.run());
      return;
    }

    if (req.method === 'POST' && path === '/api/review') {
      const body = await readBody(req);
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
if (req.method === 'POST' && path === '/api/finding-state') {
      const body = await readBody(req);
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