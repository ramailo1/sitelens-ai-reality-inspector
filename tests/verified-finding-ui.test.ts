// Regression tests for the verified-finding ledger UI, truthful persistence feedback, evidenceState presentation, and.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createInspectionServer, MAX_INSPECTION_IMAGES } from '../src/server.ts';
import { ProjectStore, formatReviewer, groupKey } from '../src/projects.ts';
import { WorkspacePersistence } from '../src/persistence.ts';
import { DemoFixtureProvider } from '../src/providers/demo-fixture.provider.ts';
import { demoCaptures } from '../src/captures.ts';
import { UnavailableReasoner } from '../src/providers/nemotron-reasoner.ts';
import { APP_JS, APP_CSS, INDEX_HTML } from '../src/ui-assets.ts';
import { DEFAULT_NEBIUS_MODEL, DEFAULT_REASONING_MODEL } from '../src/config.ts';

// Lightweight DOM harness for driving the shipped APP_JS renderers and interaction handlers in a controlled VM context.

interface StubNode {
  id: string;
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  open: boolean;
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  children: StubNode[];
  listeners: Record<string, ((e?: unknown) => unknown)[]>;
  classList: {
    toggle(cls: string, force?: boolean): void;
    add(cls: string): void;
    remove(cls: string): void;
  };
  appendChild(c: StubNode): StubNode;
  removeChild(c: StubNode): void;
  get firstChild(): StubNode | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  addEventListener(type: string, handler: (e?: unknown) => unknown): void;
  showModal(): void;
  close(): void;
  focus(): void;
  scrollIntoView(): void;
  click(): Promise<void>;
  allText(): string;
  findAll(predicate: (n: StubNode) => boolean): StubNode[];
}

function makeNode(tag: string, initialId = '', registry?: Map<string, StubNode>): StubNode {
  let currentId = initialId;
  const n: StubNode = {
    get id() {
      return currentId;
    },
    set id(val: string) {
      currentId = String(val);
      this.attrs['id'] = currentId;
      if (registry && currentId) registry.set(currentId, this);
    },
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    style: {},
    dataset: {},
    attrs: {},
    children: [],
    listeners: {},
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    },
    get firstChild() {
      return this.children.length > 0 ? this.children[0]! : null;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') {
        currentId = String(v);
        if (registry && currentId) registry.set(currentId, this);
      }
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
        this.dataset[camel] = String(v);
      }
    },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    focus() {},
    scrollIntoView() {},
    async click() {
      if (this.disabled) return;
      const handlers = this.listeners['click'] || [];
      for (const h of handlers) {
        await h({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this });
      }
    },
    allText() {
      let out = this.textContent || '';
      for (const c of this.children) {
        const sub = c.allText();
        if (sub) out += (out ? ' ' : '') + sub;
      }
      return out.trim();
    },
    findAll(pred) {
      const res: StubNode[] = [];
      if (pred(this)) res.push(this);
      for (const c of this.children) {
        res.push(...c.findAll(pred));
      }
      return res;
    },
  };
  if (registry && initialId) registry.set(initialId, n);
  return n;
}

interface UiHarnessOptions {
  apiImpl?: (path: string, init?: { method?: string; body?: string }) => Promise<unknown>;
  confirmImpl?: (message: string) => boolean;
}

