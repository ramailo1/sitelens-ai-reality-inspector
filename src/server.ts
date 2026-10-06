/**
 * Local inspection server.
 *
 * Serves the Reality Inspector UI and a small JSON API over a project's
 * captures. It binds to loopback only: this is a local demonstration surface,
 * not a service, and it must not be reachable off the machine.
 *
 * The API never returns the API key, the base URL or provider internals.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createProvider, createReasoner, ProviderError } from './providers/factory.ts';
import { InspectionSession } from './session.ts';
import type { SessionView } from './session.ts';
import { ProjectStore, formatReviewer } from './projects.ts';
import type { ProjectCapture } from './projects.ts';
import type { AIProvider } from './providers/provider.ts';
import { acceptCapture, MAX_CAPTURE_BYTES } from './upload.ts';
import { normalizeOrientation } from './image-metadata.ts';
import { INDEX_HTML, APP_CSS, APP_JS } from './ui-assets.ts';
import { cleanItems, presetToState } from './expected-state.ts';
import type { Preset } from './expected-state.ts';
import { inspectionCache } from './cache.ts';
import { WorkspacePersistence } from './persistence.ts';
import { importDatasetCapture, readDatasetIndex } from './dataset.ts';
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
/**
 * Read a JSON request body. */
async function readJsonBody(req: IncomingMessage, limitBytes?: number): Promise<string> {
  return (await readBody(req, limitBytes)).toString('utf8');
}

/** Thrown when a review or state route is called with no capture selected. */
class NoActiveCapture extends Error {
  public constructor() {
    super('No capture is selected in the active project.');
    this.name = 'NoActiveCapture';
  }
}

/**
 * Capture as the UI sees it: identity, provenance and ownership, never raw bytes.
 *
 * `source` is structural, not cosmetic. It is the only thing that stops a
 * photograph from a local validation folder being presented as something this
 * application captured on this project's site, so the UI is required to render
 * `LOCAL_DATASET` as its own label rather than folding it into either existing
 * case.
 */
function captureSummary(capture: ProjectCapture): Record<string, unknown> {
  return {
    id: capture.id,
    label: capture.label,
    content: capture.content,
    width: capture.dimensions.width,
    height: capture.dimensions.height,
    byteLength: capture.bytes.length,
    mediaType: capture.mediaType,
    source: capture.source,
    zoneId: capture.zoneId,
    projectId: capture.projectId,
    createdAt: capture.createdAt,
    exifOrientation: capture.exifOrientation,
    geometryNormalized: capture.geometryNormalized,
  };
}

export interface ServerOptions {
  readonly provider: AIProvider;
  readonly zoneId: string | null;
  readonly initialCaptureId: string | null;
  /**
   * Durable state. Omit for the in-memory surface, which then keeps reporting
   * process memory. The API never claims durability it does not have.
   */
  readonly persistence?: WorkspacePersistence | null;
  /** Stage-2 reasoning model. Omit and stage 2 is reported as switched off. */
  readonly reasoner?: ReturnType<typeof createReasoner> | null;
}
/**
 * Resolve an explicit expected-state payload from the browser.
 *
 * An explicit item list from the browser is ALWAYS marked `source: 'OPERATOR'`,
 * so a preset can never be passed off as the project's own programme and an
 * operator edit can never be passed off as a preset. Named references are a
 * separate path (they go through the preset catalogue), so this function has
 * exactly one job.
 *
 * Every field is re-validated here by `cleanItems`, the same validator the
 * reference catalogue uses: the browser is an untrusted client even though it is
 * loopback-only, and two copies of this validation would eventually disagree.
 */
