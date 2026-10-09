/**
 * Deterministic localization of a FINISHED inspection.
 *
 * This module is a projection, never a mutation. It takes the canonical view a
 * run produced and returns a second object describing that same run in another
 * language. Given the same input it always returns the same output, which is
 * what makes it safe to compute four of them up front and hand the browser a
 * choice.
 *
 * It is derived from canonical fields only: the comparison rows, the detected
 * elements, the expected-state items, the finding set and the counters. Nothing
 * here re-reads a model, and nothing here can change what the inspection found.
 *
 * The one thing it will not do is invent a translation. Text that MiniCPM or
 * Nemotron wrote as free English has no structured slot to localize and this
 * product has no translation model, so that text is carried through verbatim
 * and flagged as model-authored. See `src/localization.ts` for why.
 */

import { fill, sentenceCase, translatorFor } from './localization.ts';
import type { InspectionLanguage, TextDirection, Translator } from './localization.ts';
import { INSPECTION_LANGUAGES } from './localization.ts';

/* ------------------------------------------------------------------ *
 * Structural inputs
 *
 * Declared structurally rather than imported from session.ts so this module
 * has no dependency on the pipeline. `SessionView` and its nested views satisfy
 * these shapes exactly; a test can satisfy them with a literal.
 * ------------------------------------------------------------------ */

export interface LocalizableDetection {
  readonly element: string;
  readonly present: boolean;
  readonly count: number | null;
  /** Carried so "highest confidence wins" matches compare.ts exactly. */
  readonly confidence: number;
}

export interface LocalizableComparisonRow {
  readonly id: string;
  readonly expectedId: string;
  readonly element: string;
  readonly expectation: string;
  readonly status: string;
  readonly countBasis: string;
  readonly expectedCount: number | null;
  readonly observedCount: number | null;
  readonly confidence: number | null;
  readonly boundingBox: unknown;
  readonly detectionReported: boolean;
}

export interface LocalizableExpectedItem {
  readonly id: string;
  readonly element: string;
  readonly expectation: string;
  readonly expectedCount: number | null;
  /** Operator free text. Carried verbatim into every language, never translated. */
  readonly note: string;
}

export interface LocalizableFinding {
  readonly id: string;
  readonly title: string;
  readonly origin: string;
  readonly category: string;
  readonly severity: string;
  readonly verificationStatus: string;
  readonly evidenceState: string;
  readonly observation: string;
  readonly location: string | null;
  readonly element: string | null;
  readonly expected: string | null;
  readonly difference: string | null;
  readonly reason: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly comparisonId: string | null;
  readonly confidence: number;
}

export interface LocalizablePriority {
  readonly rank: number;
  readonly title: string;
  readonly attention: string;
  readonly basis: string;
  readonly findingId: string;
}

export interface LocalizableCounters {
  readonly elementsDetected: number;
  readonly totalCounted: number;
  readonly attentionAreas: number;
  readonly incompleteAreas: number;
  readonly deviations: number;
  readonly undetermined: number;
  readonly pending: number;
  readonly verified: number;
  readonly rejected: number;
}

export interface LocalizedQualificationStage {
  /** Canonical stage enum. Unchanged. */
  readonly stage: string;
  readonly role: string;
  readonly note: string;
}

export interface LocalizedQualification {
  readonly verdict: 'MET' | 'PARTIAL' | 'NOT_MET';
  /** The end-to-end path sentence, in the selected language. */
  readonly path: string;
  readonly stages: readonly LocalizedQualificationStage[];
}

export interface LocalizableQualificationInput {
  readonly visionModel: string;
  readonly reasoningModel: string;
  readonly visionIsNvidia: boolean;
  readonly reasoningIsNvidia: boolean;
  readonly visionClassification: string;
  readonly reasoningClassification: string;
  readonly nvidiaRequirement: string;
  readonly qualifyingStage: string | null;
  readonly platform: string | null;
}

