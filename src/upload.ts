/**
 * Uploaded captures.
 *
 * Holds image bytes supplied by the operator for the life of the process and
 * wraps them in the same DemoCapture shape the generated fixtures use, so the
 * inspection path is identical for an uploaded photograph and a synthetic
 * scene. No file ever touches disk.
 *
 * Validation happens before storage: a capture is accepted only when it is
 * genuinely a PNG or JPEG whose header yields real dimensions, so an unreadable
 * capture can never reach the provider.
 */

import { randomUUID } from 'node:crypto';
import { readImageDimensions } from './image-metadata.ts';
import type { DemoCapture } from './captures.ts';

/** Formats the provider accepts and the header parser can read. */
export const ACCEPTED_MEDIA_TYPES = ['image/png', 'image/jpeg'] as const;
export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number];

/**
 * 12 MB ceiling. A site photograph is comfortably inside this; anything larger
 * is refused before it is buffered further, so a hostile upload cannot exhaust
 * memory. The limit is surfaced to the browser rather than guessed at.
 */
export const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

export type CaptureRejectionReason =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'UNREADABLE_HEADER';

export type CaptureUploadResult =
  | { readonly ok: true; readonly capture: DemoCapture }
  | { readonly ok: false; readonly reason: CaptureRejectionReason; readonly message: string };

export interface CaptureUploadInput {
  readonly bytes: Buffer;
  readonly filename: string;
  /** Declared by the client; never trusted on its own. */
  readonly declaredMediaType?: string | undefined;
}

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, AcceptedMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Decide the media type from the extension, falling back to what the client
 * declared. The declared type is only accepted when it names a real format;
 * readImageDimensions then decides against the actual bytes.
 */
function resolveMediaType(
  filename: string,
  declared: string | undefined,
): AcceptedMediaType | null {
  const byExtension = MEDIA_TYPE_BY_EXTENSION[extensionOf(filename)];
  if (byExtension) return byExtension;
  const declaredLower = declared?.trim().toLowerCase();
  if (
    declaredLower !== undefined &&
    (ACCEPTED_MEDIA_TYPES as readonly string[]).includes(declaredLower)
  ) {
    return declaredLower as AcceptedMediaType;
  }
  return null;
}

/**
 * Validate an upload and, only when it passes, store it.
 *
 * Returns the reason rather than throwing so the interface can explain what to
 * fix, in the product's voice, next to the capture surface.
 */
export function acceptCapture(input: CaptureUploadInput): CaptureUploadResult {
  const { bytes, filename, declaredMediaType } = input;

  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'That file is empty. Choose a photograph of the site to inspect.',
    };
  }
  if (bytes.length > MAX_CAPTURE_BYTES) {
    const mb = (MAX_CAPTURE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      reason: 'TOO_LARGE',
      message: `That capture is larger than ${mb} MB. Reduce it before inspecting.`,
    };
  }

  const mediaType = resolveMediaType(filename, declaredMediaType);
  if (mediaType === null) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
      message: 'Only PNG and JPEG captures can be inspected.',
    };
  }

  // The header is the authority. A renamed file or a truncated upload fails here
  // rather than being stored and later failing inside the provider.
  const dimensions = readImageDimensions(bytes);
  if (dimensions === null) {
    return {
      ok: false,
      reason: 'UNREADABLE_HEADER',
      message: 'That file is not a readable PNG or JPEG image.',
    };
  }

  const label = filename.trim().length > 0 ? filename.trim() : 'uploaded capture';
  return {
    ok: true,
    capture: {
      id: `cap_upload_${randomUUID().slice(0, 8)}`,
      label,
      bytes,
      mediaType,
      dimensions,
      content: `Uploaded by the operator: ${label} (${dimensions.width}x${dimensions.height}).`,
    },
  };
}
