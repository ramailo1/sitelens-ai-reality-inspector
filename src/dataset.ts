/**
 * The local validation dataset.
 *
 * `sample/` holds 38 genuine, licence-clean photographs of real construction
 * work. It is deliberately NOT tracked by git (~107.5 MB) and it has never
 * existed in any commit. Nothing in this repository depends on it, and this
 * module is the only thing that ever reads it.
 *
 * The point of importing one of these images is that the demo then runs on REAL
 * construction reality rather than a synthetic scene pretending to be a
 * capture. That only stays honest if the provenance is impossible to misread,
 * so an imported dataset image is structurally distinct from an upload:
 *
 *     source: 'LOCAL_DATASET'
 *
 * and the UI is required to render that as LOCAL DATASET. It was not captured
 * on this project's site by this application, and the product never says it was.
 *
 * Bytes are read at import time and normalized (see image-metadata.ts) so the
 * stored pixels, the pixels the model sees and the pixels the browser paints are
 * one array. The original EXIF orientation is recorded and shown, because
 * silently re-orienting a photograph is exactly the kind of quiet change this
 * product does not make.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readImageGeometry, normalizeOrientation } from './image-metadata.ts';
import type { ImageGeometry } from './image-metadata.ts';
import { MAX_PROVIDER_IMAGE_BYTES } from './providers/nebius-nvidia.provider.ts';

/** Default location, relative to the repository root. */
export const DEFAULT_DATASET_DIR = 'sample';

/** What a dataset image actually is, stated once and reused everywhere. */
export const LOCAL_DATASET_LABEL = 'LOCAL DATASET' as const;

const DATASET_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const;

/**
 * One discovered dataset image.
 *
 * `id` is derived from the filename prefix (`021` from
 * `021-exterior-rebar-welding-track-a-approach.jpg`) rather than generated, so
 * the same file always has the same identity across restarts and a judge can be
 * told "capture 021" and have that mean something checkable.
 */
export interface DatasetEntry {
  readonly id: string;
  readonly filename: string;
  /** Human title parsed from the filename, e.g. "exterior rebar welding track a approach". */
  readonly title: string;
  readonly byteLength: number;
  /** True for the images the dataset documentation calls out as the strongest picks. */
  readonly hero: boolean;
  /** EXIF orientation found in the original file, before normalization. */
  readonly exifOrientation: number;
  /** True when the file's pixels were re-oriented, or already needed no change. */
  readonly geometryNormalized: boolean;
  readonly width: number;
  readonly height: number;
  readonly mediaType: 'image/jpeg' | 'image/png';
  /**
   * False when the file is larger than the measured model-endpoint ceiling.
   * Reported so the browser can show it as unavailable rather than letting an
   * operator pick an image that is certain to fail at inference.
   */
  readonly inspectable: boolean;
}

export interface DatasetIndex {
  readonly directory: string;
  readonly present: boolean;
  readonly entries: readonly DatasetEntry[];
  /** Count of files that looked like images but could not be used. */
  readonly unreadable: number;
  /** The honest statement shown in the UI next to the dataset browser. */
  readonly note: string;
}

/** Images the dataset documentation names as the strongest general-purpose picks. */
const HERO_IDS = new Set(['021', '022', '030']);

/** Directory the dataset lives in, resolved from the environment or the default. */
export function datasetDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['SITELENS_DATASET_DIR'];
  const raw = configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_DATASET_DIR;
  return resolve(process.cwd(), raw);
}

function parseFilename(filename: string): { id: string; title: string } | null {
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  const match = /^(\d{3})[-_](.+)$/.exec(stem);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const title = match[2].split(/[-_]+/).filter(Boolean).join(' ');
  return { id: match[1], title: title.length > 0 ? title : stem };
}