export interface LocalizableInspectionInput {
  readonly detections: readonly LocalizableDetection[];
  readonly expected: { readonly items: readonly LocalizableExpectedItem[] };
  readonly comparison: readonly LocalizableComparisonRow[];
  readonly inspectionFindings: readonly LocalizableFinding[];
  readonly priorities: readonly LocalizablePriority[];
  readonly counters: LocalizableCounters;
  readonly isDemoFixture: boolean;
  /** The NVIDIA qualification facts, regenerated per language. */
  readonly qualification: LocalizableQualificationInput;
}

/* ------------------------------------------------------------------ *
 * Localized output
 * ------------------------------------------------------------------ */

export interface LocalizedComparisonRow {
  /** Canonical row id. Unchanged in every language. */
  readonly id: string;
  readonly elementLabel: string;
  readonly statusLabel: string;
  readonly expectedText: string;
  readonly observedText: string;
  readonly difference: string | null;
  readonly countBasisLabel: string | null;
  readonly countBasisNote: string | null;
}

export interface LocalizedFinding {
  /** Canonical finding id. Unchanged in every language. */
  readonly id: string;
  readonly title: string;
  readonly what: string;
  readonly where: string | null;
  readonly expected: string | null;
  readonly difference: string | null;
  readonly reason: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly evidenceStateLabel: string;
  /** FULL_FRAME / NONE disclosure, or null when the model localized a region. */
  readonly evidenceNote: string | null;
  readonly evidenceNoteHead: string | null;
  readonly originLabel: string;
  readonly severityLabel: string;
  readonly statusLabel: string;
  readonly categoryLabel: string;
  readonly attentionLabel: string;
  /**
   * False when the body is model-authored English shown untranslated. The UI
   * uses this to label the text honestly rather than implying it was translated.
   */
  readonly translated: boolean;
}

export interface LocalizedPriority {
  readonly findingId: string;
  readonly rank: number;
  readonly title: string;
  readonly basis: string;
  readonly attentionLabel: string;
}

export interface LocalizedBrief {
  readonly lines: readonly string[];
  readonly overallLabel: string;
  readonly highestPriority: string | null;
}

export interface LocalizedInspection {
  readonly language: InspectionLanguage;
  readonly dir: TextDirection;
  readonly brief: LocalizedBrief;
  readonly priorities: readonly LocalizedPriority[];
  readonly comparison: readonly LocalizedComparisonRow[];
  readonly findings: readonly LocalizedFinding[];
  /** The NVIDIA requirement panel, in the selected language. */
  readonly qualification: LocalizedQualification;
}

/* ------------------------------------------------------------------ *
 * Regeneration of derived prose
 * ------------------------------------------------------------------ */

/**
 * Index detections by element kind, highest confidence wins.
 *
 * Mirrors `compareExpectedState` in compare.ts exactly, so the localized view
 * and the canonical view are looking at the same detection.
 */
function indexDetections(
  detections: readonly LocalizableDetection[],
): Map<string, LocalizableDetection> {
  const best = new Map<string, LocalizableDetection>();
  for (const detection of detections) {
    const current = best.get(detection.element);
    if (current === undefined || detection.confidence > current.confidence) {
      best.set(detection.element, detection);
    }
  }
  return best;
}

function unitPair(t: Translator, element: string): { unit: string; unitPlural: string } {
  return { unit: t.element(element), unitPlural: t.elementPlural(element) };
}

function expectedText(
  t: Translator,
  item: LocalizableExpectedItem,
): string {
  const note = item.note.trim();
  const { unit, unitPlural } = unitPair(t, item.element);
  const params = {
    element: unit,
    unit,
    unitPlural,
    n: item.expectedCount ?? 0,
    note,
  };
  // An empty operator note must leave the parentheses out entirely, not render
  // an empty pair: "12 columns expected ()" reads as a missing value.
  const key = (withNote: string, withoutNote: string): string =>
    note.length > 0 ? withNote : withoutNote;

  switch (item.expectation) {
    case 'COUNT':
      return item.expectedCount === 1
        ? fill(t.t(key('comparison.expected.countOne', 'comparison.expected.countOneNoNote')), params)
        : fill(t.t(key('comparison.expected.countMany', 'comparison.expected.countManyNoNote')), params);
    case 'ABSENT':
      return fill(t.t(key('comparison.expected.absent', 'comparison.expected.absentNoNote')), params);
    default:
      return fill(t.t(key('comparison.expected.present', 'comparison.expected.presentNoNote')), params);
  }
}

