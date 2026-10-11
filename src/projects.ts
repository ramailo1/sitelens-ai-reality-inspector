// Projects and the captures they own.

import { randomUUID } from 'node:crypto';
import type { AIProvider } from './providers/provider.ts';
import type { Reasoner } from './providers/nemotron-reasoner.ts';
import { UnavailableReasoner } from './providers/nemotron-reasoner.ts';
import type { WorkspacePersistence, PersistedCapture } from './persistence.ts';
import type { DemoCapture } from './captures.ts';
import { demoCaptures } from './captures.ts';
import { InspectionSession } from './session.ts';
import { validateReasoning } from './reasoning.ts';
import type { ReasoningFailureKind } from './reasoning.ts';
import { PresetStore, cloneExpectedState, presetToState } from './expected-state.ts';
import type { ModelTranslator } from './model-translation.ts';
import { DEFAULT_EXPECTED_PRESET_ID } from './expected-state.ts';
import type { ExpectedState } from './types/inspection.ts';
import { partitionDuplicates } from './multi-image.ts';

export const MAX_PROJECT_NAME = 80;
export const MAX_PROJECT_LOCATION = 120;

// A deterministic key for a group of captures.
export function groupKey(captures: readonly ProjectCapture[]): string {
  const first = captures[0];
  if (captures.length <= 1) return first === undefined ? 'group_empty' : first.id;
  return `grp_${captures.map((c) => c.id).join('+')}`;
}

export interface ReviewerIdentity {
  readonly name: string;
  readonly role: string | null;
}

export function formatReviewer(reviewer: ReviewerIdentity | string | null | undefined): string | null {
  if (reviewer === null || reviewer === undefined) return null;
  if (typeof reviewer === 'string') {
    const trimmed = reviewer.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const name = typeof reviewer.name === 'string' ? reviewer.name.trim() : '';
  const role = typeof reviewer.role === 'string' ? reviewer.role.trim() : '';
  if (name.length === 0) return null;
  return role.length > 0 ? `${name} · ${role}` : name;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly createdAt: string;
  // True for the generated project the app opens on.
  readonly demo: boolean;
  readonly reviewer: ReviewerIdentity | null;
}

export type ProjectSummary = Project & { readonly captureCount: number };

// A capture owned by exactly one project.
export interface ProjectCapture extends DemoCapture {
  readonly projectId: string;
  readonly source: 'UPLOAD' | 'DEMO_FIXTURE' | 'LOCAL_DATASET';
  readonly zoneId: string | null;
  readonly createdAt: string;
  // EXIF orientation recorded in the ORIGINAL file, before normalization.
  readonly exifOrientation: number;
  // True when the stored pixels were normalized away from the source rotation.
  readonly geometryNormalized: boolean;
  // Where the bytes live on disk when persistence is attached; null otherwise.
  readonly bytesPath: string | null;
  // True when bytesPath is relative to the local dataset directory.
  readonly bytesRelativeToDataset: boolean;
}

// A project's comparison reference: which preset it uses, plus any operator edits applied to it.
export interface ProjectReference {
  readonly presetId: string;
  readonly state: ExpectedState;
  readonly edited: boolean;
}

export type ProjectRejection =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'LOCATION_TOO_LONG'
  | 'UNKNOWN_PROJECT'
  | 'UNKNOWN_CAPTURE'
  | 'NOT_OWNED'
  | 'UNKNOWN_PRESET';

export type ProjectResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ProjectRejection; readonly message: string };

