/**
 * Entry point for the compatibility evaluation.
 *
 *   npm run eval
 *
 * Runs every scenario through the configured provider and reports what
 * happened. This is a reliability report, not an accuracy benchmark: there is
 * no ground truth, so no correctness score is produced.
 */

import { runEvaluation, summarizeEvaluation } from '../src/evaluation.ts';
import { createProvider, ProviderError } from '../src/providers/factory.ts';

let providerName: string;
let modelName: string;
try {
  const provider = createProvider(process.env);
  providerName = provider.name;
  modelName = provider.model;
} catch (error: unknown) {
  // A misconfiguration is a hard stop: there is no honest way to report a
  // reliability run when no provider was ever reached. The ProviderError branch
  // explains why in the operator's terms before the error is rethrown.
  if (error instanceof ProviderError) {
    console.error(`  CONFIGURATION ERROR (${error.kind}): ${error.message}`);
  }
  throw error;
}

console.log('\n  SiteLens AI Reality Inspector - compatibility evaluation');
console.log(`  provider : ${providerName}`);
console.log(`  model    : ${modelName}`);
console.log('  NOTE     : reliability report, not an accuracy benchmark.\n');

const outcomes = await runEvaluation();
const summary = summarizeEvaluation(outcomes);

for (const outcome of outcomes) {
  console.log(`  ${outcome.caseId}`);
  console.log(`      conditions   : ${outcome.focus.join(', ')}`);
  if (outcome.requestSucceeded) {
    console.log(
      `      result       : ${outcome.accepted} accepted, ${outcome.rejected} rejected, ${outcome.latencyMs} ms`,
    );
    console.log(`      trust held   : AI_GENERATED=${outcome.allAiGenerated} UNVERIFIED=${outcome.allUnverified}`);
  } else {
    console.log(`      result       : request failed - ${outcome.error}`);
    console.log('      trust held   : no observations produced');
  }
  console.log(`      as specified : ${outcome.behavedAsSpecified ? 'yes' : 'NO'}`);
  console.log('');
}

console.log('  -----------------------------------------------------');
console.log(`  cases                    : ${summary.cases}`);
console.log(`  requests succeeded       : ${summary.requestsSucceeded}`);
console.log(`  cases with observations  : ${summary.casesWithObservations}`);
console.log(`  observations accepted    : ${summary.totalAccepted}`);
console.log(`  observations rejected    : ${summary.totalRejected}`);
console.log(`  specification respected  : ${summary.allSpecificationRespected ? 'yes' : 'NO'}`);
console.log('  -----------------------------------------------------\n');
console.log('  Latencies above are single samples, not benchmarks. No accuracy,\n');
console.log('  precision or model ranking is claimed or implied.\n');

process.exitCode = summary.allSpecificationRespected ? 0 : 1;