function observedText(
  t: Translator,
  item: LocalizableExpectedItem,
  detection: LocalizableDetection | undefined,
): string {
  if (detection === undefined) {
    return item.expectation === 'ABSENT'
      ? t.t('comparison.observed.noneSeen')
      : t.t('comparison.observed.notDeterminable');
  }
  const { unit, unitPlural } = unitPair(t, item.element);
  if (!detection.present) {
    return fill(t.t('comparison.observed.absent'), { element: unit });
  }
  if (detection.count !== null) {
    return detection.count === 1
      ? fill(t.t('comparison.observed.countOne'), { n: detection.count, unit })
      : fill(t.t('comparison.observed.countMany'), { n: detection.count, unitPlural });
  }
  return fill(t.t('comparison.observed.present'), { element: unit });
}

/**
 * The difference sentence, regenerated from the two canonical counts.
 *
 * Only reached for a COUNT row, so `expectedCount` and `observedCount` are both
 * present by construction. The numbers are interpolated verbatim.
 */
function differenceText(
  t: Translator,
  row: LocalizableComparisonRow,
  item: LocalizableExpectedItem | undefined,
): string | null {
  if (row.status !== 'ATTENTION') return null;
  const { unit, unitPlural } = unitPair(t, row.element);

  if (row.expectation === 'COUNT' && item !== undefined && item.expectedCount !== null) {
    const expected = item.expectedCount;
    const observed = row.observedCount ?? 0;
    const delta = observed - expected;
    const template = delta < 0 ? 'comparison.diff.fewer' : 'comparison.diff.more';
    return fill(t.t(template), {
      delta: Math.abs(delta),
      unitPlural,
      observed,
      expected,
    });
  }
  if (row.expectation === 'ABSENT') {
    return fill(t.t('comparison.diff.unexpected'), { element: unit });
  }
  return fill(t.t('comparison.diff.missing'), { element: unit });
}

/* ------------------------------------------------------------------ *
 * Finding prose
 * ------------------------------------------------------------------ */

function findingTitle(t: Translator, row: LocalizableComparisonRow, item: LocalizableExpectedItem | undefined): string {
  const element = sentenceCase(t.element(row.element));
  if (row.status === 'UNDETERMINED') {
    return fill(t.t('cf.title.undetermined'), { element });
  }
  if (row.expectation === 'COUNT') return fill(t.t('cf.title.count'), { element });
  if (row.expectation === 'ABSENT') return fill(t.t('cf.title.unexpected'), { element });
  return fill(t.t('cf.title.missing'), { element });
}

function comparisonReason(
  t: Translator,
  row: LocalizableComparisonRow,
  expected: string,
  observed: string,
): string {
  if (row.status === 'UNDETERMINED') {
    return fill(t.t('cf.reason.undetermined'), { expected });
  }
  return fill(t.t('cf.reason.mismatch'), { expected, observed });
}

function comparisonEvidence(t: Translator, row: LocalizableComparisonRow): string {
  if (row.boundingBox !== null && row.boundingBox !== undefined) {
    return t.t('cf.evidence.localized');
  }
  if (row.detectionReported) return t.t('cf.evidence.fullFrame');
  return t.t('cf.evidence.none');
}

function comparisonRecommendation(
  t: Translator,
  row: LocalizableComparisonRow,
): string {
  const element = t.element(row.element);
  if (row.status === 'UNDETERMINED') {
    return fill(t.t('cf.rec.undetermined'), { element });
  }
  if (row.expectation === 'COUNT') return fill(t.t('cf.rec.count'), { element });
  if (row.expectation === 'ABSENT') return fill(t.t('cf.rec.unexpected'), { element });
  return fill(t.t('cf.rec.missing'), { element });
}

