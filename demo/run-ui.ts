/**
 * Entry point for the local Reality Inspector UI.
 *
 *   npm run ui
 *
 * Requires the usual environment configuration; see .env.example. The server
 * binds to loopback only.
 */

import { startInspectionServer } from '../src/server.ts';

const rawPort = process.env['UI_PORT'] ?? '4317';
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`  UI_PORT must be an integer between 1024 and 65535 (received "${rawPort}").`);
  process.exitCode = 1;
} else {
  await startInspectionServer(port);
}