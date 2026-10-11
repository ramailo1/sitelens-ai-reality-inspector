// Local file-backed persistence.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { datasetDirectory } from './dataset.ts';
import { normalizeOrientation } from './image-metadata.ts';

export const DEFAULT_DATA_DIR = 'data';

// Bumped when the on-disk shape changes so an old file is ignored, not misread.
export const PERSISTENCE_SCHEMA_VERSION = 1;

// Ceiling on the JSON we are willing to read back, so a corrupt file cannot exhaust memory.
const MAX_STATE_BYTES = 64 * 1024 * 1024;

// Per-capture inspection record. Raw provider payload plus human decisions.
export interface PersistedInspection {
  readonly captureId: string;
  readonly savedAt: string;
  readonly inspectedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly inferenceOrigin: string;
  readonly originalInferenceAt: string | null;
  readonly originalLatencyMs: number | null;
  // Exactly what the provider returned, unvalidated: re-validated on read.
  readonly payload: {
    readonly observations: readonly unknown[];
    readonly elements: readonly unknown[];
    readonly findings: readonly unknown[];
  };
  // Per-image payloads for a consolidated inspection.
  readonly payloads?: readonly {
    readonly captureId: string;
    readonly captureLabel: string;
    readonly observationIds?: readonly string[] | undefined;
    readonly payload: {
      readonly observations: readonly unknown[];
      readonly elements: readonly unknown[];
      readonly findings: readonly unknown[];
    };
  }[] | undefined;
  // Original observation ids aligned with the primary payload's observations.
  readonly observationIds?: readonly string[] | undefined;
  // Human decisions, keyed by the finding's stable content key.
  readonly reviews: readonly {
    readonly key: string;
    readonly status: string;
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly note: string | null;
  }[];
  // Human decisions on raw AI observations, keyed by observation id and stable content key.
  readonly observationReviews?: readonly {
    readonly observationId: string;
    readonly key: string;
    readonly status: string;
    readonly reviewer: string;
    readonly reviewedAt: string;
    readonly note: string | null;
  }[] | undefined;
  // Human-verified actionable findings in the session ledger, including triage state.
  readonly ledgerFindings?: readonly {
    readonly id: string;
    readonly sourceObservationId: string;
    readonly captureId: string;
    readonly projectId: string | null;
    readonly zoneId: string | null;
    readonly category: string;
    readonly summary: string;
    readonly evidenceDescription: string;
    readonly suggestedAction: string;
    readonly severity: string;
    readonly raisedBy: string;
    readonly raisedAt: string;
    readonly state: string;
    readonly target: string;
  }[] | undefined;
  // The comparison reference this inspection was judged against.
  readonly referencePresetId?: string | null | undefined;
  // Reasoning provenance, so a restored result is not credited to a model that did not run.
  readonly reasoning: {
    readonly status: string;
    readonly kind: string | null;
    readonly message: string | null;
    readonly model: string | null;
    readonly reasoning: unknown;
  } | null;
}

// A capture's metadata. Bytes are referenced, never inlined.
export interface PersistedCapture {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly content: string;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly source: 'UPLOAD' | 'DEMO_FIXTURE' | 'LOCAL_DATASET';
  readonly zoneId: string | null;
  readonly createdAt: string;
  // Absolute path for an upload on disk, or a dataset path relative to the dataset dir.
  readonly bytesPath: string;
  // True when bytesPath is relative to the dataset directory.
  readonly relativeToDataset: boolean;
  readonly exifOrientation: number | null;
  readonly geometryNormalized: boolean;
}

// Operator-authored expected-state references. System presets are not persisted.
export interface PersistedPreset {
  readonly id: string;
  readonly name: string;
  readonly zone: string;
  readonly items: readonly unknown[];
  readonly createdAt: string;
}

export interface PersistedWorkspace {
  readonly schemaVersion: number;
  readonly savedAt: string;
  readonly activeProjectId: string | null;
  readonly activeCaptureId: string | null;
  // The ordered photographs of the open inspection group.
  readonly activeCaptureIds?: readonly string[] | undefined;
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    readonly createdAt: string;
    readonly demo: boolean;
    readonly reviewer?: { readonly name: string; readonly role: string | null } | null;
  }[];
  readonly captures: readonly PersistedCapture[];
  readonly references: readonly {
    readonly projectId: string;
    readonly presetId: string;
    readonly edited: boolean;
    readonly items: readonly unknown[];
    readonly zone: string;
  }[];
  readonly presets: readonly PersistedPreset[];
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Small, honest, atomic JSON persistence.
export class WorkspacePersistence {
  public readonly directory: string;
  // Absolute, because the API and the UI must be able to state where data lives.
  public readonly location: string;
  public readonly durable = true;