function createUiHarness(opts: UiHarnessOptions = {}) {
  const elements = new Map<string, StubNode>();
  const root = makeNode('html', '', elements);
  const surfaces = [makeNode('section', '', elements), makeNode('section', '', elements)];

  const getEl = (id: string): StubNode => {
    let existing = elements.get(id);
    if (!existing) {
      existing = makeNode('div', id, elements);
    }
    return existing;
  };

  // Seed key elements that APP_JS touches
  const defaultIds = [
    'run', 'run-sub', 'cache-toggle', 'status', 'lamp', 'state-label', 'notice',
    'storage-note', 'provenance', 'failures', 'geometry-note', 'basis-list', 'basis-n',
    'findings', 'findings-cards', 'bay-findings', 'observations', 'obs-empty',
    'tab-findings-n', 'rail-findings', 'rail-findings-n',
    'rail-elements', 'rail-attention', 'rail-confidence', 'rail-overall', 'rail-verdict',
    'brief', 'brief-verdict', 'priorities', 'comparison',
    'reason', 'reason-grid', 'reason-stage', 'reason-model', 'reason-lede', 'reason-fail', 'reason-foot',
    'qualification', 'qual-verdict', 'qual-path', 'qual-stages', 'qual-subtitle',
    'pipe-1', 'pipe-2', 'pipe-3', 'pipe-4',
    'pipe-vision-model', 'pipe-compare-model', 'pipe-reason-model', 'pipe-verify-model',
    'pipe-vision-note', 'pipe-compare-note', 'pipe-reason-note', 'pipe-verify-note',
    'hdr-model', 'hdr-reasoner', 'hdr-provenance', 'hdr-synth', 'hdr-cache',
    'meta-zone', 'meta-capture', 'meta-reviewer', 'reviewer-current-val', 'reviewer-status-box', 'reviewer-change-btn',
    'reviewer-gate', 'reviewer-gate-reason',
    'reviewer-modal', 'reviewer-input-name', 'reviewer-input-role', 'reviewer-modal-note',
    'proj-name', 'proj-delete', 'proj-rename', 'proj-list', 'proj-empty', 'proj-menu', 'proj-btn',
    'proj-modal', 'proj-modal-h', 'proj-save', 'proj-input-name', 'proj-input-location', 'proj-modal-note',
    'del-modal', 'del-modal-h', 'del-body',
    'expected-preset', 'preset-delete', 'expected-rows', 'expected-summary', 'expected-source',
    'fixture-list', 'capture-empty', 'fixtures-acts', 'imgs', 'imgs-n', 'imgs-list',
    'loaded', 'loaded-name', 'loaded-meta', 'drop',
    'stage-cap', 'overlay', 'evidence-image', 'photo-switcher', 'photo-switcher-tabs',
    'note', 'lang-select', 'lang-note', 'lang-label',
    'ds-summary', 'ds-entries', 'ds-empty', 'ds-export', 'ds-list', 'ds-note',
  ];
  for (const id of defaultIds) getEl(id);

  const apiLog: { path: string; method: string; body: unknown }[] = [];
  const confirmCalls: string[] = [];

  const document = {
    documentElement: root,
    createElement: (tag: string) => makeNode(tag, '', elements),
    createTextNode: (text: string) => {
      const t = makeNode('#text', '', elements);
      t.textContent = String(text);
      return t;
    },
    getElementById: (id: string) => getEl(id),
    querySelectorAll: (sel: string) => {
      if (sel === '.i18n-surface') return surfaces;
      return [];
    },
    readyState: 'loading',
    addEventListener: () => {},
  };

  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const parsedBody = init?.body ? JSON.parse(init.body) : undefined;
    apiLog.push({ path: url, method, body: parsedBody });
    if (opts.apiImpl) {
      try {
        const result = await opts.apiImpl(url, init);
        return {
          ok: true,
          status: 200,
          json: async () => result,
        };
      } catch (err) {
        const e = err as Error & { status?: number; code?: string };
        return {
          ok: false,
          status: e.status ?? 400,
          json: async () => ({ error: e.code ?? 'BAD_REQUEST', message: e.message }),
        };
      }
    }
    throw new Error('Unexpected fetch call to ' + url);
  };

  const win = {
    localStorage: { getItem: () => null, setItem: () => {} },
    confirm: (msg: string) => {
      confirmCalls.push(msg);
      return opts.confirmImpl ? opts.confirmImpl(msg) : true;
    },
    console: { error: () => {} },
  };

  const context: Record<string, unknown> = {
    document,
    window: win,
    console: { error: () => {} },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    encodeURIComponent,
  };
  vm.createContext(context);

  const harnessScript = APP_JS + `\n;globalThis.__harness = {
    state,
    applyWorkspace,
    renderWorkspace,
    renderAll,
    renderFindings,
    renderObservations,
    renderProvenance,
    renderStorage,
    renderPipeline,
    submitObservationReview,
    updateFindingState,
    runInspection,
    applyExpected,
    applyExpectedEdits,
    openDeleteModal,
    commitDelete,
    switchProject,
  };`;

  vm.runInContext(harnessScript, context);
  const h = context.__harness as {
    state: Record<string, unknown>;
    applyWorkspace: (ws: unknown) => void;
    renderWorkspace: () => void;
    renderAll: () => void;
    renderFindings: () => void;
    renderObservations: () => void;
    renderProvenance: () => void;
    renderStorage: () => void;
    renderPipeline: () => void;
    submitObservationReview: (obsId: string, decision: string) => Promise<void>;
    updateFindingState: (findingId: string, state: string) => Promise<void>;
    runInspection: () => Promise<void>;
    applyExpected: (presetId?: string) => Promise<void>;
    applyExpectedEdits: () => Promise<void>;
    openDeleteModal: (kind: string, subject: unknown) => void;
    commitDelete: () => Promise<void>;
    switchProject: (projectId: string) => Promise<void>;
  };

  h.state.pipeline = {
    vision: { provider: 'demo-fixture', model: DEFAULT_NEBIUS_MODEL },
    reasoning: { provider: 'nebius-nemotron-reasoner', model: DEFAULT_REASONING_MODEL, configured: false },
  };

  return { h, getEl, apiLog, confirmCalls };
}

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sitelens-vf-ui-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function createTestStore(persistence?: WorkspacePersistence) {
  const store = new ProjectStore({
    provider: new DemoFixtureProvider(),
    zoneId: 'zone_level_02',
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'Disabled for deterministic UI test' }),
    persistence: persistence ?? null,
  });
  store.restore();
  if (store.list().length === 0) {
    store.seedDemoProject('North Core Construction', 'Dusk Survey, level 02');
  } else {
    store.ensureSelection();
  }
  const activeProj = store.activeProject();
  if (activeProj && store.selectedCaptureId() === null) {
    const first = store.capturesOf(activeProj.id)[0];
    if (first) store.selectCapture(first.id);
  }
  return store;
}

function buildWorkspacePayload(store: ProjectStore): Record<string, unknown> {
  const project = store.activeProject();
  const captures = project === null ? [] : store.capturesOf(project.id);
  const session = store.activeSession();
  const reference = project === null ? null : store.referenceFor(project.id);
  const preset = reference === null ? null : store.presets.get(reference.presetId);
  const reasoner = store.getReasoner();
  return {
    project,
    projects: store.list(),
    activeProjectId: project?.id ?? null,
    activeCaptureId: store.selectedCaptureId(),
    activeCaptureIds: store.selectedCaptureIds(),
    maxInspectionImages: MAX_INSPECTION_IMAGES,
    reviewerGate: {
      required: !project?.reviewer?.name,
      reason: project?.reviewer?.name ? null : 'Reviewer identity required',
    },
    duplicateCaptureIds: store.refusedDuplicateIds(),
    captures: captures.map((c) => ({
      id: c.id,
      label: c.label,
      content: c.content,
      width: c.dimensions.width,
      height: c.dimensions.height,
      byteLength: c.bytes.length,
      mediaType: c.mediaType,
      source: c.source,
      zoneId: c.zoneId,
      projectId: c.projectId,
      createdAt: c.createdAt,
      exifOrientation: c.exifOrientation,
      geometryNormalized: c.geometryNormalized,
    })),
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
      id: p.id,
      name: p.name,
      zone: p.zone,
      source: p.source,
      itemCount: p.items.length,
    })),
    storage: store.describeStorage(),
    pipeline: {
      vision: { provider: 'demo-fixture', model: DEFAULT_NEBIUS_MODEL },
      reasoning: {
        provider: reasoner.name,
        model: reasoner.model,
        configured: reasoner.configured,
      },
    },
    dataset: {
      present: false,
      directory: 'sample/local-dataset',
      count: 0,
      unreadable: 0,
      note: 'none',
    },
    view: session === null ? null : session.view(),
  };
}

