/**
 * Demo capture assets.
 *
 * Deterministic synthetic construction scenes, generated in code so the
 * repository carries no binary imagery and no customer data. Each scene is
 * drawn as simple geometry with clear, checkable content: a reviewer can see
 * what the model was looking at, which is what makes the observations
 * auditable.
 *
 * These are fixtures. They prove the pipeline and the evidence overlay; they are
 * not photographs and are not evidence of real-world accuracy.
 */

import { deflateSync } from 'node:zlib';
import type { ImageDimensions } from './image-metadata.ts';

export interface DemoCapture {
  readonly id: string;
  readonly label: string;
  readonly bytes: Buffer;
  readonly mediaType: string;
  readonly dimensions: ImageDimensions;
  /** What the scene deliberately contains, for documentation and review. */
  readonly content: string;
}

/**
 * CRC-32 (IEEE 802.3), computed directly so PNG chunk integrity does not
 * depend on a Node version-specific zlib export.
 */
const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type Rgb = readonly [number, number, number];

export const PALETTE = {
  SKY_TOP: [150, 195, 240],
  SKY_BOTTOM: [110, 170, 215],
  SOIL: [104, 84, 66],
  GROUND: [124, 118, 108],
  CONCRETE: [176, 174, 168],
  CONCRETE_DARK: [138, 136, 130],
  STEEL: [96, 100, 104],
  REBAR: [148, 96, 58],
  YELLOW: [226, 176, 32],
  GLASS: [58, 92, 130],
  DARK: [42, 42, 46],
  ORANGE: [236, 96, 24],
  WHITE: [230, 230, 232],
  RED: [178, 62, 48],
  BLUE: [44, 78, 138],
  TIMBER: [176, 138, 84],
} as const satisfies Record<string, Rgb>;

export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 240;

/** Sky gradient above a horizon line; null below it. */
export function skyAt(y: number, horizon: number): Rgb | null {
  if (y >= horizon) return null;
  const g = y / horizon;
  return [
    Math.round(PALETTE.SKY_TOP[0] + (PALETTE.SKY_BOTTOM[0] - PALETTE.SKY_TOP[0]) * g),
    Math.round(PALETTE.SKY_TOP[1] + (PALETTE.SKY_BOTTOM[1] - PALETTE.SKY_TOP[1]) * g),
    Math.round(PALETTE.SKY_TOP[2] + (PALETTE.SKY_BOTTOM[2] - PALETTE.SKY_TOP[2]) * g),
  ];
}

export type ScenePainter = (x: number, y: number) => Rgb;

export function buildCapture(
  id: string,
  label: string,
  content: string,
  paint: ScenePainter,
): DemoCapture {
  return {
    id,
    label,
    bytes: encodePng(SCENE_WIDTH, SCENE_HEIGHT, paint),
    mediaType: 'image/png',
    dimensions: { width: SCENE_WIDTH, height: SCENE_HEIGHT },
    content,
  };
}

export function demoCaptures(): DemoCapture[] {
  return [
    buildCapture(
      'cap_concrete_slab',
      'Concrete slab - unfinished',
      'Fresh concrete slab with a column stub, protruding rebar starter bars, stacked formwork panels and site containers.',
      paintConcreteSlab,
    ),
    buildCapture(
      'cap_steel_frame',
      'Steel frame - open edge',
      'Steel frame with columns and beams, an open slab edge with no visible guardrail, a material stack near the base and a safety cone.',
      paintSteelFrame,
    ),
    buildCapture(
      'cap_excavation',
      'Excavation - plant and obstruction',
      'Open excavation with an excavator, its bucket over the pit edge, and a material stack obstructing the working area.',
      paintExcavation,
    ),
    buildCapture(
      'cap_finished_facade',
      'Finished facade - reference condition',
      'Completed facade with regular window openings, an entrance opening and paved foreground, for comparison against incomplete work.',
      paintFinishedFacade,
    ),
  ];
}

