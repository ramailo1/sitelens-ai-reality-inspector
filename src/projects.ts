/**
 * Projects and the captures they own.
 *
 * The active project is real application state, not a label: every capture,
 * expected reference, inspection result and finding is reached through a project,
 * and a capture is only ever readable by the project that owns it.
 *
 * Each capture keeps its own InspectionSession, so re-selecting a capture
 * restores its observations, comparison, findings and human verifications
 * instead of silently re-running the model.
 *
 * State is in memory for the life of the process, matching the existing
 * observation store, finding ledger and result cache. This is a demonstration
 * surface, not a persistence layer.
 */

import { randomUUID } from 'node:crypto';
import type { AIProvider } from './providers/provider.ts';
import type { DemoCapture } from './captures.ts';
import { demoCaptures } from './captures.ts';
import { InspectionSession } from './session.ts';
import { PresetStore, cloneExpectedState, presetToState } from './expected-state.ts';
import { DEFAULT_EXPECTED_PRESET_ID } from './expected-state.ts';
import type { ExpectedState } from './types/inspection.ts';

export const MAX_PROJECT_NAME = 80;
export const MAX_PROJECT_LOCATION = 120;

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly createdAt: string;
  /**
   * True for the generated project the app opens on. It is synthetic demo
   * content, labelled so it can never be mistaken for the operator's own work.
   */
  readonly demo: boolean;
}

export type ProjectSummary = Project & { readonly captureCount: number };

/**
 * A capture owned by exactly one project.
 *
 * Structurally a DemoCapture so it flows through the existing inspection path
 * unchanged; `source` records where the bytes came from so the UI never implies
 * an uploaded photograph is a generated fixture.
 */
export interface ProjectCapture extends DemoCapture {
  readonly projectId: string;
  readonly source: 'UPLOAD' | 'DEMO_FIXTURE';
  readonly zoneId: string | null;
  readonly createdAt: string;
}

/**
 * A project's comparison reference: which preset it uses, plus any operator
 * edits applied to it.
 *
 * `edited` distinguishes a pristine preset from one an operator has changed, so
 * a comparison can always be traced back to a named, unchanging definition.
 */
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