// 1. Verified observation -> visible ledger finding + lifecycle

test('verifying an observation creates a visible ledger finding and supports OPEN -> ACKNOWLEDGED -> CLOSED -> OPEN after API confirmation', async () => {
  const store = createTestStore();
  const project = store.activeProject()!;
  store.setReviewer(project.id, { name: 'M. Haddad', role: 'Site Engineer' });
  const session = store.activeSession()!;
  await session.run();

  const initialWs = buildWorkspacePayload(store);
  const initialView = session.view();
  assert.equal(initialView.outcome, 'COMPLETED');
  assert.ok(initialView.observations.length > 0, 'Demo inspection must produce observations');
  assert.equal(initialView.findings.length, 0, 'Ledger starts empty before human verification');

  const targetObs = initialView.observations[0]!;

  const { h, getEl, apiLog } = createUiHarness({
    apiImpl: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (url === '/api/review') {
        const reviewerName = formatReviewer(store.activeProject()?.reviewer)!;
        return session.review({
          observationId: body.observationId,
          decision: body.decision,
          reviewer: reviewerName,
          note: body.note ?? null,
        });
      }
      if (url === '/api/finding-state') {
        return session.setFindingState(body.findingId, body.state);
      }
      throw new Error('Unhandled route ' + url);
    },
  });

  // Render initial workspace with 0 ledger findings
  h.applyWorkspace(initialWs);
  h.renderAll();

  const ledgerEmpty = getEl('ledger-empty');
  assert.equal(ledgerEmpty.hidden, false, 'Empty ledger state must be visible when 0 findings exist');
  assert.match(ledgerEmpty.textContent, /No verified ledger findings yet/i);

  // Set optional review note and verify the observation via the UI handler
  getEl('note').value = 'Confirmed on site walk at Bay 4';
  await h.submitObservationReview(targetObs.id, 'VERIFIED');

  const ledgerList = getEl('ledger-list');
  assert.equal(ledgerList.children.length, 1, 'Exactly 1 verified ledger finding card rendered');

  const card = ledgerList.children[0]!;
  const cardText = card.allText();
  const viewAfterVerify = h.state.view as { findings: Array<{ id: string; state: string; summary: string }> };
  const ledgerFinding = viewAfterVerify.findings[0]!;

  // Distinct ID prefix: find_* (ledger) vs obs_* (observation) vs fnd_* (inspection finding)
  assert.match(ledgerFinding.id, /^find_/, 'Ledger finding ID must use find_ prefix');
  assert.equal(card.dataset.ledgerFindingId, ledgerFinding.id);
  assert.equal(card.dataset.findingState, 'OPEN');
  assert.ok(cardText.includes(ledgerFinding.id), 'Card displays ledger finding ID');
  assert.ok(cardText.includes(targetObs.id), 'Card displays linked source observation ID');
  assert.ok(cardText.includes(targetObs.observation), 'Card displays finding summary');
  assert.ok(cardText.includes('M. Haddad · Site Engineer'), 'Card displays reviewer attribution');
  assert.ok(cardText.includes('Confirmed on site walk at Bay 4'), 'Card displays reviewer note');
  assert.ok(cardText.includes('sitelens-isolated-hackathon'), 'Card displays target');
  assert.ok(cardText.includes('OPEN'), 'Card displays OPEN state');

  // Check available action buttons in OPEN state: Acknowledge and Close finding
  const openButtons = card.findAll((n) => n.tagName === 'BUTTON');
  const openBtnLabels = openButtons.map((b) => b.textContent);
  assert.deepEqual(openBtnLabels, ['Acknowledge', 'Close finding']);

  // Transition OPEN -> ACKNOWLEDGED
  await openButtons[0]!.click();
  const ackCard = getEl('ledger-list').children[0]!;
  assert.equal(ackCard.dataset.findingState, 'ACKNOWLEDGED');
  assert.ok(ackCard.allText().includes('ACKNOWLEDGED'));
  assert.match(
    ackCard.allText(),
    /Updated in process memory \(ACKNOWLEDGED\)|Saved to durable storage \(ACKNOWLEDGED\)/i,
    'Card confirms state was updated after API response'
  );
  const ackButtons = ackCard.findAll((n) => n.tagName === 'BUTTON');
  assert.deepEqual(ackButtons.map((b) => b.textContent), ['Close finding', 'Reopen']);

  // Transition ACKNOWLEDGED -> CLOSED
  await ackButtons[0]!.click();
  const closedCard = getEl('ledger-list').children[0]!;
  assert.equal(closedCard.dataset.findingState, 'CLOSED');
  assert.ok(closedCard.allText().includes('CLOSED'));
  assert.match(
    closedCard.allText(),
    /Updated in process memory \(CLOSED\)|Saved to durable storage \(CLOSED\)/i,
    'Card confirms state was updated to CLOSED'
  );
  const closedButtons = closedCard.findAll((n) => n.tagName === 'BUTTON');
  assert.deepEqual(closedButtons.map((b) => b.textContent), ['Acknowledge', 'Reopen']);

  // Transition CLOSED -> OPEN (reopen)
  await closedButtons[1]!.click();
  const reopenedCard = getEl('ledger-list').children[0]!;
  assert.equal(reopenedCard.dataset.findingState, 'OPEN');
  assert.match(
    reopenedCard.allText(),
    /Updated in process memory \(OPEN\)|Saved to durable storage \(OPEN\)/i,
    'Card confirms state was updated to OPEN'
  );
  assert.equal(apiLog.filter((c) => c.path === '/api/finding-state').length, 3);
});