/* ------------------------------------------------------------------ *
 * Brief
 * ------------------------------------------------------------------ */

function localizedBrief(
  t: Translator,
  input: LocalizableInspectionInput,
  findingTitles: Map<string, string>,
): LocalizedBrief {
  const detections = input.detections;
  const lines: string[] = [];

  const counted = detections.filter((d) => d.count !== null && d.present);
  const summed = counted.reduce((sum, d) => sum + (d.count ?? 0), 0);

  if (detections.length === 0) {
    lines.push(t.t('brief.noneDetected'));
  } else if (counted.length > 0) {
    lines.push(fill(t.t('brief.countedAcross'), {
      total: summed,
      types: detections.length,
    }));
  } else {
    lines.push(fill(t.t('brief.typesDetected'), { n: detections.length }));
  }

  const attentionFindings = input.inspectionFindings.filter(
    (f) => f.category !== 'UNDETERMINED' && f.verificationStatus === 'UNVERIFIED',
  );
  const undeterminedFindings = input.inspectionFindings.filter(
    (f) => f.category === 'UNDETERMINED',
  );

  if (attentionFindings.length > 0) {
    lines.push(fill(
      t.t(attentionFindings.length === 1 ? 'brief.deviationsOne' : 'brief.deviationsMany'),
      { n: attentionFindings.length },
    ));
  }
  if (undeterminedFindings.length > 0) {
    lines.push(fill(
      t.t(undeterminedFindings.length === 1 ? 'brief.unsettledOne' : 'brief.unsettledMany'),
      { n: undeterminedFindings.length },
    ));
  }
  const attention = input.comparison.filter((r) => r.status === 'ATTENTION').length;
  if (attention > 0) {
    lines.push(fill(t.t(attention === 1 ? 'brief.attentionOne' : 'brief.attentionMany'), { n: attention }));
  }
  const matched = input.comparison.filter((r) => r.status === 'MATCH').length;
  if (matched > 0) {
    lines.push(fill(t.t(matched === 1 ? 'brief.matchedOne' : 'brief.matchedMany'), { n: matched }));
  }

  const overall = deriveOverall(attentionFindings.length, attention);
  lines.push('');
  lines.push(fill(t.t('brief.overallPrefix'), {
    overall: t.t(`overall.${overall}`),
  }));

  const highest = input.priorities.length > 0
    ? (findingTitles.get(input.priorities[0]!.findingId) ?? input.priorities[0]!.title)
    : null;

  return {
    lines,
    overallLabel: t.t(`overall.${overall}`),
    highestPriority: highest,
  };
}

/**
 * The same verdict the canonical brief derives, from the same inputs.
 * Never taken from the model, and never inferred from language.
 */