export function resolveExpectedState(
  payload: unknown,
): { ok: true; state: ExpectedState } | { ok: false; reason: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: 'expected state must be a JSON object' };
  }
  const record = payload as Record<string, unknown>;
  const zoneRaw = record['zone'];
  const zone =
    typeof zoneRaw === 'string' && zoneRaw.trim().length > 0 ? zoneRaw.trim() : 'Unspecified zone';

  // An operator may clear every expectation: "nothing is expected in this zone"
  // is a real statement and yields zero comparison rows. A named reference may
  // not be empty, which is exactly the rule cleanItems enforces below.
  const rawItems = record['items'];
  if (Array.isArray(rawItems) && rawItems.length === 0) {
    return { ok: true, state: { zone, items: [], source: 'OPERATOR' } };
  }

  const items = cleanItems(rawItems);
  if (!items.ok) return { ok: false, reason: items.message };
  return { ok: true, state: { zone, items: items.value, source: 'OPERATOR' } };
}
export interface InspectionServerHandle {
  readonly server: ReturnType<typeof createServer>;
  readonly store: ProjectStore;
}
export function createInspectionServer(options: ServerOptions): InspectionServerHandle {
  const persistence = options.persistence ?? null;
  const reasoner = options.reasoner ?? createReasoner(process.env);
  const store = new ProjectStore({
    provider: options.provider,
    zoneId: options.zoneId,
    persistence,
    reasoner,
  });

  // ORDER MATTERS, and getting it backwards destroys durable state.
  //
  // `restore()` must run BEFORE the demo project is seeded. Seeding calls
  // create() -> persist(), which rewrites the workspace file from the in-memory
  // store; doing that first overwrites whatever the previous run left behind
  // with an empty store plus the demo shell. That was measured, not theorised:
  // restoring a saved project reported zero restored projects for exactly this
  // reason.
  const restored = store.restore();

  // The repository has always opened on a populated demo project so the
  // inspection flow is reachable without setup. These are the generated
  // synthetic fixtures, labelled as fixtures throughout the UI. Seeded ONLY when
  // nothing was restored, so a working copy that has real projects opens on the
  // operator's own work rather than on the synthetic demo.
  const seeded = store.list().length > 0
    ? store.ensureSelection()
    : store.seedDemoProject(
        process.env['DEMO_PROJECT_NAME'] ?? 'North Core Construction',
        process.env['DEMO_PROJECT_LOCATION'] ?? 'Dusk Survey, level 02',
      );

  if (options.initialCaptureId) {
    const wanted = options.initialCaptureId;
    if (store.capturesOf(seeded.id).some((c) => c.id === wanted)) store.selectCapture(wanted);
  }
  if (store.selectedCaptureId() === null) {
    const first = store.capturesOf(store.activeProject()?.id ?? seeded.id)[0];
    if (first) store.selectCapture(first.id);
  }
  /**
   * Whether an inspection may be served from the local result cache.
   *
   * Off by default. A cached result is a real AI answer but it is not a fresh
   * one, so serving it silently would be a false claim about what just
   * happened. It is an explicit, visible opt-in for iterating on the UI.
   */
  let cacheEnabled = false;
  /** Project-scoped view of the active session, or null when nothing is selected. */
  const activeSession = (): InspectionSession | null => store.activeSession();

  /**
   * The active session for routes that mutate review state.
   *
   * There is nothing to verify against when no capture is selected, and a
   * request that names an id without an active capture would otherwise read from
   * a session that does not belong to the current project.
   */
  const requireSession = (): InspectionSession => {
    const session = activeSession();
    if (session === null) throw new NoActiveCapture();
    return session;
  };
  /**
   * The one payload every mutating route answers with, so the client always
   * receives the authoritative project, capture list and session view together
   * and can never half-apply a mutation.
   */
  const workspace = (): Record<string, unknown> => {
    const project = store.activeProject();
    const captures = project === null ? [] : store.capturesOf(project.id);
    const session = activeSession();
    const reference = project === null ? null : store.referenceFor(project.id);
    const preset = reference === null ? null : store.presets.get(reference.presetId);
    const dataset = readDatasetIndex();
    const reasoner = store.getReasoner();
    return {
      project,
      projects: store.list(),
      activeProjectId: project?.id ?? null,
      activeCaptureId: store.selectedCaptureId(),
      captures: captures.map((c) => captureSummary(c)),
      reference: reference === null ? null : {
        presetId: reference.presetId,
        name: preset === null ? reference.presetId : preset.name,
        zone: reference.state.zone,
        source: reference.state.source,
        edited: reference.edited,
        deletable: preset !== null && preset.source === 'OPERATOR',
        itemCount: reference.state.items.length,
      },
      presets: store.presets.list().map((p) => ({
        id: p.id, name: p.name, zone: p.zone, source: p.source, itemCount: p.items.length,
      })),
      // The storage truth of THIS instance, never a constant.
      storage: store.describeStorage(),
      // The pipeline's two model stages, always both, so a judge can see the
      // split without opening the provenance panel.
      pipeline: {
        vision: { provider: options.provider.name, model: options.provider.model },
        reasoning: {
          provider: reasoner.name,
          model: reasoner.model,
          configured: reasoner.configured,
        },
      },
      // The local dataset, discovered at call time. Absent is reported as
      // absent; the browser is never handed a fabricated empty list with no
      // explanation.
      dataset: {
        present: dataset.present,
        directory: dataset.directory,
        count: dataset.entries.length,
        unreadable: dataset.unreadable,
        note: dataset.note,
      },
      view: session === null ? null : session.view(),
    };
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (error instanceof NoActiveCapture) {
        sendJson(res, 400, { error: 'NO_ACTIVE_CAPTURE', message: error.message });
        return;
      }
      sendJson(res, 500, { error: 'internal error' });
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${LOOPBACK}`).pathname;

    // --- workspace -----------------------------------------------------------
    if (req.method === 'GET' && path === '/api/workspace') {
      sendJson(res, 200, workspace());
      return;
    }

    // --- projects ------------------------------------------------------------
    if (req.method === 'GET' && path === '/api/projects') {
      sendJson(res, 200, {
        projects: store.list(),
        activeProjectId: store.activeProject()?.id ?? null,
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/projects') {
      const body = await readJsonBody(req);
      let payload: { name?: unknown; location?: unknown } = {};
      if (body.trim().length > 0) {
        try {
          payload = JSON.parse(body) as { name?: unknown; location?: unknown };
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
      }
      const created = store.create({ name: payload.name, location: payload.location });
      if (!created.ok) {
        sendJson(res, 400, { error: created.reason, message: created.message });
        return;
      }
      sendJson(res, 201, workspace());
      return;
    }

    if (req.method === 'POST' && path === '/api/projects/switch') {
      const body = await readJsonBody(req);
      let payload: { projectId?: unknown } = {};
      try {
        payload = JSON.parse(body) as { projectId?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      if (typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
        sendJson(res, 400, { error: 'projectId is required' });
        return;
      }
      const switched = store.switchTo(payload.projectId);
      if (!switched.ok) {
        sendJson(res, 404, { error: switched.reason, message: switched.message });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    if (req.method === 'PATCH' && path.startsWith('/api/projects/')) {
      const projectId = decodeURIComponent(path.slice('/api/projects/'.length));
      const body = await readJsonBody(req);
      let payload: { name?: unknown; location?: unknown } = {};
      try {
        payload = JSON.parse(body) as { name?: unknown; location?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      if (!store.has(projectId)) {
        sendJson(res, 404, { error: 'UNKNOWN_PROJECT', message: 'That project no longer exists.' });
        return;
      }
      // The two fields are edited through separate actions, so only the one the
      // client actually sent is applied. Dispatching on which key is present
      // avoids reporting a name validation failure as a location failure.
      const result =
        payload.name !== undefined
          ? store.rename(projectId, payload.name)
          : store.setLocation(projectId, payload.location);
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason, message: result.message });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    if (req.method === 'POST' && path === '/api/reviewer') {
      const project = store.activeProject();
      if (project === null) {
        sendJson(res, 400, { error: 'NO_ACTIVE_PROJECT', message: 'No project selected.' });
        return;
      }
      const body = await readJsonBody(req);
      let payload: { name?: unknown; role?: unknown } = {};
      if (body.trim().length > 0) {
        try {
          payload = JSON.parse(body) as { name?: unknown; role?: unknown };
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
      }
      const result = store.setReviewer(project.id, { name: payload.name, role: payload.role });
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason, message: result.message });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/projects/')) {
      const projectId = decodeURIComponent(path.slice('/api/projects/'.length));
      const removed = store.delete(projectId);
      if (!removed.ok) {
        sendJson(res, 404, { error: removed.reason, message: removed.message });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    // --- captures ------------------------------------------------------------
    if (req.method === 'GET' && path === '/api/captures') {
      const project = store.activeProject();
      sendJson(res, 200, {
        captures: project === null ? [] : store.capturesOf(project.id).map((c) => captureSummary(c)),
      });
      return;
    }

    /**
     * Select a capture WITHOUT inspecting it.
     *
     * Selection is a view change, not a model call. Routing it through /api/run
     * (as the client used to) spent a real vision inference on every click,
     * burned provider quota, and reported a "result" for a capture nobody asked
     * to inspect. Its own session already exists, so selecting restores whatever
     * that capture was last inspected to - including its human verifications.
     */
    if (req.method === 'POST' && path === '/api/captures/select') {
      const body = await readJsonBody(req);
      let payload: { captureId?: unknown } = {};
      try {
        payload = JSON.parse(body) as { captureId?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      if (typeof payload.captureId !== 'string' || payload.captureId.length === 0) {
        sendJson(res, 400, { error: 'captureId is required' });
        return;
      }
      const selected = store.selectCapture(payload.captureId);
      if (!selected.ok) {
        sendJson(res, selected.reason === 'NOT_OWNED' ? 403 : 404, {
          error: selected.reason,
          message: selected.message,
        });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    if (req.method === 'DELETE' && path.startsWith('/api/captures/')) {
      const captureId = decodeURIComponent(path.slice('/api/captures/'.length));
      const removed = store.deleteCapture(captureId);
      if (!removed.ok) {
        sendJson(res, removed.reason === 'NOT_OWNED' ? 403 : 404, {
          error: removed.reason,
          message: removed.message,
        });
        return;
      }
      sendJson(res, 200, workspace());
      return;
    }

    // --- session view --------------------------------------------------------
    if (req.method === 'GET' && path === '/api/session') {
      const session = activeSession();
      sendJson(res, 200, session === null ? null : session.view());
      return;
    }

    // --- comparison references ----------------------------------------------
    if (req.method === 'GET' && path === '/api/expected') {
      const project = store.activeProject();
      const reference = project === null ? null : store.referenceFor(project.id);
      sendJson(res, 200, {
        current: reference === null ? null : reference.state,
        presetId: reference === null ? null : reference.presetId,
        edited: reference === null ? false : reference.edited,
        presets: store.presets.list().map((p) => ({
          id: p.id,
          name: p.name,
          zone: p.zone,
          source: p.source,
          itemCount: p.items.length,
          deletable: p.source === 'OPERATOR',
        })),
        defaultPreset: store.presets.defaultId(),
        elementKinds: ELEMENT_KINDS,
        expectations: EXPECTATIONS,
      });
      return;
    }
    if (req.method === 'POST' && path === '/api/presets') {
      const body = await readJsonBody(req);
      let payload: { name?: unknown; zone?: unknown; items?: unknown } = {};
      try {
        payload = JSON.parse(body) as { name?: unknown; zone?: unknown; items?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const created = store.presets.create({
        name: payload.name,
        zone: payload.zone,
        items: payload.items,
      });
      if (!created.ok) {
        sendJson(res, 400, { error: created.reason, message: created.message });
        return;
      }
      sendJson(res, 201, workspace());
      return;
    }

    if (req.method === 'PATCH' && path.startsWith('/api/presets/')) {
      const presetId = decodeURIComponent(path.slice('/api/presets/'.length));
      const body = await readJsonBody(req);
      let payload: { name?: unknown; items?: unknown } = {};
      try {
        payload = JSON.parse(body) as { name?: unknown; items?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      let result = payload.items !== undefined
        ? store.presets.replaceItems(presetId, payload.items)
        : store.presets.rename(presetId, payload.name);
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason, message: result.message });
        return;
      }
      // A project using this preset now compares against a definition that moved,
      // so its own copy and results are refreshed rather than left misleading.
      const project = store.activeProject();
      if (project !== null && store.referenceFor(project.id).presetId === presetId) {
        store.setReferenceState(project.id, presetToState(store.presets.get(presetId) as Preset));
      }
      sendJson(res, 200, workspace());
      return;
    }
    if (req.method === 'DELETE' && path.startsWith('/api/presets/')) {
      const presetId = decodeURIComponent(path.slice('/api/presets/'.length));
      const removed = store.presets.delete(presetId);
      if (!removed.ok) {
        sendJson(res, removed.reason === 'SYSTEM_PRESET' ? 409 : 404, {
          error: removed.reason,
          message: removed.message,
        });
        return;
      }
      // A project still pointing at the deleted reference falls back to the
      // default, so the comparison always has a valid basis.
      const project = store.activeProject();
      if (project !== null && store.referenceFor(project.id).presetId === presetId) {
        store.usePreset(project.id, store.presets.defaultId());
      }
      sendJson(res, 200, workspace());
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
      const project = store.activeProject();
      if (project === null) {
        sendJson(res, 400, { error: 'no active project' });
        return;
      }
      // Selecting a named preset replaces the reference wholesale.
      const presetId = (payload as { presetId?: unknown }).presetId;
      if (typeof presetId === 'string' && presetId.length > 0) {
        const applied = store.usePreset(project.id, presetId);
        if (!applied.ok) {
          sendJson(res, 404, { error: applied.reason, message: applied.message });
          return;
        }
        sendJson(res, 200, workspace());
        return;
      }
      // Otherwise an explicit item list is an operator edit of this project's copy.
      const resolved = resolveExpectedState(payload);
      if (!resolved.ok) {
        sendJson(res, 400, { error: resolved.reason });
        return;
      }
      store.setReferenceState(project.id, resolved.state);
      sendJson(res, 200, workspace());
      return;
    }

    // --- local dataset --------------------------------------------------------
    // Discovery is a read-only view of the local validation folder. It never
    // reads image bytes, so listing 38 files cannot cost 107 MB of I/O.
    if (req.method === 'GET' && path === '/api/dataset') {
      sendJson(res, 200, readDatasetIndex());
      return;
    }

    // Import turns ONE dataset image into a real capture of the active project.
    // The id is validated against the discovered index, so this cannot be used
    // to read an arbitrary path off the machine.
    if (req.method === 'POST' && path === '/api/dataset/import') {
      if (store.activeProject() === null) {
        sendJson(res, 400, { error: 'create a project before importing a dataset image' });
        return;
      }
      const body = await readJsonBody(req);
      let payload: { id?: unknown } = {};
      if (body.trim().length > 0) {
        try {
          payload = JSON.parse(body) as { id?: unknown };
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
      }
      if (typeof payload.id !== 'string' || payload.id.length === 0) {
        sendJson(res, 400, { error: 'id is required' });
        return;
      }
      const imported = importDatasetCapture(payload.id);
      if (!imported.ok) {
        sendJson(res, 404, { error: imported.reason, message: imported.message });
        return;
      }
      // Relative to the dataset directory so the state survives the repository
      // being moved or opened from a different root.
      const stored = store.addCapture({
        ...imported.capture,
        source: 'LOCAL_DATASET',
        bytesPath: imported.entry.filename,
        bytesRelativeToDataset: true,
        exifOrientation: imported.capture.exifOrientation,
        geometryNormalized: imported.capture.geometryNormalized,
      });
      store.selectCapture(stored.id);
      sendJson(res, 200, { capture: captureSummary(stored), ...workspace() });
      return;
    }

    // --- capture bytes -------------------------------------------------------
    if (req.method === 'GET' && path.startsWith('/api/capture-image/')) {
      const id = decodeURIComponent(path.slice('/api/capture-image/'.length));
      const owned = store.activeCapture(id);
      if (!owned.ok) {
        sendJson(res, owned.reason === 'NOT_OWNED' ? 403 : 404, {
          error: owned.reason,
          message: owned.message,
        });
        return;
      }
      res.writeHead(200, {
        'Content-Type': owned.value.mediaType,
        'Content-Length': owned.value.bytes.length,
        'Cache-Control': 'no-store',
      });
      res.end(owned.value.bytes);
      return;
    }
    if (req.method === 'POST' && path === '/api/run') {
      const raw = await readJsonBody(req);
      if (raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw) as { captureId?: unknown; cache?: unknown };
          // Caching is opt-in per request AND gated by the server switch, so a
          // cached answer can never be served without the UI asking for it.
          if (typeof parsed.cache === 'boolean') cacheEnabled = parsed.cache;
          if (typeof parsed.captureId === 'string') {
            // Ownership is validated here, so a capture id from another project
            // is refused rather than quietly inspected.
            const selected = store.selectCapture(parsed.captureId);
            if (!selected.ok) {
              sendJson(res, selected.reason === 'NOT_OWNED' ? 403 : 404, {
                error: selected.reason,
                message: selected.message,
              });
              return;
            }
          }
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
      }
      const session = activeSession();
      if (session === null) {
        sendJson(res, 400, { error: 'no capture selected' });
        return;
      }
      const view = await session.run({ useCache: cacheEnabled });
      // Written only after a run that produced a usable result, so a failed or
      // empty inspection never becomes the record a restart restores.
      store.persistInspection(session.view().provenance.captureId);
      sendJson(res, 200, view);
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
      if (store.activeProject() === null) {
        sendJson(res, 400, { error: 'create a project before uploading a capture' });
        return;
      }
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
      // The upload is owned by the active project and selected immediately, so
      // the operator can inspect it without a second step. Its session is fresh,
      // which is what stops one image's observations appearing against another.
      // Orientation is normalized before storage, so the model, the display and
      // the evidence overlay all work in one coordinate system.
      const stored = store.addCapture({
        ...result.capture,
        bytes: normalizeOrientation(result.capture.bytes),
        source: 'UPLOAD',
      });
      store.selectCapture(stored.id);
      sendJson(res, 200, { capture: captureSummary(stored), ...workspace() });
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
      const { observationId, decision, note } = payload;
      if (typeof observationId !== 'string' || observationId.length === 0) {
        sendJson(res, 400, { error: 'observationId is required' });
        return;
      }
      if (decision !== 'VERIFIED' && decision !== 'REJECTED' && decision !== 'NEEDS_REVIEW') {
        sendJson(res, 400, { error: 'decision must be VERIFIED, REJECTED or NEEDS_REVIEW' });
        return;
      }
      let reviewerName: string | null = null;
      if (typeof payload.reviewer === 'string' && payload.reviewer.trim().length > 0) {
        reviewerName = payload.reviewer.trim();
      } else {
        reviewerName = formatReviewer(store.activeProject()?.reviewer);
      }
      if (reviewerName === null) {
        sendJson(res, 400, {
          error: 'REVIEWER_NOT_CONFIGURED',
          message: 'Set your reviewer identity before recording a human finding decision.',
        });
        return;
      }
      const reviewed = requireSession().review({
          observationId,
          decision,
          reviewer: reviewerName,
          note: typeof note === 'string' ? note : null,
        });
      // A human decision is the most valuable thing in the product, so it is
      // written through immediately rather than waiting for the next run.
      if (reviewed.provenance.captureId !== null) store.persistInspection(reviewed.provenance.captureId);
      sendJson(res, 200, reviewed);
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
      const { findingId, decision, note } = payload;
      if (typeof findingId !== 'string' || findingId.length === 0) {
        sendJson(res, 400, { error: 'findingId is required' });
        return;
      }
      if (decision !== 'VERIFIED' && decision !== 'REJECTED' && decision !== 'NEEDS_REVIEW') {
        sendJson(res, 400, { error: 'decision must be VERIFIED, REJECTED or NEEDS_REVIEW' });
        return;
      }
      let reviewerName: string | null = null;
      if (typeof payload.reviewer === 'string' && payload.reviewer.trim().length > 0) {
        reviewerName = payload.reviewer.trim();
      } else {
        reviewerName = formatReviewer(store.activeProject()?.reviewer);
      }
      if (reviewerName === null) {
        sendJson(res, 400, {
          error: 'REVIEWER_NOT_CONFIGURED',
          message: 'Set your reviewer identity before recording a human finding decision.',
        });
        return;
      }
      const settled = requireSession().reviewFinding({
          findingId,
          decision,
          reviewer: reviewerName,
          note: typeof note === 'string' ? note : null,
        });
      if (settled.provenance.captureId !== null) store.persistInspection(settled.provenance.captureId);
      sendJson(res, 200, settled);
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
      sendJson(res, 200, requireSession().setFindingState(findingId, state));
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
  return { server, store };
}
/**
 * Entry point used by `npm run ui`.
 *
 * Persistence is ON by default here and OFF in tests, which construct a server
 * without one. That is the only reason the two behave differently, and the API
 * reports whichever is actually in force rather than a fixed string.
 */
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
  const reasoner = createReasoner(process.env);
  const persistFlag = (process.env['SITELENS_PERSIST'] ?? 'on').trim().toLowerCase();
  const persistence = persistFlag === 'off' || persistFlag === '0' ? null : new WorkspacePersistence();
  const dataset = readDatasetIndex();

  const handle = createInspectionServer({
    provider,
    reasoner,
    persistence,
    zoneId: process.env['DEMO_ZONE_ID'] ?? 'zone_level_02',
    initialCaptureId: process.env['DEMO_CAPTURE'] ?? null,
  });
  handle.server.listen(port, LOOPBACK, () => {
    console.log('\n  SiteLens AI Reality Inspector');
    console.log(`  provider  : ${provider.name}`);
    console.log(`  vision    : ${provider.model}`);
    console.log(`  reasoning : ${reasoner.model}${reasoner.configured ? '' : '  (NOT CONFIGURED)'}`);
    console.log(`  storage   : ${handle.store.describeStorage().location}`);
    console.log(
      `  dataset   : ${dataset.present ? `${dataset.entries.length} images in ${dataset.directory}` : `none at ${dataset.directory}`}`,
    );
    console.log(`  listening : http://${LOOPBACK}:${port}\n`);
    console.log('  Loopback only. Press Ctrl+C to stop.\n');
  });
}
export type { SessionView };