// 2. Failed requests & duplicate in-flight protection

test('failed finding-state requests retain the last confirmed state, never claim saved, and block duplicate in-flight requests', async () => {
  const store = createTestStore();
  const project = store.activeProject()!;
  store.setReviewer(project.id, { name: 'S. Rossi', role: 'Lead Inspector' });
  const session = store.activeSession()!;
  await session.run();
  const obs = session.view().observations[0]!;
  session.review({
    observationId: obs.id,
    decision: 'VERIFIED',
    reviewer: 'S. Rossi · Lead Inspector',
    note: null,
  });

  let rejectNext = false;
  let slowMode = false;
  let resolveSlow: ((val: unknown) => void) | null = null;

  const { h, getEl, apiLog } = createUiHarness({
    apiImpl: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (url === '/api/finding-state') {
        if (rejectNext) {
          throw Object.assign(new Error('The finding state could not be written to durable storage, so it was not changed.'), {
            status: 500,
            code: 'PERSISTENCE_FAILED',
          });
        }
        if (slowMode) {
          return await new Promise((resolve) => {
            resolveSlow = resolve;
          });
        }
        return session.setFindingState(body.findingId, body.state);
      }
      throw new Error('Unexpected ' + url);
    },
  });

  h.applyWorkspace(buildWorkspacePayload(store));
  h.renderAll();

  const findingId = (h.state.view as { findings: Array<{ id: string }> }).findings[0]!.id;

  // 1) Test failed API request
  rejectNext = true;
  await h.updateFindingState(findingId, 'ACKNOWLEDGED');

  const cardAfterFail = getEl('ledger-list').children[0]!;
  assert.equal(cardAfterFail.dataset.findingState, 'OPEN', 'Failed request must retain last confirmed OPEN state');
  const failText = cardAfterFail.allText();
  assert.match(
    failText,
    /The finding state could not be written to durable storage, so it was not changed\./i,
    'Card must show the server failure message'
  );
  assert.ok(
    !failText.includes('Saved to durable storage') && !failText.includes('Updated in process memory'),
    'UI must NEVER report a finding as saved when the server rejected the request'
  );

  // 2) Test duplicate in-flight request prevention
  rejectNext = false;
  slowMode = true;
  const p1 = h.updateFindingState(findingId, 'ACKNOWLEDGED') as Promise<void>;

  // While p1 is in-flight, buttons must be disabled and a second call must be ignored
  const inFlightCard = getEl('ledger-list').children[0]!;
  const inFlightButtons = inFlightCard.findAll((n) => n.tagName === 'BUTTON');
  assert.ok(inFlightButtons.every((b) => b.disabled), 'All action buttons on the card are disabled while in flight');
  assert.equal(inFlightCard.dataset.findingState, 'OPEN', 'Displayed state stays OPEN until API confirms');
  assert.match(inFlightCard.allText(), /Saving state change/i, 'Card indicates request is in flight');

  // Attempt duplicate call while in flight
  await h.updateFindingState(findingId, 'CLOSED');
  assert.equal(
    apiLog.filter((c) => c.path === '/api/finding-state').length,
    2,
    'Duplicate call while in-flight must not send another network request'
  );

  // Complete the in-flight request
  const updatedView = session.setFindingState(findingId, 'ACKNOWLEDGED');
  resolveSlow!(updatedView);
  await p1;

  const settledCard = getEl('ledger-list').children[0]!;
  assert.equal(settledCard.dataset.findingState, 'ACKNOWLEDGED', 'State updates to ACKNOWLEDGED once API resolves');
});

// 3. Truthful persistence feedback (durable vs memory vs write failed)

test('UI truthfully distinguishes confirmed durable writes, in-memory-only mode, and failed durable writes', async () => {
  const store = createTestStore();
  const proj = store.activeProject()!;
  store.setReviewer(proj.id, { name: 'A. Chen', role: 'Inspector' });
  const session = store.activeSession()!;
  await session.run();

  const { h, getEl } = createUiHarness();

  // Case A: In-memory only (no persistence configured)
  const memWs = buildWorkspacePayload(store);
  assert.equal((memWs.storage as { durable: boolean }).durable, false);
  h.applyWorkspace(memWs);
  h.renderAll();

  assert.equal(getEl('storage-note').dataset.durable, 'false');
  assert.match(getEl('storage-note').textContent, /process memory only/i);
  assert.match(getEl('provenance').allText(), /Process memory only \(lost on restart\)/i);

  // Case B: Durable persistence configured and write succeeded
  const temp = createTempDir();
  try {
    const durableStore = createTestStore(new WorkspacePersistence({ directory: temp.dir }));
    const dProj = durableStore.activeProject()!;
    durableStore.setReviewer(dProj.id, { name: 'A. Chen', role: 'Inspector' });
    await durableStore.activeSession()!.run();
    durableStore.persistInspection(groupKey(durableStore.selectedCaptures()));

    const durableWs = buildWorkspacePayload(durableStore);
    // Simulate `/api/run` returning `persistence: { written: true }`
    (durableWs.view as Record<string, unknown>).persistence = { written: true };
    h.applyWorkspace(durableWs);
    h.renderAll();

    assert.equal(getEl('storage-note').dataset.durable, 'true');
    assert.match(getEl('storage-note').textContent, /Confirmed written to disk/i);
    assert.match(getEl('provenance').allText(), /Confirmed written to disk/i);
    assert.equal(getEl('failures').children.length, 0, 'No failure banner when persistence succeeded');

    // Case C: Durable persistence attempted and failed (`persistence: { written: false, message: ... }`)
    const failedView = JSON.parse(JSON.stringify(durableWs.view));
    failedView.persistence = {
      written: false,
      message: 'Inspection completed, but saving to disk failed: ENOSPC: no space left on device',
    };
    const failedWs = { ...durableWs, view: failedView };
    h.applyWorkspace(failedWs);
    h.renderAll();

    assert.equal(getEl('storage-note').dataset.durable, 'failed');
    assert.match(getEl('storage-note').textContent, /Storage write failed/i);
    assert.match(getEl('provenance').allText(), /Write failed — held in process memory only/i);
    assert.match(getEl('provenance').allText(), /ENOSPC/i);
    assert.ok(getEl('failures').children.length > 0, 'Failures panel must warn when durable write failed');
    assert.match(getEl('failures').allText(), /DURABLE STORAGE WRITE FAILED/i);
  } finally {
    temp.cleanup();
  }
});