function fail(reason: ProjectRejection, message: string): ProjectResult<never> {
  return { ok: false, reason, message };
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

// Trim and validate an operator-supplied project name.
export function cleanProjectName(raw: unknown): ProjectResult<string> {
  if (typeof raw !== 'string') return fail('NAME_REQUIRED', 'A project name is required.');
  const name = raw.trim();
  if (name.length === 0) return fail('NAME_REQUIRED', 'A project name is required.');
  if (name.length > MAX_PROJECT_NAME) {
    return fail('NAME_TOO_LONG', `Project names are limited to ${MAX_PROJECT_NAME} characters.`);
  }
  return { ok: true, value: name };
}

function cleanLocation(raw: unknown): ProjectResult<string> {
  if (typeof raw !== 'string') return { ok: true, value: '' };
  const location = raw.trim();
  if (location.length > MAX_PROJECT_LOCATION) {
    return fail('LOCATION_TOO_LONG', `Locations are limited to ${MAX_PROJECT_LOCATION} characters.`);
  }
  return { ok: true, value: location };
}

export class ProjectStore {
  private readonly provider: AIProvider;
  private readonly reasoner: Reasoner;
  private readonly translator: ModelTranslator | null;
  private readonly zoneId: string | null;
  private readonly projects = new Map<string, Project>();
  private readonly captures = new Map<string, ProjectCapture>();
  private readonly sessions = new Map<string, InspectionSession>();
  private readonly references = new Map<string, ProjectReference>();
  // The reference catalogue. Shared by every project; never mutated per project.
  public readonly presets: PresetStore;
  // Optional durable state.
  private readonly persistence: WorkspacePersistence | null;
  // Captures whose persisted inspection has already been applied to a session.
  private readonly hydrated = new Set<string>();
  private activeProjectId: string | null = null;
  private activeCaptureId: string | null = null;
  // The ordered photographs of the CURRENT inspection group.
  private activeCaptureIds: string[] = [];
  // Byte-identical photographs refused from the last selection.
  private duplicateCaptureIds: string[] = [];

  public constructor(options: {
    readonly provider: AIProvider;
    readonly zoneId: string | null;
    readonly presets?: PresetStore;
    // The stage-2 reasoning model. Absent means reasoning is explicitly off.
    readonly reasoner?: Reasoner;
    // Presentation translator for novel model prose. Absent keeps memory-only.
    readonly translator?: ModelTranslator | null;
    // Durable state. Omit for the in-memory demonstration surface.
    readonly persistence?: WorkspacePersistence | null;
  }) {
    this.provider = options.provider;
    this.zoneId = options.zoneId;
    this.presets = options.presets ?? new PresetStore();
    this.persistence = options.persistence ?? null;
    this.translator = options.translator ?? null;
    this.reasoner = options.reasoner ?? new UnavailableReasoner({
      kind: 'DISABLED',
      message:
        'No construction-reasoning model is attached to this store, so stage 2 of the pipeline '
        + 'is switched off. The visual observation and the deterministic comparison are unaffected.',
    });
  }

  // The reasoner in force, exposed so the server can report it truthfully.
  public getReasoner(): Reasoner {
    return this.reasoner;
  }

  public hasPersistence(): boolean {
    return this.persistence !== null;
  }

  // The storage truth for THIS instance. Never a hard-coded claim.
  public describeStorage(): { location: string; durable: boolean; detail: string } {
    if (this.persistence === null) {
      return {
        location: 'process memory',
        durable: false,
        detail:
          'Uploaded images are held in this running process only. Nothing is written to disk, so '
          + 'uploads, projects and references are lost when the server restarts.',
      };
    }
    return this.persistence.describe();
  }

  public activeProject(): Project | null {
    return this.activeProjectId === null ? null : (this.projects.get(this.activeProjectId) ?? null);
  }

  // Whether a project id is still known, regardless of which one is active.
  public has(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  public list(): ProjectSummary[] {
    return [...this.projects.values()].map((project) => ({
      ...project,
      captureCount: this.capturesOf(project.id).length,
    }));
  }

  public capturesOf(projectId: string): ProjectCapture[] {
    return [...this.captures.values()].filter((c) => c.projectId === projectId);
  }

  // Capture by id, but only when the active project owns it.
  public activeCapture(id: string): ProjectResult<ProjectCapture> {
    if (this.activeProjectId === null) return fail('UNKNOWN_PROJECT', 'No project is selected.');
    const capture = this.captures.get(id);
    if (!capture) return fail('UNKNOWN_CAPTURE', 'That capture no longer exists.');
    if (capture.projectId !== this.activeProjectId) {
      return fail('NOT_OWNED', 'That capture belongs to another project.');
    }
    return { ok: true, value: capture };
  }

  public selectedCaptureId(): string | null {
    return this.activeCaptureId;
  }

  public create(input: { name: unknown; location?: unknown }): ProjectResult<Project> {
    const name = cleanProjectName(input.name);
    if (!name.ok) return name;
    const location = cleanLocation(input.location);
    if (!location.ok) return location;

    const project: Project = {
      id: newId('proj'),
      name: name.value,
      location: location.value,
      createdAt: new Date().toISOString(),
      demo: false,
      reviewer: null,
    };
    this.projects.set(project.id, project);
    this.referenceFor(project.id);
    // A new project becomes active immediately and starts genuinely empty: it inherits no captures and no reference from.
    this.activeProjectId = project.id;
    this.activeCaptureId = null;
    this.activeCaptureIds = [];
    this.duplicateCaptureIds = [];
    this.persist();
    return { ok: true, value: project };
  }

  public setReviewer(projectId: string, input: { name: unknown; role?: unknown }): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      return fail('NAME_REQUIRED', 'Reviewer name is required.');
    }
    const name = input.name.trim();
    if (name.length > MAX_PROJECT_NAME) {
      return fail('NAME_TOO_LONG', `Reviewer name must not exceed ${MAX_PROJECT_NAME} characters.`);
    }
    let role: string | null = null;
    if (typeof input.role === 'string' && input.role.trim().length > 0) {
      role = input.role.trim();
      if (role.length > MAX_PROJECT_LOCATION) {
        return fail('LOCATION_TOO_LONG', `Reviewer role must not exceed ${MAX_PROJECT_LOCATION} characters.`);
      }
    }
    const updated: Project = { ...project, reviewer: { name, role } };
    this.projects.set(projectId, updated);
    this.persist();
    return { ok: true, value: updated };
  }

  public rename(projectId: string, rawName: unknown): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    const name = cleanProjectName(rawName);
    if (!name.ok) return name;
    const updated: Project = { ...project, name: name.value };
    this.projects.set(projectId, updated);
    this.persist();
    return { ok: true, value: updated };
  }

  public setLocation(projectId: string, rawLocation: unknown): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    const location = cleanLocation(rawLocation);
    if (!location.ok) return location;
    const updated: Project = { ...project, location: location.value };
    this.projects.set(projectId, updated);
    this.persist();
    return { ok: true, value: updated };
  }

  // Switch the active project. Nothing from the previous project stays selected.
  public switchTo(projectId: string): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    this.activeProjectId = projectId;
    this.selectDefaultCapture(projectId);
    this.persist();
    return { ok: true, value: project };
  }

  // Select the capture a project should open on.
  private isCaptureInspected(captureId: string): boolean {
    if (this.sessions.get(captureId)?.inspected() === true) return true;
    if (this.persistence !== null && !this.hydrated.has(captureId)) {
      return this.persistence.loadInspection(captureId) !== null;
    }
    return false;
  }

  public selectDefaultCapture(projectId: string): string | null {
    const captures = this.capturesOf(projectId);
    const inspected = captures.filter((c) => this.isCaptureInspected(c.id));
    const pool = inspected.length > 0 ? inspected : captures;
    const last = pool.length > 0 ? pool[pool.length - 1] : undefined;
    this.activeCaptureId = last === undefined ? null : last.id;
    // A default selection is always ONE photograph.
    this.activeCaptureIds = last === undefined ? [] : [last.id];
    // The capture is now on screen, so its last inspection must be too.
    if (last !== undefined) {
      const session = this.sessionFor(last);
      this.hydrateFromPersistence(last, session);
    }
    return this.activeCaptureId;
  }

  // Delete a project and everything it owns.
  public delete(
    projectId: string,
  ): ProjectResult<{ readonly deleted: Project; readonly activeProjectId: string | null }> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');

    for (const capture of this.capturesOf(projectId)) {
      this.releaseCaptureState(capture);
      this.captures.delete(capture.id);
      this.sessions.delete(capture.id);
    }
    this.references.delete(projectId);
    this.projects.delete(projectId);

    if (this.activeProjectId === projectId) {
      this.activeProjectId = this.list()[0]?.id ?? null;
      if (this.activeProjectId !== null) this.selectDefaultCapture(this.activeProjectId);
      else {
        // No surviving project: nothing may stay selected, including the multi-image group.
        this.activeCaptureId = null;
        this.activeCaptureIds = [];
        this.duplicateCaptureIds = [];
      }
    }
    this.persist();
    return { ok: true, value: { deleted: project, activeProjectId: this.activeProjectId } };
  }

  // Drop everything durable and in-memory that belongs to ONE capture.
  private releaseCaptureState(capture: ProjectCapture): void {
    this.hydrated.delete(capture.id);
    for (const [key, session] of this.sessions.entries()) {
      if (key === capture.id || session.imageIds.includes(capture.id)) {
        this.sessions.delete(key);
        this.hydrated.delete(key);
        this.persistence?.deleteInspection(key);
      }
    }
    const store = this.persistence;
    if (store === null) return;
    store.deleteInspection(capture.id);
    // A dataset image belongs to the dataset, not to this project, so its file is never removed: only the reference to it.
    if (capture.source === 'UPLOAD' && capture.bytesPath !== null) {
      store.deleteUpload(capture.bytesPath);
    }
  }

  public addCapture(input: {
    readonly id: string;
    readonly label: string;
    readonly bytes: Buffer;
    readonly mediaType: string;
    readonly dimensions: DemoCapture['dimensions'];
    readonly content: string;
    readonly source: ProjectCapture['source'];
    readonly zoneId?: string | null;
    readonly exifOrientation?: number;
    readonly geometryNormalized?: boolean;
    readonly bytesPath?: string | null;
    readonly bytesRelativeToDataset?: boolean;
  }): ProjectCapture {
    if (this.activeProjectId === null) {
      throw new Error('a capture cannot be stored before a project is active');
    }
    const stored: ProjectCapture = {
      id: input.id,
      label: input.label,
      bytes: input.bytes,
      mediaType: input.mediaType,
      dimensions: input.dimensions,
      content: input.content,
      projectId: this.activeProjectId,
      source: input.source,
      zoneId: input.zoneId ?? this.zoneId,
      createdAt: new Date().toISOString(),
      // Default 1 = no rotation, which is the true answer for a PNG upload and for any JPEG the importer already normalized.
      exifOrientation: input.exifOrientation ?? 1,
      geometryNormalized: input.geometryNormalized ?? false,
      bytesPath: input.bytesPath ?? null,
      bytesRelativeToDataset: input.bytesRelativeToDataset ?? false,
    };
    this.captures.set(stored.id, stored);
    this.persist();
    // Read back rather than returning `stored`: persisting writes an upload to disk and records its path on the STORED.
    return this.captures.get(stored.id) ?? stored;
  }

  // Delete a capture owned by the active project.
  public deleteCapture(
    captureId: string,
  ): ProjectResult<{ readonly deleted: ProjectCapture; readonly activeCaptureId: string | null }> {
    const owned = this.activeCapture(captureId);
    if (!owned.ok) return owned;

    this.captures.delete(captureId);
    this.sessions.delete(captureId);
    this.releaseCaptureState(owned.value);

    // Reconcile the multi-image group: it must never name a capture that no longer exists, or the next inspection fails as.
    const alive = new Set(this.capturesOf(owned.value.projectId).map((c) => c.id));
    const survived = this.activeCaptureIds.filter((id) => alive.has(id));
    if (survived.length > 0) {
      this.activeCaptureIds = survived;
      if (this.activeCaptureId === null || !alive.has(this.activeCaptureId)) {
        this.activeCaptureId = survived[0] as string;
      }
    } else {
      // The deleted capture's result went with it, so the fallback follows the same rule as entering a project: prefer.
      const remaining = this.capturesOf(owned.value.projectId);
      const inspected = remaining.filter((c) => this.isCaptureInspected(c.id));
      const pool = inspected.length > 0 ? inspected : remaining;
      const last = pool.length > 0 ? pool[pool.length - 1] : undefined;
      this.activeCaptureId = last === undefined ? null : last.id;
      this.activeCaptureIds = last === undefined ? [] : [last.id];
      if (last !== undefined) {
        const session = this.sessionFor(last);
        this.hydrateFromPersistence(last, session);
      }
    }
    this.duplicateCaptureIds = this.duplicateCaptureIds.filter((id) => alive.has(id));
    this.persist();
    return { ok: true, value: { deleted: owned.value, activeCaptureId: this.activeCaptureId } };
  }

  public referenceFor(projectId: string): ProjectReference {
    const existing = this.references.get(projectId);
    if (existing) return { ...existing, state: cloneExpectedState(existing.state) };
    const preset = this.presets.get(DEFAULT_EXPECTED_PRESET_ID);
    const seeded: ProjectReference = {
      presetId: DEFAULT_EXPECTED_PRESET_ID,
      state: preset === null
        ? cloneExpectedState(this.presets.defaultExpectedState())
        : presetToState(preset),
      edited: false,
    };
    this.references.set(projectId, seeded);
    this.persist();
    return { ...seeded, state: cloneExpectedState(seeded.state) };
  }

  public expectedFor(projectId: string): ExpectedState {
    return this.referenceFor(projectId).state;
  }

  // Point a project at a preset.
  public usePreset(projectId: string, presetId: string): ProjectResult<ProjectReference> {
    const preset = this.presets.get(presetId);
    if (!preset) return fail('UNKNOWN_PRESET', 'That reference no longer exists.');
    const reference: ProjectReference = {
      presetId,
      state: presetToState(preset),
      edited: false,
    };
    this.references.set(projectId, reference);
    this.markStale(projectId);
    this.persist();
    return { ok: true, value: { ...reference, state: cloneExpectedState(reference.state) } };
  }

  // Record operator edits against the project's own copy of the reference.
  public setReferenceState(projectId: string, state: ExpectedState): ProjectReference {
    const current = this.referenceFor(projectId);
    const reference: ProjectReference = { ...current, state, edited: true };
    this.references.set(projectId, reference);
    this.markStale(projectId);
    this.persist();
    return { ...reference, state: cloneExpectedState(state) };
  }

  // Push a project's reference into its sessions, dropping results it invalidates.
  private markStale(projectId: string): void {
    const reference = this.referenceFor(projectId);
    const projectCaptureIds = new Set(this.capturesOf(projectId).map((c) => c.id));
    for (const session of this.sessions.values()) {
      if (session.imageIds.some((id) => projectCaptureIds.has(id))) {
        session.adoptReference(reference.state);
      }
    }
  }

  // Session for a capture, created on first use and reused afterwards.
  public sessionFor(capture: ProjectCapture): InspectionSession {
    return this.sessionForGroup([capture]);
  }

  // The session for an ORDERED group of captures.
  public sessionForGroup(captures: readonly ProjectCapture[]): InspectionSession {
    const first = captures[0];
    if (first === undefined) {
      throw new Error('an inspection session requires at least one capture');
    }
    const groupId = groupKey(captures);
    const existing = this.sessions.get(groupId);
    if (existing) return existing;

    const created = new InspectionSession(
      this.provider,
      first,
      first.projectId,
      first.zoneId,
      this.expectedFor(first.projectId),
      {
        reasoner: this.reasoner,
        translator: this.translator,
        // The project NAME is context for the reasoning stage, and the name is operator-entered rather than observed, so the.
        projectName: this.projects.get(first.projectId)?.name ?? null,
        additionalCaptures: captures.slice(1),
      },
    );
    this.sessions.set(groupId, created);
    return created;
  }

  // Select one or more captures as the inspection to work on.
  public selectCaptureGroup(captureIds: readonly string[]): ProjectResult<InspectionSession> {
    if (captureIds.length === 0) {
      return { ok: false, reason: 'UNKNOWN_CAPTURE', message: 'Select at least one photograph.' };
    }
    const owned: ProjectCapture[] = [];
    for (const id of captureIds) {
      const found = this.activeCapture(id);
      if (!found.ok) return found;
      owned.push(found.value);
    }
    // De-duplicated while preserving order, so selecting the same photograph twice cannot analyse it twice or count it as.
    const unique: ProjectCapture[] = [];
    const seen = new Set<string>();
    for (const capture of owned) {
      if (seen.has(capture.id)) continue;
      seen.add(capture.id);
      unique.push(capture);
    }

    // A byte-identical photograph is the same evidence twice, whatever it is named.
    const deduped = partitionDuplicates(unique);
    this.duplicateCaptureIds = deduped.refused.slice();
    // The original ProjectCapture objects, so their provenance survives.
    const ordered: ProjectCapture[] = deduped.accepted.slice();

    this.activeCaptureId = (ordered[0] as ProjectCapture).id;
    this.activeCaptureIds = ordered.map((c) => c.id);
    const session = this.sessionForGroup(ordered);
    // Reopen whatever this group was last inspected to, so returning to a project lands on its findings rather than on an.
    for (const capture of ordered) this.hydrateFromPersistence(capture, session);
    this.persist();
    return { ok: true, value: session };
  }

  // Photographs dropped from the last selection as byte-identical duplicates.
  public refusedDuplicateIds(): readonly string[] {
    return this.duplicateCaptureIds;
  }

  // The captures of the current inspection group, in order.
  public selectedCaptureIds(): readonly string[] {
    if (this.activeCaptureIds.length > 0) return this.activeCaptureIds;
    return this.activeCaptureId === null ? [] : [this.activeCaptureId];
  }

  // The captures of the current group, resolved against the active project.
  public selectedCaptures(): ProjectCapture[] {
    const out: ProjectCapture[] = [];
    for (const id of this.selectedCaptureIds()) {
      const owned = this.activeCapture(id);
      if (owned.ok) out.push(owned.value);
    }
    return out;
  }

  // Select ONE capture as the inspection to work on.
  public selectCapture(captureId: string): ProjectResult<InspectionSession> {
    return this.selectCaptureGroup([captureId]);
  }

  // Restore a capture's last inspection into its session, once.
  private hydrateFromPersistence(
    capture: ProjectCapture,
    session: InspectionSession,
  ): void {
    const store = this.persistence;
    if (store === null) return;
    if (session.inspected()) return;

    // A consolidated inspection is WRITTEN under the group key, so it must be READ under the group key too.
    const key = groupKey(this.selectedCaptures());
    if (this.hydrated.has(key)) return;

    const record = store.loadInspection(key);
    if (record === null) return;

    // An inspection judged against a reference the project has since replaced is superseded, not deleted: the record stays.
    const sessionProject = session.project;
    // Resolved through referenceFor() rather than read from the map, so a project whose reference has never been written.
    const currentPresetId = sessionProject === null
      ? null
      : this.referenceFor(sessionProject).presetId;
    if (
      record.referencePresetId !== undefined
      && record.referencePresetId !== currentPresetId
    ) {
      return;
    }

    // Marked visited only once the record is actually adopted, so a reference change followed by a re-inspection can be.
    this.hydrated.add(key);
    if (!session.restoreInspection(record)) return;

    // Reasoning is restored alongside the result so a reopened capture still shows the reasoning that produced it.
    const reasoning = record.reasoning;
    if (reasoning !== null) {
      if (reasoning.status === 'AVAILABLE') {
        const validated = validateReasoning(reasoning.reasoning);
        if (validated.ok) {
          session.restoreReasoning(validated.value, {
            model: reasoning.model ?? record.model,
            provider: 'nebius-nemotron-reasoner',
            reasonedAt: record.savedAt,
            latencyMs: 0,
            rowsConsidered: 0,
            detectionsConsidered: 0,
            degenerate: false,
          });
        }
      } else if (reasoning.kind !== null) {
        session.restoreReasoningFailure(
          reasoning.kind as ReasoningFailureKind,
          reasoning.message ?? 'Construction reasoning was unavailable for this inspection.',
        );
      }
    }
  }

  public activeSession(): InspectionSession | null {
    if (this.activeCaptureId === null) return null;
    // The WHOLE group, so a consolidated inspection keeps its other photographs.
    const captures = this.selectedCaptures();
    const first = captures[0];
    if (first === undefined || first.projectId !== this.activeProjectId) return null;
    return this.sessionForGroup(captures);
  }

  // The project the workspace opens on, creating nothing.