  private readonly datasetDirectory: string | null;

  public constructor(options: {
    readonly directory?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {}) {
    const env = options.env ?? process.env;
    // Precedence: an explicit option, then the environment, then the default.
    const explicit = typeof options.directory === 'string' && options.directory.trim().length > 0
      ? options.directory.trim()
      : null;
    const configured = env['SITELENS_DATA_DIR'];
    const fromEnv = configured !== undefined && configured.trim().length > 0
      ? configured.trim()
      : null;
    const raw = explicit ?? fromEnv ?? DEFAULT_DATA_DIR;
    this.directory = resolve(process.cwd(), raw);
    this.location = this.directory;
    // Resolved through the DATASET module rather than reimplemented here.
    this.datasetDirectory = datasetDirectory(env);
  }

  private get workspaceFile(): string {
    return join(this.directory, 'workspace.json');
  }

  private get inspectionsDir(): string {
    return join(this.directory, 'inspections');
  }

  private get uploadsDir(): string {
    return join(this.directory, 'uploads');
  }

  // Statement shown wherever the UI currently reports storage truth.
  public describe(): { location: string; durable: boolean; detail: string } {
    return {
      location: this.directory,
      durable: true,
      detail:
        'Projects, captures, inspection results and human verifications are written to this '
        + 'directory and reloaded on start. Image bytes are stored once as files and referenced '
        + 'by path, never inlined into the JSON. The AI result cache is NOT persisted, so a '
        + 'restored result always shows the time of the inference that produced it.',
    };
  }

  private ensureDir(path: string): void {
    try {
      mkdirSync(path, { recursive: true });
    } catch {
      // A read-only working directory must not take the server down.
    }
  }

  private writeAtomic(path: string, contents: string): void {
    this.ensureDir(dirname(path));
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, contents, 'utf8');
    renameSync(tmp, path);
  }

  private readJson(path: string): unknown {
    try {
      if (!existsSync(path)) return null;
      const stat = readFileSync(path);
      if (stat.length > MAX_STATE_BYTES) return null;
      return JSON.parse(stat.toString('utf8')) as unknown;
    } catch {
      // A corrupt or unreadable state file is treated as absent.
      return null;
    }
  }