// 4. Undetermined evidence & evidenceState (LOCALIZED, FULL_FRAME, NONE)

test('renderFindings surfaces evidenceState (LOCALIZED, FULL_FRAME, NONE) and UNDETERMINED status without fabricating certainty', () => {
  const store = createTestStore();
  const proj = store.activeProject()!;
  store.setReviewer(proj.id, { name: 'R. Kouri', role: 'Engineer' });

  const { h, getEl } = createUiHarness();
  const ws = buildWorkspacePayload(store);
  const baseView = ws.view as Record<string, unknown>;

  // Inject an inspection view containing all three evidenceState values and UNDETERMINED
  const syntheticView = {
    ...baseView,
    outcome: 'COMPLETED',
    inferenceOrigin: 'LIVE',
    inspectionFindings: [
      {
        id: 'fnd_loc_1',
        origin: 'VISUAL',
        title: 'Localized rebar mat gap',
        category: 'DEVIATION',
        deterministicStatus: 'MISMATCH',
        verificationStatus: 'UNVERIFIED',
        review: null,
        severity: 'HIGH',
        observation: 'Rebar spacing is visibly wider in the lower right quadrant.',
        reason: 'Expected continuous mat coverage.',
        evidence: 'Lower right corner shows exposed formwork.',
        evidenceState: 'LOCALIZED',
        confidence: 0.85,
        recommendation: 'Inspect bar spacing before pour.',
        element: 'REBAR',
        location: 'lower right',
        boundingBox: { x: 0.5, y: 0.5, width: 0.3, height: 0.3 },
        sourceCaptureId: ws.activeCaptureId,
        sourceCaptureLabel: 'Bay 4',
      },
      {
        id: 'fnd_full_2',
        origin: 'VISUAL',
        title: 'Full-frame lighting obstruction',
        category: 'PROGRESS_OBSERVATION',
        deterministicStatus: 'ATTENTION',
        verificationStatus: 'UNVERIFIED',
        review: null,
        severity: 'MEDIUM',
        observation: 'General haze across the entire bay.',
        reason: 'Visibility is reduced across the frame.',
        evidence: 'Whole scene is backlit.',
        evidenceState: 'FULL_FRAME',
        confidence: 0.62,
        recommendation: 'Capture another angle.',
        element: null,
        location: null,
        boundingBox: null,
        sourceCaptureId: ws.activeCaptureId,
        sourceCaptureLabel: 'Bay 4',
      },
      {
        id: 'fnd_none_3',
        origin: 'COMPARISON',
        title: 'Safety net status undetermined',
        category: 'UNCERTAINTY',
        deterministicStatus: 'UNDETERMINED',
        verificationStatus: 'UNVERIFIED',
        review: null,
        severity: 'HIGH',
        observation: 'Safety netting is required by the reference but cannot be determined from this angle.',
        reason: 'Expected SAFETY_NET=PRESENT, observed UNDETERMINED.',
        evidence: '',
        evidenceState: 'NONE',
        confidence: 0,
        recommendation: 'Walk the perimeter and verify safety net installation.',
        element: 'SAFETY_NET',
        location: null,
        boundingBox: null,
        sourceCaptureId: ws.activeCaptureId,
        sourceCaptureLabel: 'Bay 4',
      },
    ],
  };

  h.applyWorkspace({ ...ws, view: syntheticView });
  h.state.openIds = new Set(['fnd_loc_1', 'fnd_full_2', 'fnd_none_3']);
  h.renderFindings();

  const cards = getEl('findings-cards').children;
  assert.equal(cards.length, 3);

  const locBadges = cards[0]!.findAll((n) => n.dataset.evidenceState === 'LOCALIZED');
  assert.equal(locBadges.length, 1, 'LOCALIZED finding renders data-evidence-state="LOCALIZED" badge');
  assert.match(locBadges[0]!.textContent, /Localized region/i);

  const fullBadges = cards[1]!.findAll((n) => n.dataset.evidenceState === 'FULL_FRAME');
  assert.equal(fullBadges.length, 1, 'FULL_FRAME finding renders data-evidence-state="FULL_FRAME" badge');
  assert.match(fullBadges[0]!.textContent, /Full-frame evidence/i);
  assert.match(cards[1]!.allText(), /no localized region/i);

  const noneBadges = cards[2]!.findAll((n) => n.dataset.evidenceState === 'NONE');
  assert.equal(noneBadges.length, 1, 'NONE finding renders data-evidence-state="NONE" badge');
  assert.match(noneBadges[0]!.textContent, /No visual evidence/i);
  assert.match(cards[2]!.allText(), /No usable visual evidence for this finding in this capture/i);

  // Every evidence state explains itself in context: WHAT the state means and WHY this item carries it, without the.
  const helpNotes = cards[0]!.findAll((n) => n.getAttribute('role') === 'note');
  assert.equal(helpNotes.length, 1, 'LOCALIZED finding carries a plain-language evidence note');
  assert.match(helpNotes[0]!.allText(), /Why: model box present/i);
  assert.match(helpNotes[0]!.allText(), /returned a region for this finding/i);

  const fullHelp = cards[1]!.findAll((n) => n.getAttribute('role') === 'note');
  assert.equal(fullHelp.length, 1, 'FULL_FRAME finding carries its own evidence note');
  assert.match(fullHelp[0]!.allText(), /Why: reported without a usable box/i);
  assert.match(fullHelp[0]!.allText(), /the inspected image plus the description/i);

  const noneHelp = cards[2]!.findAll((n) => n.getAttribute('role') === 'note');
  assert.equal(noneHelp.length, 1, 'NONE finding carries its own evidence note');
  assert.match(noneHelp[0]!.allText(), /Why: nothing reported for this element/i);
  // The NONE explanation must not read as compliance or failure: it routes the reader to a site walk, not to a verdict.
  assert.match(noneHelp[0]!.allText(), /confirm it by a site walk/i);
  assert.doesNotMatch(noneHelp[0]!.allText(), /fail|non-?complian/i);
});

