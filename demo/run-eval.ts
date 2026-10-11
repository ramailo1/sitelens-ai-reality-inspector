// Entry point for the evaluation harness.

import {
  formatEvaluationReport,
  runLiveEvaluation,
  runOfflineEvaluation,
} from '../src/evaluation-harness.ts';

const liveRequested = process.argv.includes('--live');

if (!liveRequested) {
  console.log('\n  SiteLens evaluation — OFFLINE mode (deterministic, no network, no cost)\n');
  const report = await runOfflineEvaluation();
  console.log(formatEvaluationReport(report));
  const { correct, total } = report.metrics.comparisonCorrectness;
  const ok = report.metrics.trustConformance === 1
    && correct === total
    && report.metrics.regressionPassed.passed === report.metrics.regressionPassed.total;
  console.log(`  verdict: ${ok ? 'SPECIFICATION CONFORMANCE HELD' : 'SPECIFICATION VIOLATION DETECTED'}\n`);
  process.exitCode = ok ? 0 : 1;
} else {
  // Live mode is strictly opt-in: the provider is built here, from the same configured environment the application.
  const { createProvider, ProviderError } = await import('../src/providers/factory.ts');
  let provider;
  try {
    provider = createProvider(process.env);
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      console.error(`  CONFIGURATION ERROR (${error.kind}): ${error.message}`);
    }
    throw error;
  }
  console.log('\n  SiteLens evaluation — LIVE mode (real inference; costs will be incurred)\n');
  console.log(`  provider : ${provider.name}`);
  console.log(`  model    : ${provider.model}`);
  console.log('  NOTE     : small labelled sample; metrics are descriptive, not conclusive.\n');
  const report = await runLiveEvaluation(provider);
  console.log(formatEvaluationReport(report));
  process.exitCode = report.metrics.regressionPassed.passed === report.metrics.regressionPassed.total
    ? 0
    : 1;
}