export function defaultCapture(): DemoCapture {
  return demoCaptures()[0] as DemoCapture;
}
function paintConcreteSlab(x: number, y: number): Rgb {
  const P = PALETTE;
  const s = skyAt(y, 96);
  if (s) return s;
  if (y - 96 < 12) return P.SOIL;

  if (x >= 244 && x <= 300) {
    if (y - 96 >= 18 && y - 96 <= 58) return P.TIMBER;
    if (y - 96 >= 62 && y - 96 <= 102) return P.CONCRETE_DARK;
  }
  if (x >= 16 && x <= 92) {
    if (y - 96 >= 14 && y - 96 <= 52) return P.RED;
    if (y - 96 >= 56 && y - 96 <= 94) return P.BLUE;
  }
  if (x >= 104 && x <= 236 && y - 96 >= 40 && y - 96 <= 118) return P.CONCRETE;
  if (x >= 150 && x <= 186 && y - 96 >= 4 && y - 96 <= 40) return P.CONCRETE_DARK;
  for (const rx of [116, 128, 140, 152]) {
    if (x >= rx && x <= rx + 3 && y - 96 >= 18 && y - 96 <= 40) return P.REBAR;
  }
  for (const px of [308, 316]) {
    if (x >= px && x <= px + 3 && y - 96 >= 10 && y - 96 <= 120) return P.STEEL;
  }
  return P.GROUND;
}

function paintSteelFrame(x: number, y: number): Rgb {
  const P = PALETTE;
  const s = skyAt(y, 84);
  if (s) return s;
  if (y - 84 < 10) return P.SOIL;

  if (x >= 24 && x <= 296 && y - 84 >= 30 && y - 84 <= 40) return P.STEEL;
  for (const cx of [44, 120, 196, 272]) {
    if (x >= cx && x <= cx + 12 && y - 84 >= 30 && y - 84 <= 100) return P.STEEL;
  }
  if (x >= 24 && x <= 296 && y - 84 >= 96 && y - 84 <= 132) return P.CONCRETE;
  if (x >= 24 && x <= 150 && y - 84 >= 76 && y - 84 <= 96) return P.CONCRETE;
  if (x >= 210 && x <= 270 && y - 84 >= 132 && y - 84 <= 160) return P.TIMBER;

  const dx = x - 90;
  const dy = y - 84 - 100;
  if (dy >= 0 && dy <= 26 && Math.abs(dx) < 22 - dy / 3) {
    return dy >= 20 ? P.WHITE : P.ORANGE;
  }
  return P.GROUND;
}

function paintExcavation(x: number, y: number): Rgb {
  const P = PALETTE;
  const s = skyAt(y, 88);
  if (s) return s;
  if (y - 88 < 8) return P.SOIL;

  if (x >= 120 && x <= 280 && y - 88 >= 118 && y - 88 <= 132) return [96, 78, 60];
  if (x >= 120 && x <= 280 && y - 88 >= 20 && y - 88 <= 130) return [78, 62, 48];

  if (x >= 30 && x <= 112 && y - 88 >= 44 && y - 88 <= 104) {
    if (y - 88 >= 52 && y - 88 <= 78 && x >= 34 && x <= 70) return P.GLASS;
    return P.YELLOW;
  }
  if (x >= 112 && x <= 168 && y - 88 >= 26 && y - 88 <= 44) return P.YELLOW;
  if (x >= 164 && x <= 184 && y - 88 >= 46 && y - 88 <= 74) return P.DARK;
  if (x >= 28 && x <= 116 && y - 88 >= 104 && y - 88 <= 120) return P.DARK;

  if (x >= 236 && x <= 300 && y - 88 >= 60 && y - 88 <= 104) return P.TIMBER;
  for (const px of [16, 28]) {
    if (x >= px && x <= px + 3 && y - 88 >= 30 && y - 88 <= 112) return P.STEEL;
  }
  return P.GROUND;
}

function paintFinishedFacade(x: number, y: number): Rgb {
  const P = PALETTE;
  const s = skyAt(y, 70);
  if (s) return s;
  if (y - 70 < 8) return P.GROUND;
  if (y - 70 > 150) return [150, 148, 142];

  if (x >= 40 && x <= 280 && y - 70 >= 20 && y - 70 <= 150) {
    const localY = y - 90;
    const row = Math.floor(localY / 34);
    const withinRow = localY % 34;
    const withinCol = (x - 40) % 40;
    if (row >= 0 && row <= 3 && withinRow >= 8 && withinRow <= 26 && withinCol >= 8 && withinCol <= 30) {
      return P.GLASS;
    }
    if (localY % 34 >= 27 || localY % 34 <= 7) return P.CONCRETE_DARK;
    return P.CONCRETE;
  }
  if (x >= 140 && x <= 180 && y - 70 >= 108 && y - 70 <= 150) return [30, 34, 40];
  return P.GROUND;
}