// 5. Reference-change invalidation: warning, post-change notice, and durable disk cleanup across restarts

test('reference change warns before invalidating verified items, shows post-invalidation notice, and retains the audit record on disk', async () => {
  const temp = createTempDir();
  try {
    const persistence = new WorkspacePersistence({ directory: temp.dir });
    const store = createTestStore(persistence);
    // A REAL project, not the generated demo.
    const created = store.create({ name: 'Reference Change Tower', location: 'Level 03' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const project = created.value;
    const seeded = demoCaptures()[0]!;
    store.addCapture({ ...seeded, source: 'UPLOAD' });
    store.selectCapture(store.capturesOf(project.id)[0]!.id);
    store.setReviewer(project.id, { name: 'L. Vance', role: 'Senior Engineer' });
    const session = store.activeSession()!;
    await session.run();

    // Verify both an inspection finding and an observation
    const initialView = session.view();
    const firstInspFinding = initialView.inspectionFindings[0]!;
    const firstObs = initialView.observations[0]!;

    session.reviewFinding({
      findingId: firstInspFinding.id,
      decision: 'VERIFIED',
      reviewer: 'L. Vance · Senior Engineer',
      note: 'Verified under baseline reference',
    });
    session.review({
      observationId: firstObs.id,
      decision: 'VERIFIED',
      reviewer: 'L. Vance · Senior Engineer',
      note: 'Raised to ledger before reference change',
    });
    store.persistInspection(groupKey(store.selectedCaptures()));

    // Pick a different preset id from the catalog
    const originalPreset = store.referenceFor(project.id).presetId;
    const altPreset = store.presets.list().find((p) => p.id !== originalPreset)!;

    let allowConfirm = false;
    const { h, getEl, confirmCalls } = createUiHarness({
      confirmImpl: () => allowConfirm,
      apiImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(init.body) : {};
        if (url === '/api/expected') {
          store.usePreset(project.id, body.presetId);
          return buildWorkspacePayload(store);
        }
        throw new Error('Unexpected ' + url);
      },
    });

    h.applyWorkspace(buildWorkspacePayload(store));
    h.renderAll();

    // 1) Operator cancels confirmation dialog -> reference change is aborted
    await h.applyExpected(altPreset.id);
    assert.equal(confirmCalls.length, 1, 'Confirmation prompt shown when active inspection has human reviews');
    assert.match(
      confirmCalls[0]!,
      /invalidate the current inspection and clear 2 human verification\(s\) and 1 verified ledger finding\(s\)/i
    );
    assert.equal(
      (h.state.view as { outcome: string }).outcome,
      'COMPLETED',
      'Cancelling confirmation preserves the current inspection'
    );

    // 2) Operator confirms -> reference change invalidates inspection, verifications, and session ledger, and shows banner
    allowConfirm = true;
    await h.applyExpected(altPreset.id);
    assert.equal(confirmCalls.length, 2);
    assert.equal(
      (h.state.view as { outcome: string }).outcome,
      'PENDING',
      'Post-change inspection outcome is reset to PENDING'
    );
    assert.equal(
      (h.state.view as { findings: unknown[] }).findings.length,
      0,
      'Session ledger findings are cleared when the comparison reference changes (adoptReference contract)'
    );

    const findingsCardsText = getEl('findings-cards').allText();
    assert.match(
      findingsCardsText,
      /Reference updated for .*\bPrior inspection results and 2 human verification record\(s\) were invalidated/i,
      'Evidence findings panel displays the post-invalidation notice explaining why a re-run is required'
    );
    const obsSectionText = getEl('findings').allText();
    assert.match(
      obsSectionText,
      /Reference updated for .*\bPrior inspection results and 2 human verification record\(s\) were invalidated/i,
      'Observations & Ledger panel also displays the post-invalidation notice'
    );

    // 3) Restart store against the same data directory: the invalidated inspection and its cleared ledger must NOT come back from disk...
    const restartedStore = createTestStore(new WorkspacePersistence({ directory: temp.dir }));
    const restartedView = restartedStore.activeSession()!.view();
    assert.equal(
      restartedView.outcome,
      'PENDING',
      'Restarted store must not resurrect an inspection that was invalidated by a reference change'
    );
    assert.equal(
      restartedView.findings.length,
      0,
      'Restarted store must not resurrect invalidated ledger findings from disk'
    );

    // ...but the record itself is RETAINED.
    const recordPath = persistence.inspectionFile(groupKey(store.selectedCaptures()));
    assert.equal(
      existsSync(recordPath),
      true,
      'the audit record for the invalidated inspection must be retained, not deleted',
    );
    const retained = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    const retainedPayload = retained.payload as { observations: unknown[] };
    assert.ok(
      retainedPayload.observations.length > 0,
      'the raw model payload must survive the reference change',
    );
    assert.ok(
      (retained.observationReviews as unknown[]).length >= 1,
      'the human verification trail must survive the reference change',
    );
    assert.ok(
      (retained.reviews as unknown[]).length >= 1,
      'the inspection-finding human verification must survive the reference change',
    );
    assert.ok(
      (retained.ledgerFindings as unknown[]).length >= 1,
      'the verified ledger finding must survive the reference change',
    );
    assert.equal(
      retained.referencePresetId,
      originalPreset,
      'the record must name the reference it was judged against, not the replacement',
    );
  } finally {
    temp.cleanup();
  }
});

// 6. Project & capture isolation + durable restart recovery over HTTP

async function listenTestServer(dir: string) {
  const handle = createInspectionServer({
    provider: new DemoFixtureProvider(),
    reasoner: new UnavailableReasoner({ kind: 'DISABLED', message: 'test' }),
    persistence: new WorkspacePersistence({ directory: dir }),
    zoneId: 'zone_level_02',
    initialCaptureId: null,
  });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = handle.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve, reject) => handle.server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('HTTP server enforces project/capture isolation for ledger findings and restores ledger state after restart', async () => {
  const temp = createTempDir();
  try {
    const srv1 = await listenTestServer(temp.dir);
    try {
      const base = srv1.url;
      const postJson = async (path: string, body: unknown) => {
        const r = await fetch(base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: r.status, data: (await r.json()) as Record<string, unknown> };
      };

      // Set reviewer & run inspection in Project 1
      const revSetup = await postJson('/api/reviewer', { name: 'Inspector One', role: 'QA' });
      assert.equal(revSetup.status, 200);
      const ws1 = await (await fetch(base + '/api/workspace')).json() as {
        activeCaptureId: string;
        project: { id: string };
      };
      const run1 = await postJson('/api/run', { captureIds: [ws1.activeCaptureId], cache: true });
      assert.equal(run1.status, 200);
      const obs1 = (run1.data.observations as Array<{ id: string }>)[0]!;

      // Verify observation -> raises ledger finding in Project 1
      const rev1 = await postJson('/api/review', {
        observationId: obs1.id,
        decision: 'VERIFIED',
        note: 'Project 1 verified observation',
      });
      assert.equal(rev1.status, 200);
      const findings1 = rev1.data.findings as Array<{ id: string; state: string; projectId: string }>;
      assert.equal(findings1.length, 1);
      const findingId = findings1[0]!.id;
      assert.equal(findings1[0]!.state, 'OPEN');
      assert.equal(findings1[0]!.projectId, ws1.project.id);

      // Acknowledge the finding in Project 1
      const ack1 = await postJson('/api/finding-state', { findingId, state: 'ACKNOWLEDGED' });
      assert.equal(ack1.status, 200);
      assert.equal((ack1.data.findings as Array<{ state: string }>)[0]!.state, 'ACKNOWLEDGED');

      // Create Project 2 and switch to it
      const createP2 = await postJson('/api/projects', { name: 'Isolated Project Two', location: 'Zone B' });
      assert.equal(createP2.status, 201);
      const p2Findings = (createP2.data.view as { findings?: unknown[] } | null)?.findings ?? [];
      assert.equal(p2Findings.length, 0, 'Switching to Project 2 must not expose Project 1 ledger findings');

      // Set reviewer on Project 2 and attempt to mutate Project 1's finding while Project 2 is active -> must fail
      await postJson('/api/reviewer', { name: 'Inspector Two', role: 'QA' });
      const crossMutate = await postJson('/api/finding-state', { findingId, state: 'CLOSED' });
      assert.ok(crossMutate.status === 400 || crossMutate.status === 404, 'Cannot mutate a finding belonging to another project');

      // Switch back to Project 1
      await postJson('/api/projects/switch', { projectId: ws1.project.id });
    } finally {
      await srv1.close();
    }

    // Restart a brand-new server instance against the same temp data directory
    const srv2 = await listenTestServer(temp.dir);
    try {
      const wsAfterRestart = await (await fetch(srv2.url + '/api/workspace')).json() as {
        view: { findings: Array<{ id: string; state: string; raisedBy: string }> };
      };
      assert.equal(wsAfterRestart.view.findings.length, 1, 'Verified ledger finding survives server restart');
      assert.equal(wsAfterRestart.view.findings[0]!.state, 'ACKNOWLEDGED', 'Triage state ACKNOWLEDGED survives server restart');
      assert.equal(wsAfterRestart.view.findings[0]!.raisedBy, 'Inspector One · QA', 'Reviewer attribution survives server restart');
    } finally {
      await srv2.close();
    }
  } finally {
    temp.cleanup();
  }
});

// 7. HTML & responsive mobile CSS contracts

test('shipped HTML, JS, and CSS include the verified-finding ledger and mobile responsive rules', () => {
  assert.match(INDEX_HTML, /id="bay-findings"/, 'INDEX_HTML contains #bay-findings');
  assert.match(INDEX_HTML, /id="findings"/, 'INDEX_HTML contains #findings mount point');
  assert.match(APP_JS, /ledger-section/, 'APP_JS renders #ledger-section');
  assert.match(APP_JS, /\/api\/finding-state/, 'APP_JS wires POST /api/finding-state');
  assert.match(APP_CSS, /\.ledger-card\b/, 'APP_CSS styles .ledger-card');
  assert.match(APP_CSS, /\.ledger-state-acknowledged\b/, 'APP_CSS styles .ledger-state-acknowledged');
  assert.match(APP_CSS, /@media\s*\(max-width:\s*640px\)/, 'APP_CSS includes mobile breakpoint rules for ledger/observation panels');
  // The observation row's "Ledger finding: <id>" tag names a full record id, and .tag is white-space:nowrap.
  assert.match(APP_CSS, /\.obs-raised\s*\{[^}]*overflow-wrap:\s*anywhere/,
    'the ledger-reference tag on an observation must be able to wrap at any point');
  assert.match(APP_JS, /obs-raised/,
    'APP_JS must apply that class to the observation\'s ledger-reference tag');
});

// 8. Observation rejection removes ledger finding & UI scope guards

test('rejecting a previously verified observation removes its ledger finding, and UI scope guards filter out-of-scope findings', async () => {
  const store = createTestStore();
  const project = store.activeProject()!;
  store.setReviewer(project.id, { name: 'K. Mansour', role: 'Lead' });
  const session = store.activeSession()!;
  await session.run();
  const obs = session.view().observations[0]!;

  const { h, getEl, apiLog } = createUiHarness({
    apiImpl: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (url === '/api/review') {
        return session.review({
          observationId: body.observationId,
          decision: body.decision,
          reviewer: 'K. Mansour · Lead',
          note: body.note ?? null,
        });
      }
      throw new Error('Unexpected ' + url);
    },
  });

  h.applyWorkspace(buildWorkspacePayload(store));
  h.renderAll();

  await h.submitObservationReview(obs.id, 'VERIFIED');
  assert.equal(getEl('ledger-list').children.length, 1, 'Ledger finding created on VERIFIED');

  // Now reject the same observation -> ledger finding must be removed
  await h.submitObservationReview(obs.id, 'REJECTED');
  assert.equal(getEl('ledger-empty').hidden, false, 'Rejecting observation removes finding and restores empty ledger state');

  // Inject an out-of-scope finding from another project into view.findings and verify client scope guard hides it and.
  const ws = buildWorkspacePayload(store);
  const foreignView = {
    ...(ws.view as Record<string, unknown>),
    findings: [
      {
        id: 'find_foreign_99',
        sourceObservationId: 'obs_foreign_1',
        captureId: 'cap_foreign_1',
        projectId: 'proj_foreign_99',
        zoneId: 'zone_other',
        category: 'SAFETY_ATTENTION',
        summary: 'Foreign project finding that must not leak',
        evidenceDescription: 'Foreign evidence',
        suggestedAction: 'HUMAN_REVIEW',
        severity: 'HIGH',
        raisedBy: 'Other Reviewer',
        raisedAt: '2026-10-11T00:00:00.000Z',
        state: 'OPEN',
        target: 'sitelens-isolated-hackathon',
      },
    ],
  };
  h.applyWorkspace({ ...ws, view: foreignView });
  h.renderObservations();
  assert.equal(getEl('ledger-empty').hidden, false, 'Out-of-scope foreign finding is filtered out of the ledger UI');

  const countBefore = apiLog.length;
  await h.updateFindingState('find_foreign_99', 'ACKNOWLEDGED');
  assert.equal(apiLog.length, countBefore, 'updateFindingState refuses out-of-scope finding without calling the API');
});