  public saveWorkspace(state: PersistedWorkspace): boolean {
    try {
      this.writeAtomic(this.workspaceFile, JSON.stringify(state, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  public loadWorkspace(): PersistedWorkspace | null {
    const raw = this.readJson(this.workspaceFile);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (record['schemaVersion'] !== PERSISTENCE_SCHEMA_VERSION) return null;
    if (!Array.isArray(record['projects']) || !Array.isArray(record['captures'])) return null;
    return {
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      savedAt: typeof record['savedAt'] === 'string' ? record['savedAt'] : new Date().toISOString(),
      activeProjectId: readStringOrNull(record['activeProjectId']),
      activeCaptureId: readStringOrNull(record['activeCaptureId']),
      // An older file has no group; its single active capture IS the group.
      activeCaptureIds: Array.isArray(record['activeCaptureIds'])
        ? (record['activeCaptureIds'] as string[])
        : undefined,
      projects: (record['projects'] as any[]).map((p) => ({
        id: String(p.id),
        name: String(p.name),
        location: typeof p.location === 'string' ? p.location : '',
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        demo: p.demo === true,
        reviewer:
          typeof p.reviewer === 'object' && p.reviewer !== null && typeof p.reviewer.name === 'string'
            ? {
                name: String(p.reviewer.name).trim(),
                role: typeof p.reviewer.role === 'string' && p.reviewer.role.trim().length > 0
                  ? String(p.reviewer.role).trim()
                  : null,
              }
            : null,
      })),
      captures: record['captures'] as PersistedCapture[],
      references: Array.isArray(record['references'])
        ? (record['references'] as PersistedWorkspace['references'])
        : [],
      presets: Array.isArray(record['presets'])
        ? (record['presets'] as PersistedPreset[])
        : [],
    };
  }

  public inspectionFile(captureId: string): string {
    // Capture ids and group keys (`grp_id1+id2`) are generated internally.
    const safe = /^[A-Za-z0-9_+-]+$/.test(captureId) ? captureId : 'unknown';
    return join(this.inspectionsDir, `${safe}.json`);
  }

  public saveInspection(record: PersistedInspection): boolean {
    try {
      this.writeAtomic(this.inspectionFile(record.captureId), JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }

  public loadInspection(captureId: string): PersistedInspection | null {
    const raw = this.readJson(this.inspectionFile(captureId));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const payload = record['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    return {
      captureId,
      savedAt: typeof record['savedAt'] === 'string' ? record['savedAt'] : new Date().toISOString(),
      inspectedAt: typeof record['inspectedAt'] === 'string' ? record['inspectedAt'] : new Date().toISOString(),
      provider: typeof record['provider'] === 'string' ? record['provider'] : 'unknown',
      model: typeof record['model'] === 'string' ? record['model'] : 'unknown',
      inferenceOrigin:
        typeof record['inferenceOrigin'] === 'string' ? record['inferenceOrigin'] : 'FRESH',
      originalInferenceAt: readStringOrNull(record['originalInferenceAt']),
      originalLatencyMs:
        typeof record['originalLatencyMs'] === 'number' ? record['originalLatencyMs'] : null,
      payload: payload as PersistedInspection['payload'],
      // Absent on a single-image record, which is exactly how the reader knows to use the merged payload instead.
      ...(Array.isArray(record['payloads'])
        ? { payloads: record['payloads'] as PersistedInspection['payloads'] }
        : {}),
      ...(Array.isArray(record['observationIds'])
        ? { observationIds: record['observationIds'] as PersistedInspection['observationIds'] }
        : {}),
      reviews: Array.isArray(record['reviews'])
        ? (record['reviews'] as PersistedInspection['reviews'])
        : [],
      ...(Array.isArray(record['observationReviews'])
        ? { observationReviews: record['observationReviews'] as PersistedInspection['observationReviews'] }
        : {}),
      ...(Array.isArray(record['ledgerFindings'])
        ? { ledgerFindings: record['ledgerFindings'] as PersistedInspection['ledgerFindings'] }
        : {}),
      // Read as `undefined` when absent, so an old record is distinguishable from one that genuinely stamped a null reference.
      ...('referencePresetId' in record
        ? { referencePresetId: readStringOrNull(record['referencePresetId']) }
        : {}),
      reasoning:
        typeof record['reasoning'] === 'object' && record['reasoning'] !== null
          ? (record['reasoning'] as PersistedInspection['reasoning'])
          : null,
    };
  }

  public deleteInspection(captureId: string): void {
    try {
      rmSync(this.inspectionFile(captureId), { force: true });
    } catch {
      // Nothing to do: a leftover file is inert and overwritten on next save.
    }
    try {
      if (!existsSync(this.inspectionsDir)) return;
      for (const entry of readdirSync(this.inspectionsDir)) {
        if (!entry.startsWith('grp_') || !entry.endsWith('.json')) continue;
        const key = entry.slice(0, -5);
        const members = key.slice(4).split('+');
        if (members.includes(captureId)) {
          rmSync(join(this.inspectionsDir, entry), { force: true });
        }
      }
    } catch {
      // Best-effort cleanup of consolidated group files referencing this capture.
    }
  }

  // Write uploaded bytes to disk and return the absolute path to record.
  public saveUpload(captureId: string, extension: string, bytes: Buffer): string | null {
    const safeId = /^[A-Za-z0-9_-]+$/.test(captureId) ? captureId : 'capture';
    const safeExt = extension === '.png' ? '.png' : '.jpg';
    const path = join(this.uploadsDir, `${safeId}${safeExt}`);
    try {
      this.ensureDir(this.uploadsDir);
      writeFileSync(path, bytes);
      return path;
    } catch {
      return null;
    }
  }

  public deleteUpload(path: string): void {
    // Only ever removes a file inside this instance's own uploads directory.
    if (!isAbsolute(path)) return;
    const rel = relative(this.uploadsDir, path);
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    try {
      rmSync(path, { force: true });
    } catch {
      // Best effort; the capture record is what governs ownership.
    }
  }

  // Resolve a persisted capture's bytes back into memory on startup.
  public resolveCaptureBytes(capture: PersistedCapture): Buffer | null {
    try {
      const path = capture.relativeToDataset
        ? this.resolveDatasetPath(capture.bytesPath)
        : capture.bytesPath;
      if (path === null) return null;
      return normalizeOrientation(readFileSync(path));
    } catch {
      return null;
    }
  }

  private resolveDatasetPath(relativePath: string): string | null {
    // Defence in depth: a relative path that escapes the dataset directory is refused rather than resolved, so a tampered.
    const rel = relativePath.replace(/\\/g, '/');
    if (rel.startsWith('..') || isAbsolute(relativePath)) return null;
    const base = this.datasetDirectory;
    if (base === null) return null;
    const joined = resolve(join(base, rel));
    const relToBase = relative(base, joined);
    if (relToBase.startsWith('..') || isAbsolute(relToBase)) return null;
    return joined;
  }
}