public ensureSelection(): Project {
  const active = this.activeProject();
  if (active !== null) {
    if (this.activeCaptureId === null) this.selectDefaultCapture(active.id);
    return active;
  }
  const demo = [...this.projects.values()].find((p) => p.demo);
  if (demo !== undefined) {
    this.activeProjectId = demo.id;
    this.selectDefaultCapture(demo.id);
    return demo;
  }
  return this.seedDemoProject(
    process.env['DEMO_PROJECT_NAME'] ?? 'North Core Construction',
    process.env['DEMO_PROJECT_LOCATION'] ?? 'Dusk Survey, level 02',
  );
}

// Seed the store with one demo project holding the generated fixtures.
  public seedDemoProject(name: string, location: string): Project {
    const created = this.create({ name, location });
    if (!created.ok) throw new Error(`cannot seed demo project: ${created.message}`);
    this.projects.set(created.value.id, { ...created.value, demo: true });
    for (const capture of demoCaptures()) {
      this.addCapture({
        id: capture.id,
        label: capture.label,
        bytes: capture.bytes,
        mediaType: capture.mediaType,
        dimensions: capture.dimensions,
        content: capture.content,
        source: 'DEMO_FIXTURE',
      });
    }
    return created.value;
  }

  // durable state

  // Write the workspace to disk.
  public persist(): void {
    const store = this.persistence;
    if (store === null) return;

    const captures: PersistedCapture[] = [];
    for (const capture of this.captures.values()) {
      if (capture.source === 'DEMO_FIXTURE') continue;
      let bytesPath = capture.bytesPath;
      if (bytesPath === null && capture.source === 'UPLOAD') {
        const written = store.saveUpload(
          capture.id,
          capture.mediaType === 'image/png' ? '.png' : '.jpg',
          capture.bytes,
        );
        bytesPath = written;
        if (written !== null) {
          this.captures.set(capture.id, { ...capture, bytesPath: written });
        }
      }
      // A dataset capture with no recorded path is referenced by its filename, which is resolved against the dataset directory on restore.
      captures.push({
        id: capture.id,
        projectId: capture.projectId,
        label: capture.label,
        content: capture.content,
        mediaType: capture.mediaType,
        width: capture.dimensions.width,
        height: capture.dimensions.height,
        byteLength: capture.bytes.length,
        source: capture.source,
        zoneId: capture.zoneId,
        createdAt: capture.createdAt,
        bytesPath: bytesPath ?? '',
        relativeToDataset: capture.source === 'LOCAL_DATASET',
        exifOrientation: capture.exifOrientation,
        geometryNormalized: capture.geometryNormalized,
      });
    }

    const references = [...this.references.entries()].map(([projectId, reference]) => ({
      projectId,
      presetId: reference.presetId,
      edited: reference.edited,
      items: reference.state.items,
      zone: reference.state.zone,
    }));

    store.saveWorkspace({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      activeProjectId: this.activeProjectId,
      activeCaptureId: this.activeCaptureId,
      // The whole selection, so a consolidated inspection reopens intact rather than collapsing to its first photograph on restart.
      activeCaptureIds: this.selectedCaptureIds(),
      projects: [...this.projects.values()].filter((p) => p.demo === false),
      captures,
      references,
      // Operator presets only. System presets are code and are always rebuilt.
      presets: this.presets
        .list()
        .filter((p) => p.source === 'OPERATOR')
        .map((p) => ({
          id: p.id,
          name: p.name,
          zone: p.zone,
          items: p.items,
          createdAt: new Date().toISOString(),
        })),
    });
  }

  // Persist one capture's inspection result and human decisions.
  public persistInspection(captureId: string): boolean {
    const store = this.persistence;
    const session = this.sessions.get(captureId);
    if (store === null) return true;
    if (session === undefined) return false;
    const payload = session.getPersistedPayload();
    if (payload === null) return false;

    const view = session.view();
    const reasoning = session.getReasoningOutcome();
    // Per-image payloads for a consolidated inspection, so a restored inspection can still say WHICH photograph produced.
    const payloads = session.getPersistedPayloads();
    const observationIds = session.getPersistedObservationIds();
    const observationReviews = session.getObservationReviewRecords();
    const ledgerFindings = session.getLedgerFindings();
    return store.saveInspection({
      captureId,
      savedAt: new Date().toISOString(),
      inspectedAt: view.provenance.inspectedAt,
      provider: view.provenance.provider,
      model: view.provenance.model,
      inferenceOrigin: view.inferenceOrigin,
      originalInferenceAt: view.originalInferenceAt,
      originalLatencyMs: view.originalLatencyMs,
      observationIds,
      payload,
      ...(payloads.length > 1 ? { payloads } : {}),
      reviews: session.getReviewRecords(),
      observationReviews,
      ledgerFindings,
      // The reference this result was judged against.
      referencePresetId: session.project === null
        ? null
        : this.references.get(session.project)?.presetId ?? null,
      reasoning:
        reasoning === null
          ? null
          : reasoning.status === 'AVAILABLE'
            ? {
                status: reasoning.status,
                kind: null,
                message: null,
                model: reasoning.provenance.model,
                reasoning: reasoning.reasoning,
              }
            : {
                status: reasoning.status,
                kind: reasoning.kind,
                message: reasoning.message,
                // No model: an unavailable stage produced no output to attribute.
                model: null,
                reasoning: null,
              },
    });
  }

  // Restore projects, captures and references from disk.
  public restore(): {
    readonly projects: number;
    readonly captures: number;
    readonly skippedCaptures: number;
  } {
    const store = this.persistence;
    if (store === null) return { projects: 0, captures: 0, skippedCaptures: 0 };

    const state = store.loadWorkspace();
    if (state === null) return { projects: 0, captures: 0, skippedCaptures: 0 };

    for (const preset of state.presets) {
      const created = this.presets.create({
        name: preset.name,
        zone: preset.zone,
        items: preset.items,
      });
      // Ids are regenerated rather than trusted, so a tampered state file cannot collide with a system preset id or redirect.
      if (created.ok) void created;
    }

    const demoIds = new Set(
      [...this.projects.values()].filter((p) => p.demo).map((p) => p.id),
    );
    let restoredProjects = 0;
    let restoredCaptures = 0;
    let skippedCaptures = 0;

    for (const project of state.projects) {
      if (demoIds.has(project.id)) continue;
      const reviewer = typeof (project as any).reviewer === 'object' && (project as any).reviewer !== null && typeof (project as any).reviewer.name === 'string'
        ? {
            name: String((project as any).reviewer.name).trim(),
            role: typeof (project as any).reviewer.role === 'string' && (project as any).reviewer.role.trim().length > 0
              ? String((project as any).reviewer.role).trim()
              : null,
          }
        : null;
      this.projects.set(project.id, {
        id: project.id,
        name: project.name,
        location: project.location,
        createdAt: project.createdAt,
        demo: false,
        reviewer,
      });
      this.referenceFor(project.id);
      restoredProjects += 1;
    }

    for (const record of state.references) {
      if (!this.projects.has(record.projectId)) continue;
      const preset = this.presets.get(record.presetId);
      // An EDITED reference must be restored from the record's own items.
      const restored: ExpectedState = record.edited
        ? { zone: record.zone, source: 'OPERATOR', items: record.items as ExpectedState['items'] }
        : preset !== null
          ? presetToState(preset)
          : { zone: record.zone, source: 'OPERATOR', items: record.items as ExpectedState['items'] };
      this.references.set(record.projectId, {
        presetId: record.presetId,
        state: restored,
        edited: record.edited,
      });
    }

    // Active project first, so restored captures attach to a live project.
    if (state.activeProjectId !== null && this.projects.has(state.activeProjectId)) {
      this.activeProjectId = state.activeProjectId;
    }

    for (const record of state.captures) {
      if (!this.projects.has(record.projectId)) {
        skippedCaptures += 1;
        continue;
      }
      const bytes = store.resolveCaptureBytes(record);
      if (bytes === null || bytes.length === 0) {
        skippedCaptures += 1;
        continue;
      }
      // Dimensions are re-read from the restored bytes rather than trusted from the file, so a truncated upload cannot.
      const capture: ProjectCapture = {
        id: record.id,
        label: record.label,
        bytes,
        mediaType: record.mediaType,
        dimensions: { width: record.width, height: record.height },
        content: record.content,
        projectId: record.projectId,
        source: record.source,
        zoneId: record.zoneId,
        createdAt: record.createdAt,
        exifOrientation: record.exifOrientation ?? 1,
        geometryNormalized: record.geometryNormalized ?? false,
        bytesPath: record.bytesPath,
        bytesRelativeToDataset: record.relativeToDataset,
      };
      this.captures.set(capture.id, capture);
      restoredCaptures += 1;
    }

    // Reopen the inspection the operator last had open, when it survived.
    const wantedGroup = (
      state.activeCaptureIds !== undefined && state.activeCaptureIds.length > 0
        ? state.activeCaptureIds
        : state.activeCaptureId === null
          ? []
          : [state.activeCaptureId]
    ).filter(
      (id) => this.captures.has(id)
        && this.captures.get(id)?.projectId === this.activeProjectId,
    );

    if (wantedGroup.length > 0) {
      this.selectCaptureGroup(wantedGroup);
    } else if (this.activeProjectId !== null) {
      this.selectDefaultCapture(this.activeProjectId);
    }

    return { projects: restoredProjects, captures: restoredCaptures, skippedCaptures };
  }
}