// 9. Consolidated multi-image (grp_*) reference-change invalidation

test('reference change supersedes consolidated multi-image (grp_*) persisted inspections so they do not resurrect on restart, while retaining the audit record', async () => {
  const temp = createTempDir();
  try {
    const persistence = new WorkspacePersistence({ directory: temp.dir });
    const store = createTestStore(persistence);
    // A REAL project, so its reference is durable across a restart.
    const created = store.create({ name: 'Consolidated Group Tower', location: 'Level 05' });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const project = created.value;
    store.setReviewer(project.id, { name: 'N. Patel', role: 'Director' });

    const groupIds: string[] = [];
    for (const fixture of [demoCaptures()[0]!, demoCaptures()[1]!]) {
      groupIds.push(store.addCapture({ ...fixture, source: 'UPLOAD' }).id);
    }
    store.selectCaptureGroup(groupIds);

    const groupSession = store.activeSession()!;
    await groupSession.run();
    const obs = groupSession.view().observations[0]!;
    groupSession.review({
      observationId: obs.id,
      decision: 'VERIFIED',
      reviewer: 'N. Patel · Director',
      note: 'Consolidated group verification',
    });

    const gKey = groupKey(store.selectedCaptures());
    assert.match(gKey, /^grp_/, 'Multi-capture key uses grp_ prefix');
    assert.equal(store.persistInspection(gKey), true);

    // Change reference on the project -> the consolidated record is superseded
    const altPreset = store.presets.list().find((p) => p.id !== store.referenceFor(project.id).presetId)!;
    store.usePreset(project.id, altPreset.id);

    // The record stays on disk as the audit trail for the consolidated run.
    const groupFile = persistence.inspectionFile(gKey);
    assert.equal(
      existsSync(groupFile),
      true,
      'the consolidated audit record must be retained, not deleted',
    );

    // Restart store against the same directory and select the same capture group
    const restarted = createTestStore(new WorkspacePersistence({ directory: temp.dir }));
    restarted.selectCaptureGroup(groupIds);
    const restartedView = restarted.activeSession()!.view();
    assert.equal(
      restartedView.outcome,
      'PENDING',
      'Consolidated grp_* inspection must not resurrect from disk after reference invalidation'
    );
    assert.equal(restartedView.findings.length, 0);
  } finally {
    temp.cleanup();
  }
});