function deriveOverall(attentionFindings: number, comparisonAttention: number): string {
  if (attentionFindings > 0) return 'ATTENTION_REQUIRED';
  if (comparisonAttention > 0) return 'REVIEW_SUGGESTED';
  return 'NO_ATTENTION';
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * The NVIDIA requirement panel, regenerated in the target language.
 *
 * The VERDICT is canonical and is passed through untouched: only the sentences
 * around it are re-rendered. Model ids, the platform name and the stage enums
 * are machine facts and are interpolated verbatim.
 */
function localizedQualification(
  t: Translator,
  input: LocalizableQualificationInput,
): LocalizedQualification {
  const verdict = input.nvidiaRequirement as 'MET' | 'PARTIAL' | 'NOT_MET';
  const viaReasoning = input.qualifyingStage === 'REASONING';
  const qualifyingModel = viaReasoning ? input.reasoningModel : input.visionModel;

  const stage = (
    name: string,
    role: string,
    model: string,
    isNvidia: boolean,
    classification: string,
  ): LocalizedQualificationStage => {
    let note: string;
    if (classification === 'ELIGIBLE') {
      // The ROLE is supplied here, not left to the template: an unfilled
      // placeholder reaching the screen is a visible defect.
      note = fill(t.t('qual.stageEligible'), { role, platform: input.platform ?? '' });
    } else if (!isNvidia) {
      note = fill(t.t('qual.stageNotNvidia'), { model });
    } else if (classification === 'NOT_VERIFIED') {
      note = t.t('qual.stageUnverified');
    } else {
      note = t.t('qual.stageDidNotRun');
    }
    return { stage: name, role, note };
  };

  return {
    verdict,
    path: verdict === 'MET'
      ? fill(t.t('qual.pathMet'), {
          visionModel: input.visionModel,
          qualifyingModel,
          platform: input.platform ?? '',
        })
      : verdict === 'PARTIAL'
        ? t.t('qual.pathPartial')
        : t.t('qual.pathNotMet'),
    stages: [
      stage('VISION', t.t('qual.roleVision'), input.visionModel, input.visionIsNvidia, input.visionClassification),
      stage(
        'REASONING',
        t.t('qual.roleReasoning'),
        input.reasoningModel,
        input.reasoningIsNvidia,
        input.reasoningClassification,
      ),
    ],
  };
}

/**
 * Project one finished inspection into one language.
 *
 * Pure: the input is read, never written. Deterministic: the same input and the
 * same language always give the same output. Total: an unexpected shape
 * degrades to the canonical English text rather than throwing, because a
 * presentation fault must never take the inspection down with it.
 */
export function localizeInspection(
  input: LocalizableInspectionInput,
  language: InspectionLanguage,
): LocalizedInspection {
  const t = translatorFor(language);

  const itemsById = new Map<string, LocalizableExpectedItem>();
  for (const item of input.expected.items) itemsById.set(item.id, item);
  const detections = indexDetections(input.detections);
  const rowsById = new Map<string, LocalizableComparisonRow>();
  for (const row of input.comparison) rowsById.set(row.id, row);

  // Expected and observed text are produced ONCE per row and reused by the
  // comparison table and by every finding that rests on that row, so the two
  // surfaces can never disagree about what was expected.
  const expectedByRowId = new Map<string, string>();
  const observedByRowId = new Map<string, string>();
  for (const row of input.comparison) {
    const item = itemsById.get(row.expectedId);
    expectedByRowId.set(row.id, expectedText(t, item ?? fallbackItem(row)));
    observedByRowId.set(
      row.id,
      observedText(t, item ?? fallbackItem(row), detections.get(row.element)),
    );
  }

  const comparison: LocalizedComparisonRow[] = input.comparison.map((row) => {
    const counted = row.countBasis === 'VISUAL_COUNT' && row.observedCount !== null;
    return {
      id: row.id,
      elementLabel: t.element(row.element),
      statusLabel: t.t(`comparisonStatus.${row.status}`),
      expectedText: expectedByRowId.get(row.id) ?? row.id,
      observedText: observedByRowId.get(row.id) ?? '',
      difference: differenceText(t, row, itemsById.get(row.expectedId)),
      countBasisLabel: counted ? t.t('countBasis.VISUAL_COUNT') : null,
      countBasisNote: counted ? t.t('comparison.countBasisNote') : null,
    };
  });

  const findings: LocalizedFinding[] = input.inspectionFindings.map((finding) => {
    const row = finding.comparisonId !== null
      ? rowsById.get(finding.comparisonId) ?? null
      : null;
    const item = row !== null ? itemsById.get(row.expectedId) ?? null : null;
    const derived = row !== null;
    const expectedTextForRow = row !== null
      ? expectedByRowId.get(row.id) ?? finding.expected ?? ''
      : finding.expected ?? '';
    const observed = row !== null
      ? observedByRowId.get(row.id) ?? finding.observation
      : finding.observation;

    return {
      id: finding.id,
      title: derived ? findingTitle(t, row, item ?? undefined) : finding.title,
      what: observed,
      where: finding.location,
      expected: finding.expected !== null || expectedTextForRow !== '' ? expectedTextForRow : null,
      difference: derived && row.status === 'UNDETERMINED'
        ? fill(t.t('cf.difference.undetermined'), { expected: expectedTextForRow })
        : derived
          ? differenceText(t, row, item ?? undefined)
          : finding.difference,
      reason: derived
        ? comparisonReason(t, row, expectedTextForRow, observed)
        : finding.reason,
      evidence: derived ? comparisonEvidence(t, row) : finding.evidence,
      recommendation: derived ? comparisonRecommendation(t, row) : finding.recommendation,
      evidenceStateLabel: t.t(`evidenceState.${finding.evidenceState}`),
      evidenceNote: finding.evidenceState === 'FULL_FRAME'
        ? t.t('finding.evidence.fullFrame')
        : finding.evidenceState === 'NONE'
          ? t.t('finding.evidence.none')
          : null,
      evidenceNoteHead: finding.evidenceState === 'FULL_FRAME'
        ? t.t('finding.evidence.headFullFrame')
        : finding.evidenceState === 'NONE'
          ? t.t('finding.evidence.headNone')
          : null,
      originLabel: t.t(
        finding.origin === 'COMPARISON' ? 'finding.origin.comparison' : 'finding.origin.visual',
      ),
      severityLabel: t.t(`severity.${finding.severity}`),
      statusLabel: t.t(`status.${finding.verificationStatus}`),
      categoryLabel: t.t(`category.${finding.category}`),
      attentionLabel: t.t(`severity.${attentionFor(finding.severity)}`),
      translated: derived,
    };
  });

  const findingTitles = new Map<string, string>();
  for (const finding of findings) findingTitles.set(finding.id, finding.title);
  const canonicalById = new Map<string, LocalizableFinding>();
  for (const finding of input.inspectionFindings) canonicalById.set(finding.id, finding);

  const priorities: LocalizedPriority[] = input.priorities.map((priority) => {
    const localized = findingTitles.get(priority.findingId) ?? null;
    const canonical = canonicalById.get(priority.findingId) ?? null;
    // Origin and confidence come from the canonical finding, never from the
    // localized copy, so the priority basis is computed from machine facts.
    const originIsComparison = canonical !== null
      ? canonical.origin === 'COMPARISON'
      : priority.basis.indexOf('Expected-state') === 0;
    const pct = Math.round((canonical?.confidence ?? 0) * 100);
    return {
      findingId: priority.findingId,
      rank: priority.rank,
      title: localized ?? priority.title,
      basis: fill(
        t.t(originIsComparison ? 'priority.basis.comparison' : 'priority.basis.visual'),
        { pct },
      ),
      attentionLabel: t.t(`severity.${priority.attention}`),
    };
  });

  return {
    language,
    dir: t.dir,
    brief: localizedBrief(t, input, findingTitles),
    priorities,
    comparison,
    findings,
    qualification: localizedQualification(t, input.qualification),
  };
}

/**
 * Every supported language, computed from the SAME canonical input.
 *
 * The browser receives all of them in one payload, so switching language is a
 * local read: no request, no re-run, no second opinion.
 */
export function localizeInspectionAll(
  input: LocalizableInspectionInput,
): Record<InspectionLanguage, LocalizedInspection> {
  const out = {} as Record<InspectionLanguage, LocalizedInspection>;
  for (const language of INSPECTION_LANGUAGES) out[language] = localizeInspection(input, language);
  return out;
}

function attentionFor(severity: string): string {
  if (severity === 'HIGH') return 'HIGH';
  if (severity === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

/**
 * A stand-in item for a row whose expected item is missing.
 *
 * Should be unreachable: a row always carries an `expectedId` that came from the
 * reference. Built rather than skipped so a row is never rendered with an empty
 * expected column, and it changes no canonical value.
 */
function fallbackItem(row: LocalizableComparisonRow): LocalizableExpectedItem {
  return {
    id: row.expectedId,
    element: row.element,
    expectation: row.expectation,
    expectedCount: row.expectedCount,
    note: '',
  };
}