/** Trim and validate an operator-supplied project name. */
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
  private readonly zoneId: string | null;
  private readonly projects = new Map<string, Project>();
  private readonly captures = new Map<string, ProjectCapture>();
  private readonly sessions = new Map<string, InspectionSession>();
  private readonly references = new Map<string, ProjectReference>();
  /** The reference catalogue. Shared by every project; never mutated per project. */
  public readonly presets: PresetStore;
  private activeProjectId: string | null = null;
  private activeCaptureId: string | null = null;

  public constructor(options: { readonly provider: AIProvider; readonly zoneId: string | null; readonly presets?: PresetStore }) {
    this.provider = options.provider;
    this.zoneId = options.zoneId;
    this.presets = options.presets ?? new PresetStore();
  }

  public activeProject(): Project | null {
    return this.activeProjectId === null ? null : (this.projects.get(this.activeProjectId) ?? null);
  }

  /** Whether a project id is still known, regardless of which one is active. */
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

  /** Capture by id, but only when the active project owns it. */
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
    };
    this.projects.set(project.id, project);
    this.referenceFor(project.id);
    // A new project becomes active immediately and starts genuinely empty: it
    // inherits no captures and no reference from any other project.
    this.activeProjectId = project.id;
    this.activeCaptureId = null;
    return { ok: true, value: project };
  }

  public rename(projectId: string, rawName: unknown): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    const name = cleanProjectName(rawName);
    if (!name.ok) return name;
    const updated: Project = { ...project, name: name.value };
    this.projects.set(projectId, updated);
    return { ok: true, value: updated };
  }

  public setLocation(projectId: string, rawLocation: unknown): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    const location = cleanLocation(rawLocation);
    if (!location.ok) return location;
    const updated: Project = { ...project, location: location.value };
    this.projects.set(projectId, updated);
    return { ok: true, value: updated };
  }

  /** Switch the active project. Nothing from the previous project stays selected. */
  public switchTo(projectId: string): ProjectResult<Project> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');
    this.activeProjectId = projectId;
    this.selectDefaultCapture(projectId);
    return { ok: true, value: project };
  }

  /**
   * Select the capture a project should open on.
   *
   * Preferring the newest INSPECTED capture is what makes returning to a project
   * land on its last inspection rather than on a freshly uploaded photograph
   * that has never been through the model. Selecting by recency alone put the
   * operator back on an un-inspected capture with an empty evidence stage, and
   * their previous findings and verifications were nowhere on screen.
   *
   * A project with nothing inspected yet falls back to its newest capture, and a
   * project with no captures stays empty on purpose rather than borrowing
   * another project's image.
   */
  public selectDefaultCapture(projectId: string): string | null {
    const captures = this.capturesOf(projectId);
    const inspected = captures.filter((c) => this.sessions.get(c.id)?.inspected() === true);
    const pool = inspected.length > 0 ? inspected : captures;
    const last = pool.length > 0 ? pool[pool.length - 1] : undefined;
    this.activeCaptureId = last === undefined ? null : last.id;
    return this.activeCaptureId;
  }

  /**
   * Delete a project and everything it owns.
   *
   * A single pass over this project's captures drops the image bytes and the
   * session, and therefore every observation, finding and verification that
   * belonged to it. Other projects are untouched, and the active selection falls
   * back to a surviving project or to the empty-project state.
   */
  public delete(
    projectId: string,
  ): ProjectResult<{ readonly deleted: Project; readonly activeProjectId: string | null }> {
    const project = this.projects.get(projectId);
    if (!project) return fail('UNKNOWN_PROJECT', 'That project no longer exists.');

    for (const capture of this.capturesOf(projectId)) {
      this.captures.delete(capture.id);
      this.sessions.delete(capture.id);
    }
    this.references.delete(projectId);
    this.projects.delete(projectId);

    if (this.activeProjectId === projectId) {
      this.activeProjectId = this.list()[0]?.id ?? null;
      if (this.activeProjectId !== null) this.selectDefaultCapture(this.activeProjectId);
      else this.activeCaptureId = null;
    }
    return { ok: true, value: { deleted: project, activeProjectId: this.activeProjectId } };
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
    };
    this.captures.set(stored.id, stored);
    return stored;
  }

  /**
   * Delete a capture owned by the active project.
   *
   * The session goes with it, so its observations, findings and verifications are
   * gone rather than merely hidden.
   */
  public deleteCapture(
    captureId: string,
  ): ProjectResult<{ readonly deleted: ProjectCapture; readonly activeCaptureId: string | null }> {
    const owned = this.activeCapture(captureId);
    if (!owned.ok) return owned;

    this.captures.delete(captureId);
    this.sessions.delete(captureId);

    if (this.activeCaptureId === captureId) {
      // The deleted capture's result went with it, so the fallback follows the
      // same rule as entering a project: prefer something already inspected.
      const remaining = this.capturesOf(owned.value.projectId);
      const inspected = remaining.filter((c) => this.sessions.get(c.id)?.inspected() === true);
      const pool = inspected.length > 0 ? inspected : remaining;
      const last = pool.length > 0 ? pool[pool.length - 1] : undefined;
      this.activeCaptureId = last === undefined ? null : last.id;
    }
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
    return { ...seeded, state: cloneExpectedState(seeded.state) };
  }

  public expectedFor(projectId: string): ExpectedState {
    return this.referenceFor(projectId).state;
  }

  /**
   * Point a project at a preset.
   *
   * Any session that already produced a comparison is marked stale, because its
   * rows were computed against the previous reference. Silently keeping those
   * rows on screen would attribute them to a preset that never produced them.
   */
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
    return { ok: true, value: { ...reference, state: cloneExpectedState(reference.state) } };
  }

  /** Record operator edits against the project's own copy of the reference. */
  public setReferenceState(projectId: string, state: ExpectedState): ProjectReference {
    const current = this.referenceFor(projectId);
    const reference: ProjectReference = { ...current, state, edited: true };
    this.references.set(projectId, reference);
    this.markStale(projectId);
    return { ...reference, state: cloneExpectedState(state) };
  }

  /** Push a project's reference into its sessions, dropping results it invalidates. */
  private markStale(projectId: string): void {
    const reference = this.referenceFor(projectId);
    for (const capture of this.capturesOf(projectId)) {
      this.sessions.get(capture.id)?.adoptReference(reference.state);
    }
  }

  /** Session for a capture, created on first use and reused afterwards. */
  public sessionFor(capture: ProjectCapture): InspectionSession {
    const existing = this.sessions.get(capture.id);
    if (existing) return existing;
    const created = new InspectionSession(
      this.provider,
      capture,
      capture.projectId,
      capture.zoneId,
      this.expectedFor(capture.projectId),
    );
    this.sessions.set(capture.id, created);
    return created;
  }

  public selectCapture(captureId: string): ProjectResult<InspectionSession> {
    const owned = this.activeCapture(captureId);
    if (!owned.ok) return owned;
    this.activeCaptureId = captureId;
    return { ok: true, value: this.sessionFor(owned.value) };
  }

  public activeSession(): InspectionSession | null {
    if (this.activeCaptureId === null) return null;
    const capture = this.captures.get(this.activeCaptureId);
    // The capture may have been selected by switching projects rather than by an
    // explicit selectCapture, so the session is resolved here. Returning null
    // instead would leave a restored project showing no inspection at all.
    if (!capture || capture.projectId !== this.activeProjectId) return null;
    return this.sessionFor(capture);
  }

  /**
   * Seed the store with one demo project holding the generated fixtures.
   *
   * These are the repository's existing synthetic scenes, labelled as fixtures
   * throughout; they are not invented data dressed up as project content.
   */
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
}