function mediaTypeFor(filename: string): 'image/jpeg' | 'image/png' {
  const lower = filename.toLowerCase();
  return lower.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * Discover the dataset on disk.
 *
 * Never throws for a missing directory: the product must run perfectly well
 * without it, and an absent dataset is reported as absent rather than as an
 * error the operator has to interpret. Files whose header cannot be read are
 * counted and skipped, because a broken file in a local folder must not stop
 * the other 37 from loading.
 */
export function readDatasetIndex(env: NodeJS.ProcessEnv = process.env): DatasetIndex {
  const directory = datasetDirectory(env);
  const note =
    `Local validation dataset at ${directory}. These are genuine photographs of real `
    + 'construction work held on this machine only: not tracked by git, not uploaded by this '
    + 'application, and not captured on this project’s site. Importing one makes it a real '
    + 'input to a real inspection; it does not make it project evidence.';

  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return {
      directory,
      present: false,
      entries: [],
      unreadable: 0,
      note:
        `No local dataset found at ${directory}. The application runs without it: drop a `
        + 'photograph above, or use the synthetic demo capture. See sample/README.md for how to '
        + 'obtain the licence-clean dataset.',
    };
  }

  const entries: DatasetEntry[] = [];
  let unreadable = 0;

  for (const name of names.sort()) {
    const lower = name.toLowerCase();
    if (!(DATASET_EXTENSIONS as readonly string[]).some((ext) => lower.endsWith(ext))) continue;

    const parsed = parseFilename(name);
    if (parsed === null) continue;

    let byteLength: number;
    try {
      byteLength = statSync(join(directory, name)).size;
    } catch {
      unreadable += 1;
      continue;
    }

    let geometry: ImageGeometry | null;
    try {
      geometry = readImageGeometry(readFileSync(join(directory, name)));
    } catch {
      geometry = null;
    }
    if (geometry === null) {
      unreadable += 1;
      continue;
    }

    entries.push({
      id: parsed.id,
      filename: name,
      title: parsed.title,
      byteLength,
      hero: HERO_IDS.has(parsed.id),
      // Recorded from the ORIGINAL bytes: it is a fact about the file, and it is
      // what the display would otherwise silently undo.
      exifOrientation: geometry.orientation,
      geometryNormalized: !geometry.normalized,
      // Stored dimensions, because the bytes the application holds have been
      // normalized: they are what is displayed and what the model sees.
      width: geometry.stored.width,
      height: geometry.stored.height,
      mediaType: mediaTypeFor(name),
      inspectable: byteLength <= MAX_PROVIDER_IMAGE_BYTES,
    });
  }

  return { directory, present: true, entries, unreadable, note };
}

export interface DatasetCapture {
  readonly id: string;
  readonly label: string;
  readonly bytes: Buffer;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly content: string;
  /** Geometry facts from the original file, surfaced rather than hidden. */
  readonly exifOrientation: number;
  readonly geometryNormalized: boolean;
}

export type DatasetImportResult =
  | { readonly ok: true; readonly capture: DatasetCapture; readonly entry: DatasetEntry }
  | {
      readonly ok: false;
      readonly reason: 'NOT_FOUND' | 'UNREADABLE' | 'TOO_LARGE';
      readonly message: string;
    };

/**
 * Read one dataset image into a capture, normalizing its orientation.
 *
 * The path is rebuilt from the directory and a validated `NNN` id rather than
 * taken from the request, so no caller can use this to read an arbitrary path on
 * the machine. The id is resolved against the discovered index, which is built
 * from filenames that must themselves match the numeric pattern.
 */
export function importDatasetCapture(
  entryId: string,
  env: NodeJS.ProcessEnv = process.env,
): DatasetImportResult {
  const index = readDatasetIndex(env);
  if (!index.present) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: 'No local dataset is present on this machine, so nothing can be imported from it.',
    };
  }
  const wanted = entryId.trim();
  if (!/^\d{3}$/.test(wanted)) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: 'A dataset image id is three digits, e.g. 021.',
    };
  }
  const entry = index.entries.find((e) => e.id === wanted);
  if (entry === undefined) {
    return {
      ok: false,
      reason: 'NOT_FOUND',
      message: `Dataset image ${wanted} is not in the local dataset.`,
    };
  }

  let original: Buffer;
  try {
    original = readFileSync(join(index.directory, entry.filename));
  } catch {
    return {
      ok: false,
      reason: 'UNREADABLE',
      message: `Dataset image ${entry.id} could not be read from disk.`,
    };
  }

  // ONE geometry for everything downstream. See image-metadata.ts.
  const bytes = normalizeOrientation(original);
  const geometry = readImageGeometry(bytes);
  if (geometry === null) {
    return {
      ok: false,
      reason: 'UNREADABLE',
      message: `Dataset image ${entry.id} has no readable image header.`,
    };
  }

  // Checked at import rather than at inference, so the operator learns a dataset
  // image is too large while choosing it rather than after paying for a request
  // that is certain to fail. The ceiling is measured from the live endpoint.
  if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
    const mb = (MAX_PROVIDER_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      reason: 'TOO_LARGE',
      message:
        `Dataset image ${entry.id} is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB. The model `
        + `endpoint accepts up to ${mb} MB, so this one cannot be inspected. Choose a smaller `
        + 'dataset image, or recompress it first.',
    };
  }

  const label = `${entry.id} — ${entry.title}`;
  const orientationNote =
    entry.geometryNormalized
      ? ` EXIF orientation ${entry.exifOrientation} in the source file; pixels were normalized to `
        + `orientation 1 before inspection so the model, the display and the evidence overlay use `
        + 'one coordinate system.'
      : '';

  return {
    ok: true,
    entry,
    capture: {
      id: `cap_dataset_${entry.id}_${randomUUID().slice(0, 6)}`,
      label,
      bytes,
      mediaType: entry.mediaType,
      dimensions: { width: geometry.stored.width, height: geometry.stored.height },
      content:
        `Local validation dataset image ${entry.filename}. A genuine photograph of real `
        + `construction work (${entry.byteLength} bytes). NOT captured on this project's site.`
        + orientationNote,
      exifOrientation: entry.exifOrientation,
      geometryNormalized: entry.geometryNormalized,
    },
  };
}
