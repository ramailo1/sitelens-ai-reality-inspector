/**
 * Multilingual presentation of an inspection result.
 *
 * THE ONE RULE IN THIS FILE: language changes PRESENTATION and nothing else.
 *
 * A canonical inspection is a set of machine facts: ids, enums, counts,
 * timestamps, bounding boxes, provenance, and the prose the vision and reasoning
 * models actually returned. Those facts are computed once, validated once,
 * persisted once, and are byte-identical whichever language is on screen. This
 * module reads a finished inspection and returns a SECOND object that describes
 * the same inspection in another language. It never mutates its input, never
 * calls a model, and never re-runs the pipeline.
 *
 * Two kinds of text exist in an inspection result, and they are handled
 * differently on purpose:
 *
 *   DERIVED      The pipeline already generates this from structured facts - the
 *                comparison rows, the reality brief, the priority basis, the
 *                labels on every enum. It is REGENERATED here from those same
 *                canonical fields in the target language. Not translated: there
 *                is no English sentence being converted, so a mistranslation
 *                cannot invent a fact that the code did not compute.
 *
 *   MODEL        Free English written by MiniCPM or Nemotron - a finding title,
 *                a rationale, an evidence description. There is no structured
 *                slot inside it to localize, and no translation model in this
 *                product. So it is PRESERVED verbatim and LABELLED as
 *                model-authored English. Inventing a translation of a safety
 *                claim is exactly the failure this product exists to avoid, so
 *                the honest answer is that the words stay and the label says so.
 *
 * Nothing here is machine-translated, and no external provider was added for
 * translation. Where a localized string is unavailable the canonical English
 * source is shown, never a guess.
 *
 * Numbers, ids, model names, element enums and timestamps are interpolated
 * verbatim into every language: a spacing of 180 mm is 180 mm in all four.
 */

/* ------------------------------------------------------------------ *
 * Languages
 * ------------------------------------------------------------------ */

export const INSPECTION_LANGUAGES = ['en', 'fr', 'ar', 'zh'] as const;
export type InspectionLanguage = (typeof INSPECTION_LANGUAGES)[number];

export const DEFAULT_INSPECTION_LANGUAGE: InspectionLanguage = 'en';

export function isInspectionLanguage(value: unknown): value is InspectionLanguage {
  return typeof value === 'string'
    && (INSPECTION_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Fail closed. An unsupported or absent language resolves to English rather
 * than throwing, so a bad value can never take the inspection surface down or
 * leave it half-translated.
 */
export function resolveInspectionLanguage(value: unknown): InspectionLanguage {
  return isInspectionLanguage(value) ? value : DEFAULT_INSPECTION_LANGUAGE;
}

export type TextDirection = 'ltr' | 'rtl';

/** Arabic is the only right-to-left language supported. */
export const LANGUAGE_DIRECTION: Readonly<Record<InspectionLanguage, TextDirection>> = {
  en: 'ltr',
  fr: 'ltr',
  ar: 'rtl',
  zh: 'ltr',
};

/**
 * Endonyms, not English names and not flags.
 *
 * A flag identifies a country, not a language, and `zh` is not one flag. A judge
 * who cannot read the current language still has to find their own.
 */
export const LANGUAGE_LABELS: Readonly<Record<InspectionLanguage, string>> = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
  zh: '中文',
};

/** BCP 47 tags, for the `lang` attribute on the localized surface. */
export const LANGUAGE_BCP47: Readonly<Record<InspectionLanguage, string>> = {
  en: 'en',
  fr: 'fr',
  ar: 'ar',
  zh: 'zh-CN',
};

/** Stable key used in the persisted preference. Never a display string. */
export const LANGUAGE_STORAGE_KEY = 'sitelens.inspectionLanguage';

/* ------------------------------------------------------------------ *
 * Catalog
 * ------------------------------------------------------------------ */

type Catalog = Readonly<Record<string, string>>;

/**
 * English is the source of truth for the key set: the other three are typed
 * against it, so a missing key is a COMPILE ERROR rather than a blank label
 * discovered in front of a judge.
 */
const EN = {
  // -- the photographs of an inspection -----------------------------------
  // Nouns are counted in words ("3 photographs" vs "1 photograph") because a
  // bare numeral reads as a data cell, and an operator has to be able to tell
  // one photo from four without counting anything.
  'imgs.head': 'Inspection photos',
  'imgs.count': '{count} photographs',
  'imgs.countZero': 'no photo open',
  'imgs.note': 'All of these are analysed as ONE inspection. A disagreement between photographs is reported as a disagreement, never added up.',
  'imgs.addMore': 'Add photos',
  'imgs.remove': 'Remove',
  'imgs.inspect': 'Inspect reality',
  'imgs.added': '{count} photograph(s) added to {project}. Inspect when ready.',
  'imgs.duplicates': '{count} of {total} selected photos were byte-identical duplicates and were refused, not silently dropped.',
  'imgs.partial': '{accepted} added, {refused} refused.',
  'imgs.reading': 'Reading photo {index} of {total}',
  'imgs.readFailed': 'That file could not be read.',
  'imgs.rejected': 'Photos rejected',
  'imgs.loaded': '{count} photos loaded — inspect when ready',
  'imgs.ready': 'Photos ready',
  'imgs.noneOpen': 'Open at least one photo before inspecting.',
  'imgs.ordinal': '{index}',
  'imgs.dropOne': 'Remove {label} from this inspection',
  'imgs.status.ready': 'READY',
  'imgs.status.done': 'ANALYSED',
  'imgs.status.failed': 'FAILED',
  'imgs.obsCount': '{count} observation(s)',
  'imgs.basisPending': 'No inspection has been run for these photos yet.',
  'imgs.basisPartial': '{failed} photo(s) failed and contributed no evidence. This inspection rests on {analysed} photo(s).',

  // -- the evidence stage, and the reviewer gate -----------------------------
  'imgs.evidencePhotos': 'Inspection photos:',
  'imgs.evidenceBasedOn': 'one inspection, {count} photographs',
  'imgs.selectAll': 'Select all',
  'imgs.clear': 'Clear',
  'gate.required': 'REVIEWER REQUIRED',
  'gate.reason': 'Name the inspection reviewer to record a human verification. Until then every finding stays UNVERIFIED.',
  'gate.setup': 'SET UP REVIEWER',
  'imgs.allOpen': 'Every capture in this project is already open as one inspection.',

  // -- selection messages -------------------------------------------------
  'imgs.restored': 'Restored the last inspection of this photo. Inspect again for a fresh reading.',
  'imgs.selected': 'Photo selected. Press Inspect reality to analyse it.',
  'imgs.restoredShort': 'Photo selected; showing its last inspection.',
  'imgs.selectedShort': 'Photo selected.',
  'imgs.selectFailed': 'That photo could not be selected',

  // -- the run itself -----------------------------------------------------
  'run.working': 'ANALYZING REALITY',
  'run.brief': 'ANALYZING REALITY — MiniCPM reads {count} photograph(s) one at a time, the comparison is computed in code, then Nemotron reasons once about the combined evidence.',
  'run.notify': 'Inspection running over {count} photograph(s): real vision inference per photo, one deterministic comparison, then one Nemotron reasoning pass.',
  'run.elapsed': 'RUNNING — {secs}s elapsed, {count} photograph(s) to analyse. There is no per-stage progress signal, only elapsed time.',
  'run.done': '{how} complete in {secs}s. {findings} finding(s), all UNVERIFIED and awaiting a named human decision.',
  'run.readyLamp': 'FINDINGS READY — awaiting human review',
  'run.partialLamp': 'PARTIAL — some photos failed',
  'run.partial': 'PARTIAL INSPECTION: {analysed} photo(s) analysed, {failed} failed ({names}). The failed photos contributed nothing.',
  'run.withReasoning': '{how}: {overall}. Nemotron reasoning: {certainty}. Nothing is verified yet.',
  'run.noReasoning': '{how}: {overall}. CONSTRUCTION REASONING UNAVAILABLE ({kind}) — the comparison below is unaffected and nothing has been invented in its place.',
  'run.plainDone': '{how}: {overall}. Nothing is verified yet.',
  'origin.cached': 'CACHED AI RESULT (previous inference)',
  'origin.fixture': 'DEMO FIXTURE',
  'origin.fresh': 'FRESH AI INFERENCE',

  // -- evidence attribution ------------------------------------------------
  'obs.from': 'from {label}',

  // -- language control ---------------------------------------------------
  'imgs.countAtCap': '{count} photographs — the maximum for one inspection',
  'meta.zone': 'ZONE',
  'meta.capture': 'CAPTURE',
  'meta.captureHint': 'photographs open',
  'meta.reviewer': 'REVIEWER',
  'meta.stateReady': 'Capture ready',
  'meta.vision': 'Vision',
  'meta.reasoning': 'Reasoning',
  'meta.source': 'Source',
  'proj.label': 'Project',
  'proj.new': 'New project',
  'tab.capture': 'Capture',
  'tab.inspect': 'Inspect',
  'tab.evidence': 'Evidence',
  'tab.findings': 'Findings',
  'qual.met': 'MET',
  'qual.partial': 'PARTIAL',
  'qual.hybrid': 'Hybrid inference pipeline',
  'qual.pipeline': 'Inference pipeline',
  'qual.unavailable': 'Unavailable',
  'qual.row.vision': 'Vision stage',
  'qual.row.reasoning': 'Construction reasoning',
  'qual.row.platform': 'Inference platform',
  'qual.tag.vision': 'NVIDIA MODEL \u00b7 {role}',
  'qual.tag.vision.not': 'NOT AN NVIDIA MODEL \u00b7 {role}',
  'qual.tag.reasoning': 'NVIDIA MODEL, QUALIFYING \u00b7 {role}',
  'qual.tag.reasoning.not': 'NOT THE QUALIFYING INFERENCE \u00b7 {role}',
  'qual.tag.platform': 'Called on this platform',
  'qual.tag.platform.not': 'No platform for this stage',
  'lang.label': 'Inspection language',
  'lang.hint': 'Presentation only. The inspection, its evidence and its provenance are unchanged.',
  'lang.sourceEnglish': 'Model-authored English — shown untranslated',
  'lang.canonicalBadge': 'CANONICAL FACTS UNCHANGED',
  'tr.viewOriginal': 'View original',
  'tr.viewTranslation': 'Show translation',
  'tr.translatedBadge': 'Translated from English',
  'tr.fallbackNote': 'Translation unavailable — showing original',

  // -- strings that live in an HTML ATTRIBUTE rather than in text. Each is
  //    localized through the same catalog as the visible copy, so a screen
  //    reader, an image caption and a tooltip follow the language too.
  'skip.capture': 'Skip to the capture stage',
  'aria.projects': 'Projects',
  'aria.workflow': 'Workflow',
  'aria.pipeline': 'Model pipeline',
  'aria.summary': 'Inspection summary',
  'aria.drop': 'Drop a PNG or JPEG capture here, or press Enter to choose a file',
  'ident.cacheToggleTitle': 'Reuse a previous successful AI result for this exact image instead of paying model latency again. Cached results are labelled.',
  'img.captureAlt': 'Construction capture under inspection',
  'img.evidenceAlt': 'Construction reality capture with evidence overlays',
  'reviewer.namePh': 'e.g. Takou Rah',
  'reviewer.rolePh': 'e.g. Site Engineer',
  'panel.notePh': 'optional review note',
  'foot.thesis': 'AI does not replace the inspector. It tells the inspector where to look.',
  'foot.local': 'Local inspection surface. Loopback only.',

  // -- provenance rows. The VALUES are canonical and never localized; only
  //    these labels follow the selected language.
  'prov.provider': 'Provider',
  'prov.model': 'Model',
  'prov.inferenceExecuted': 'Inference executed',
  'prov.elementsDetected': 'Elements detected',
  'prov.observationsAccepted': 'Observations accepted',
  'prov.observationsRejected': 'Observations rejected',
  'prov.latency': 'Latency',
  'prov.capturedAt': 'Captured at',
  'prov.humanReview': 'Human review performed',
  'prov.yes': 'yes',
  'prov.no': 'no',
  'prov.restored': 'no — result restored from disk',
  'prov.notRerun': 'not re-run',
  'prov.geometry':
    'This source file carried EXIF orientation {n}. Its pixels were normalized to orientation 1 before '
    + 'inspection, so the model, the display and the evidence overlay all use one coordinate system. '
    + 'No image was re-encoded.',
  'prov.geometryStored': 'Stored {sw}×{sh}, displayed {dw}×{dh}.',
  'prov.failedHead': 'INSPECTION FAILED ({kind})',
  'prov.partialHead': 'PARTIAL INSPECTION',
  'pipe.partial': '{analysed} of {total} photograph(s) analysed, the rest failed and contributed nothing',
  'prov.rejectedHead': '{n} MODEL ENTRIES REJECTED BY VALIDATION',

  // -- yes/no and generic failures -----------------------------------------
  'fail.timeout': 'AI provider timed out. The model did not answer in time; no result was produced.',
  'fail.unavailable': 'Could not reach the AI provider (network or server error). No result was produced.',
  'fail.authentication': 'AI provider rejected the credential (authentication failed). Check NEBIUS_API_KEY.',
  'fail.rateLimited': 'AI provider rate-limited this request. Wait a moment and run again.',
  'fail.notConfigured': 'No AI provider is configured, so no inspection was performed.',
  'fail.malformed': 'AI provider returned a response that could not be read. No result was produced.',
  'fail.error': 'The inspection failed. No result was produced.',

  // -- masthead ------------------------------------------------------------
  'header.cached': 'CACHED AI RESULT — inference from {at}',
  'header.cachedEarlier': 'an earlier run',
  'header.liveInference': 'live inference',

  // -- Inspect bay intro ---------------------------------------------------
  'intro.pending': 'The model has not been asked anything yet.',
  'intro.failed': 'The last inspection did not complete — see the failure note below.',
  'intro.cached': 'Showing the restored inspection of this capture. Inspect again for a fresh reading.',
  'intro.fresh': 'Fresh inference complete — findings await a named human decision.',
  'intro.idle': 'Capture a site image, then run the inspection.',

  // -- evidence rail -------------------------------------------------------
  'rail.pending': '{pending} awaiting review, {verified} verified',
  'rail.reality': 'REALITY',
  'rail.inspection': 'INSPECTION',
  'rail.findings': 'FINDINGS',
  'rail.confidence': 'CONFIDENCE',
  'rail.overall': 'OVERALL',
  'rail.elementsDetected': 'elements detected',
  'rail.attentionAreas': 'attention areas',
  'rail.awaitingReview': 'awaiting review',
  'rail.highestFinding': 'highest finding',

  // -- static panel headings ----------------------------------------------
  'panel.realityBrief': 'Reality brief',
  'panel.priorities': 'Inspection priorities',
  'panel.whereToLook': 'WHERE TO LOOK',
  'panel.provenance': 'Provenance & Eligibility',
  'panel.realityEvidence': 'Reality and evidence',
  'panel.evidenceHint': 'Select a finding to highlight where on the site it was flagged.',
  'panel.reviewer': 'INSPECTION REVIEWER',
  'panel.reviewerUnset': 'Not configured',
  'panel.setReviewer': 'Set reviewer',
  'panel.changeReviewer': 'Change reviewer',
  'panel.reviewerUnsetMeta': 'Not set',
  'panel.verificationNote': 'Verification note',
  'panel.trustSuspected': 'AI_SUSPECTED',
  'panel.trustUnverified': 'UNVERIFIED',
  'panel.trustNote': 'Confidence never verifies itself.',
  'panel.findingsAndVerification': 'Findings and verification',
  'panel.findingsHint': 'Every AI finding needs a named person to confirm, reject or defer it.',
  'panel.nvidiaRequirement': 'NVIDIA requirement',
  'panel.inspection': 'Inspection',
  'panel.prioritiesHint': 'Where your inspector should look first. These are not verdicts.',
  'panel.trustTo': 'to',
  'stage.noCapture': 'No capture loaded.',
  'panel.stageReasoningHeading': 'Construction reasoning',
  'panel.stageReasoningNotRun': 'NOT RUN',

  // -- pipeline strip ------------------------------------------------------
  'pipe.notRun': 'not run yet',
  'pipe.awaitingInspection': 'awaiting first inspection',
  'pipe.nothingVerified': 'nothing verified',
  'pipe.didNotComplete': 'did not complete — {kind}',
  'pipe.syntheticFixture': 'synthetic fixture, not AI inference',
  'pipe.restoredResult': 'restored result, not a fresh call',
  'pipe.visionCounts': '{elements} element(s), {observations} observation(s) in {ms} ms',
  'pipe.compareEngine': 'SiteLens deterministic engine (src/compare.ts)',
  'pipe.noExpectedState': 'no expected state loaded',
  'pipe.compareCounts': '{matched} match · {attention} attention · {undetermined} undetermined',
  'pipe.degenerate': 'adds little to the visual reading',
  'pipe.verifyPending': 'nothing verified — {n} awaiting a named human',
  'pipe.verifyCounts': '{verified} verified · {rejected} rejected',

  // -- reasoning panel -----------------------------------------------------
  'reason.stageLabel': 'STAGE 2 · NEMOTRON',
  'reason.noConfidence': 'no confidence stated',
  'reason.footPrefix': 'Reasoned over {detections} detected element(s) and {rows} comparison row(s)',
  'reason.footCached': ', restored with the original inspection',
  'reason.footLive': ' in {ms} ms',
  'reason.noneProduced': 'Construction reasoning has not been produced for this capture.',
  'reason.unavailableHead': 'CONSTRUCTION REASONING UNAVAILABLE',

  // -- qualification panel -------------------------------------------------
  'qual.notMet': 'NOT MET',
  'qual.noQualifying': 'no qualifying NVIDIA inference completed on this run',
  'qual.qualifyingStage': ' · qualifying stage: {stage}',
  'qual.stageReasoning': 'construction reasoning (Nemotron)',
  'qual.stageVision': 'visual analysis',
  'qual.nvidiaModel': 'NVIDIA MODEL',
  'qual.notNvidiaModel': 'NOT AN NVIDIA MODEL',
  'qual.visionHead': 'VISION STAGE:',
  'qual.reasoningHead': 'REASONING STAGE:',
  'qual.roleVision': 'Visual evidence extraction from the site photograph',
  'qual.roleReasoning': 'Construction reasoning over that evidence and the comparison',
  'qual.stageEligible': 'NVIDIA open-source model, used for {role}, called on {platform}.',
  'qual.stageNotNvidia': '{model} is not an NVIDIA model. It performs visual evidence extraction inside the hybrid pipeline; the qualifying NVIDIA inference is the reasoning stage.',
  'qual.stageUnverified': 'NVIDIA model id, not proven to have produced verified output for this run.',
  'qual.stageDidNotRun': 'This stage did not run, so it contributed nothing to this inspection.',
  'qual.pathMet':
    'Visual evidence is produced by {visionModel} and passed into {qualifyingModel} for '
    + 'construction-specific reasoning. The qualifying NVIDIA inference runs through {platform}.',
  'qual.pathPartial':
    'No qualifying NVIDIA inference completed on this run, so the NVIDIA requirement is reported as '
    + 'PARTIAL rather than met.',
  'qual.pathNotMet':
    'This run contains no NVIDIA open-source inference, so it does not satisfy the NVIDIA requirement.',

  // -- observations --------------------------------------------------------
  'obs.empty': 'No raw observations were returned for this capture.',
  'obs.band': '{value} · {band} band',
  'obs.fullFrame': '(full-frame — the model returned no localized region for this observation)',
  'obs.next': 'Next: {action}',

  // -- capture provenance --------------------------------------------------
  'capture.sourceUpload': 'UPLOAD',
  'capture.sourceDataset': 'LOCAL DATASET',
  'capture.sourceFixture': 'DEMO FIXTURE',
  'capture.titleUpload': 'A photograph supplied by the operator.',
  'capture.titleDataset':
    'A genuine photograph from the local validation dataset, held on this machine only. It is not '
    + 'tracked by git, and it was not captured on the site of this project.',
  'capture.titleFixture': 'A synthetic scene generated in code. Not a photograph, and not evidence of accuracy.',

  // -- human review confirmations -----------------------------------------
  'review.reviewerMissingFinding':
    'REVIEWER NOT CONFIGURED — Set your reviewer identity before recording a human finding decision.',
  'review.reviewerMissingObservation':
    'REVIEWER NOT CONFIGURED — Set your reviewer identity before recording a decision.',
  'review.recorded': 'Finding {status} by {reviewer}.',
  'review.recordedObservation': 'Observation {status} by {reviewer}.',
  'review.lampRecorded': 'Human review recorded',
  'review.confirmed': 'confirmed',
  'review.rejected': 'rejected',
  'review.deferred': 'deferred for review',

  // -- finding card -------------------------------------------------------
  'finding.what': 'WHAT',
  'finding.where': 'WHERE',
  'finding.why': 'WHY FLAGGED',
  'finding.expected': 'EXPECTED',
  'finding.difference': 'DIFFERENCE',
  'finding.confidence': 'CONFIDENCE',
  'finding.action': 'RECOMMENDED ACTION',
  'finding.evidence': 'EVIDENCE',
  'finding.verification': 'VERIFICATION',
  'finding.origin.comparison': 'COMPARISON',
  'finding.origin.visual': 'VISUAL',
  'finding.empty': 'No findings. Run an inspection, or nothing in this capture differs from the reference.',
  'finding.confidenceNote': 'model confidence in its visual reading only',
  'finding.aiPrefix': 'AI FINDING — CONFIDENCE {pct}',
  'finding.settledPrefix': 'HUMAN VERIFIED → {status}',
  'finding.settledBy': 'by {reviewer} at {at}',
  'finding.confirm': 'CONFIRM',
  'finding.reject': 'REJECT',
  'finding.needsReview': 'NEEDS REVIEW',
  'finding.evidence.headFullFrame': 'VISUAL EVIDENCE',
  'finding.evidence.headNone': 'NO VISUAL EVIDENCE',
  'finding.evidence.fullFrame':
    'Full-frame evidence — no localized region returned by the vision model. The finding is '
    + 'supported by the inspected image itself; the evidence is the description above, not a '
    + 'highlighted area.',
  'finding.evidence.none':
    'No usable visual evidence for this finding in this capture. It rests on the expected-state '
    + 'comparison, not on a visual reading of the image.',

  // -- evidence state -----------------------------------------------------
  'evidenceState.LOCALIZED': 'Localized region',
  'evidenceState.FULL_FRAME': 'Full-frame evidence',
  'evidenceState.NONE': 'No visual evidence',

  // -- comparison rows ----------------------------------------------------
  'comparison.empty': 'No expected state loaded, so nothing can be compared.',
  'comparison.expected': 'EXPECTED',
  'comparison.observed': 'OBSERVED',
  'comparison.difference': 'DIFFERENCE',
  'comparison.countBasis': 'COUNT BASIS',
  'comparison.countBasisNote': 'Visual count from one photograph. Not a measured quantity.',
  'comparison.expected.present': '{element} expected ({note})',
  'comparison.expected.presentNoNote': '{element} expected',
  'comparison.expected.absent': 'no {element} expected ({note})',
  'comparison.expected.absentNoNote': 'no {element} expected',
  'comparison.expected.countOne': '{n} {unit} expected ({note})',
  'comparison.expected.countOneNoNote': '{n} {unit} expected',
  'comparison.expected.countMany': '{n} {unitPlural} expected ({note})',
  'comparison.expected.countManyNoNote': '{n} {unitPlural} expected',
  'comparison.observed.notDeterminable': 'not determinable from this capture',
  'comparison.observed.noneSeen': 'none seen in this capture',
  'comparison.observed.absent': 'no {element} detected',
  'comparison.observed.countOne': '{n} {unit} counted',
  'comparison.observed.countMany': '{n} {unitPlural} counted',
  'comparison.observed.present': '{element} detected',
  'comparison.diff.fewer': '{delta} fewer {unitPlural} counted than expected (visual count {observed}, expected {expected})',
  'comparison.diff.more': '{delta} more {unitPlural} counted than expected (visual count {observed}, expected {expected})',
  'comparison.diff.unexpected': '{element} is visible but was not expected in this zone',
  'comparison.diff.missing': '{element} expected but not detected in this capture',

  // -- comparison-derived finding prose -----------------------------------
  'cf.title.undetermined': '{element} not confirmable from this capture',
  'cf.title.count': '{element} count differs from expected',
  'cf.title.unexpected': '{element} present but not expected',
  'cf.title.missing': '{element} expected but not detected',
  'cf.reason.undetermined':
    '{expected}, but the capture does not show enough to confirm or refute it. A single '
    + 'photograph cannot settle this; it stays open pending a walk or a second view.',
  'cf.reason.mismatch': 'Expected {expected}. Observed {observed}.',
  'cf.evidence.localized': 'The model localised this element in the capture; see the highlighted region.',
  'cf.evidence.fullFrame':
    'Full-frame evidence: the finding is supported by the inspected image, but the model did not '
    + 'return a localised region for it.',
  'cf.evidence.none':
    'No visual reading of this element in this capture; the finding rests on the expected-state '
    + 'comparison rather than image evidence.',
  'cf.rec.undetermined':
    'Confirm by physical inspection: walk the zone and record whether {element} is present. Do not '
    + 'treat this as a shortfall until it is verified.',
  'cf.rec.count':
    'Verify the {element} count on site before any corrective work is planned. The figure above is '
    + 'a VISUAL COUNT from one photograph, not a measured quantity.',
  'cf.rec.unexpected':
    'Confirm whether {element} should be in this zone, then decide whether it obstructs the work area.',
  'cf.rec.missing':
    'Inspect the {element} location directly and record whether work is genuinely incomplete.',
  'cf.difference.undetermined': 'Expected {expected}; not determinable from this capture.',

  // -- priorities ---------------------------------------------------------
  'priority.empty': 'No open attention areas. Nothing was flagged, or every flag has already been reviewed.',
  'priority.basis.comparison': 'Expected-state comparison - {pct}% confidence',
  'priority.basis.visual': 'Visual reading - {pct}% confidence',

  // -- reality brief ------------------------------------------------------
  'brief.noneDetected': 'No construction elements were reported in this capture.',
  'brief.countedAcross': '{total} site elements counted across {types} detected types',
  'brief.typesDetected': '{n} construction element types detected (not counted)',
  'brief.deviationsOne': '{n} potential deviation against the expected state',
  'brief.deviationsMany': '{n} potential deviations against the expected state',
  'brief.unsettledOne': '{n} item this capture cannot settle',
  'brief.unsettledMany': '{n} items this capture cannot settle',
  'brief.attentionOne': '{n} expected-state comparison needs attention',
  'brief.attentionMany': '{n} expected-state comparisons need attention',
  'brief.matchedOne': '{n} expected-state check matched',
  'brief.matchedMany': '{n} expected-state checks matched',
  'brief.overallPrefix': 'Overall inspection: {overall}',
  'brief.highestPriority': 'Highest priority: {title}',
  'overall.ATTENTION_REQUIRED': 'ATTENTION REQUIRED',
  'overall.REVIEW_SUGGESTED': 'REVIEW SUGGESTED',
  'overall.NO_ATTENTION': 'NO ATTENTION',

  // -- construction reasoning --------------------------------------------
  'reasoning.notRun':
    'Run the inspection to have Nemotron reason about what the evidence does and does not establish.',
  'reasoning.summary': 'WHAT IT MEANS',
  'reasoning.whatMatters': 'WHAT MATTERS',
  'reasoning.rationale': 'RATIONALE',
  'reasoning.recommendation': 'RECOMMENDATION',
  'reasoning.verification': 'VERIFICATION',
  'reasoning.certainty': 'CERTAINTY',
  'reasoning.modelStated': 'model-stated {value} — not a measurement, not a verification',
  'reasoning.degenerate':
    'WARNING: this answer closely restates the visual observation and adds little reasoning.',
  'reasoning.additional':
    'The reasoning above is additional to the visual observation, not a restatement of it.',
  'reasoning.foot':
    'Nothing has been invented in its place. The comparison above is computed in code and stands '
    + 'on its own.',

  // -- enums --------------------------------------------------------------
  'status.UNVERIFIED': 'UNVERIFIED',
  'status.NEEDS_REVIEW': 'NEEDS REVIEW',
  'status.VERIFIED': 'VERIFIED',
  'status.REJECTED': 'REJECTED',
  'status.OVERRIDDEN': 'OVERRIDDEN',

  // -- stage classification, as shown on the qualification panel ----------
  'elig.ELIGIBLE': 'ELIGIBLE',
  'elig.NOT_ELIGIBLE': 'NOT ELIGIBLE',
  'elig.NOT_VERIFIED': 'NOT VERIFIED',

  // -- model-suggested next action ----------------------------------------
  'action.NO_ACTION': 'no action',
  'action.HUMAN_REVIEW': 'human review',
  'action.INSPECT_CLOSER': 'inspect closer',
  'action.CAPTURE_REFERENCE_PLAN': 'capture the reference plan',
  'action.SCHEDULE_FOLLOW_UP': 'schedule a follow-up',
  'severity.INFO': 'INFORMATIONAL',
  'severity.LOW': 'LOW',
  'severity.MEDIUM': 'MEDIUM',
  'severity.HIGH': 'HIGH',
  'comparisonStatus.MATCH': 'MATCH',
  'comparisonStatus.ATTENTION': 'ATTENTION',
  'comparisonStatus.UNDETERMINED': 'UNDETERMINED',
  'certainty.SUPPORTED': 'SUPPORTED',
  'certainty.UNCERTAIN': 'UNCERTAIN',
  'certainty.INSUFFICIENT_EVIDENCE': 'INSUFFICIENT EVIDENCE',
  'countBasis.VISUAL_COUNT': 'VISUAL COUNT',
  'countBasis.NOT_DETERMINABLE': 'NOT DETERMINABLE',
  'expectation.PRESENT': 'present',
  'expectation.COUNT': 'count',
  'expectation.ABSENT': 'absent',
  'category.DEVIATION': 'DEVIATION',
  'category.MISSING_ELEMENT': 'MISSING ELEMENT',
  'category.INCOMPLETE_WORK': 'INCOMPLETE WORK',
  'category.UNEXPECTED_CONDITION': 'UNEXPECTED CONDITION',
  'category.QUALITY': 'QUALITY',
  'category.COORDINATION': 'COORDINATION',
  'category.SAFETY_ATTENTION': 'SAFETY ATTENTION',
  'category.UNDETERMINED': 'UNDETERMINED',

  // -- element vocabulary -------------------------------------------------
  'element.COLUMN': 'column',
  'element.SLAB': 'slab',
  'element.WALL': 'wall',
  'element.OPENING': 'opening',
  'element.MEP_ROUGH_IN': 'MEP rough-in',
  'element.FORMWORK': 'formwork',
  'element.SCAFFOLD': 'scaffold',
  'element.EQUIPMENT': 'equipment',
  'element.WORKER': 'worker',
  'element.REBAR': 'rebar',
  'element.FINISH': 'finish',
  'element.EXCAVATION': 'excavation',
  'elementPlural.COLUMN': 'columns',
  'elementPlural.SLAB': 'slabs',
  'elementPlural.WALL': 'walls',
  'elementPlural.OPENING': 'openings',
  'elementPlural.MEP_ROUGH_IN': 'MEP rough-ins',
  'elementPlural.FORMWORK': 'formworks',
  'elementPlural.SCAFFOLD': 'scaffolds',
  'elementPlural.EQUIPMENT': 'equipment',
  'elementPlural.WORKER': 'workers',
  'elementPlural.REBAR': 'rebar',
  'elementPlural.FINISH': 'finishes',
  'elementPlural.EXCAVATION': 'excavations',
} satisfies Catalog;

type TranslationKey = keyof typeof EN;

const FR: Record<TranslationKey, string> = {
  // -- selection messages --------------------------------------------------
  'imgs.restored': "Restauré le dernier contrôle de cette photo. Relancez pour une lecture fraîche.",
  'imgs.selected': 'Photo sélectionnée. Appuyez sur Inspecter la réalité pour l\'analyser.',
  'imgs.restoredShort': 'Photo sélectionnée ; dernier contrôle affiché.',
  'imgs.selectedShort': 'Photo sélectionnée.',
  'imgs.selectFailed': 'La photo n\'a pas pu être sélectionnée',
  // -- photographs, run and attribution (multi-image) ------------------------
  'imgs.head': 'Photos de l\'inspection',
  'imgs.count': '{count} photos',
  'imgs.countZero': 'aucune photo ouverte',
  'imgs.note': 'Toutes sont analys\u00e9es comme UNE seule inspection. Un d\u00e9saccord entre photos est signal\u00e9 comme tel, jamais additionn\u00e9.',
  'imgs.addMore': 'Ajouter des photos',
  'imgs.remove': 'Retirer',
  'imgs.inspect': 'Inspecter la r\u00e9alit\u00e9',
  'imgs.added': '{count} photo(s) ajout\u00e9e(s) \u00e0 {project}. Inspectez quand vous voulez.',
  'imgs.duplicates': '{count} photo(s) sur {total} \u00e9taient des doublons identiques et ont \u00e9t\u00e9 refus\u00e9es, non ignor\u00e9es.',
  'imgs.partial': '{accepted} ajout\u00e9e(s), {refused} refus\u00e9e(s).',
  'imgs.reading': 'Lecture de la photo {index} sur {total}',
  'imgs.readFailed': 'Ce fichier n\'a pas pu \u00eatre lu.',
  'imgs.rejected': 'Photos refus\u00e9es',
  'imgs.loaded': '{count} photo(s) charg\u00e9e(s) \u2014 inspectez quand vous voulez',
  'imgs.ready': 'Photos pr\u00eates',
  'imgs.noneOpen': 'Ouvrez au moins une photo avant d\'inspecter.',
  'imgs.ordinal': '{index}',
  'imgs.dropOne': 'Retirer {label} de cette inspection',
  'imgs.status.ready': 'PR\u00caTE',
  'imgs.status.done': 'ANALYS\u00c9E',
  'imgs.status.failed': '\u00c9CHEC',
  'imgs.obsCount': '{count} observation(s)',
  'imgs.basisPending': 'Aucune inspection n\'a encore \u00e9t\u00e9 lanc\u00e9e sur ces photos.',
  'imgs.basisPartial': '{failed} photo(s) ont \u00e9chou\u00e9 et n\'ont fourni aucune preuve. Cette inspection repose sur {analysed} photo(s).',

  // -- the evidence stage, and the reviewer gate -----------------------------
  'imgs.evidencePhotos': 'Photos de l\'inspection :',
  'imgs.evidenceBasedOn': 'une seule inspection, {count} photos',
  'imgs.selectAll': 'Tout s\u00e9lectionner',
  'imgs.clear': 'Effacer',
  'gate.required': 'REVIEWER REQUIS',
  'gate.reason': 'Nommez le correcteur de l\'inspection pour enregistrer une v\u00e9rification humaine. Tant qu\'il n\'est pas nomm\u00e9, chaque constatation reste NON V\u00c9RIFI\u00c9E.',
  'gate.setup': 'CONFIGURER LE CORRECTEUR',
  'imgs.allOpen': 'Toutes les captures de ce projet sont d\u00e9j\u00e0 ouvertes en une seule inspection.',
  'run.working': 'ANALYSE DE LA R\u00c9ALIT\u00c9',
  'run.brief': 'ANALYSE DE LA R\u00c9ALIT\u00c9 \u2014 MiniCPM lit {count} photo(s) une par une, la comparaison est calcul\u00e9e en code, puis Nemotron raisonne une fois sur les preuves combin\u00e9es.',
  'run.notify': 'Inspection en cours sur {count} photo(s) : inf\u00e9rence vision r\u00e9elle par photo, une comparaison d\u00e9terministe, puis un seul passage de raisonnement Nemotron.',
  'run.elapsed': 'EN COURS \u2014 {secs}s \u00e9coul\u00e9es, {count} photo(s) \u00e0 analyser. Aucun signal de progression par \u00e9tape, seulement le temps \u00e9coul\u00e9.',
  'run.done': '{how} termin\u00e9 en {secs}s. {findings} constat(s), tous NON V\u00c9RIFI\u00c9S et en attente d\'une d\u00e9cision humaine nomm\u00e9e.',
  'run.readyLamp': 'CONSTATATS PR\u00cETS \u2014 en attente de revue humaine',
  'run.partialLamp': 'PARTIEL \u2014 certaines photos ont \u00e9chou\u00e9',
  'run.partial': 'INSPECTION PARTIELLE : {analysed} photo(s) analys\u00e9e(s), {failed} en \u00e9chec ({names}). Les photos en \u00e9chec n\'ont rien fourni.',
  'run.withReasoning': '{how} : {overall}. Raisonnement Nemotron : {certainty}. Rien n\'est encore v\u00e9rifi\u00e9.',
  'run.noReasoning': '{how} : {overall}. RAISONNEMENT DE CHANTIER INDISPONIBLE ({kind}) \u2014 la comparaison ci-dessous reste valable et rien n\'a \u00e9t\u00e9 invent\u00e9 \u00e0 sa place.',
  'run.plainDone': '{how} : {overall}. Rien n\'est encore v\u00e9rifi\u00e9.',
  'origin.cached': 'R\u00c9SULTAT IA EN CACHE (inf\u00e9rence pr\u00e9c\u00e9dente)',
  'origin.fixture': 'FIXTURE DE D\u00c9MO',
  'origin.fresh': 'INF\u00c9RENCE IA R\u00c9ELLE',
  'obs.from': 'depuis {label}',
  'imgs.countAtCap': '{count} photos \u2014 le maximum pour une inspection',
  'meta.zone': 'ZONE',
  'meta.capture': 'CAPTURE',
  'meta.captureHint': 'photos ouvertes',
  'meta.reviewer': 'RELECTEUR',
  'meta.stateReady': 'Capture pr\u00eate',
  'meta.vision': 'Vision',
  'meta.reasoning': 'Raisonnement',
  'meta.source': 'Source',
  'proj.label': 'Projet',
  'proj.new': 'Nouveau projet',
  'tab.capture': 'Capture',
  'tab.inspect': 'Inspection',
  'tab.evidence': 'Preuves',
  'tab.findings': 'Constats',
  'qual.met': 'SATISFAIT',
  'qual.partial': 'PARTIEL',
  'qual.hybrid': 'Pipeline d\u2019inference hybride',
  'qual.pipeline': 'Pipeline d\u2019inference',
  'qual.unavailable': 'Indisponible',
  'qual.row.vision': '\u00c9tape vision',
  'qual.row.reasoning': 'Raisonnement de chantier',
  'qual.row.platform': 'Plateforme d\u2019inference',
  'qual.tag.vision': 'MOD\u00c8LE NVIDIA \u00b7 {role}',
  'qual.tag.vision.not': 'NON UN MOD\u00c8LE NVIDIA \u00b7 {role}',
  'qual.tag.reasoning': 'MOD\u00c8LE NVIDIA, QUALIFIANT \u00b7 {role}',
  'qual.tag.reasoning.not': 'N\u2019EST PAS L\u2019INF\u00c9RENCE QUALIFIANTE \u00b7 {role}',
  'qual.tag.platform': 'Appel\u00e9 via cette plateforme',
  'qual.tag.platform.not': 'Aucune plateforme pour cette \u00e9tape',
  'lang.label': "Langue de l'inspection",
  'lang.hint': "Présentation seule. L'inspection, ses preuves et sa provenance sont inchangées.",
  'lang.sourceEnglish': 'Rédigé par le modèle en anglais — affiché sans traduction',
  'lang.canonicalBadge': 'DONNÉES CANONIQUES INCHANGÉES',
  'tr.viewOriginal': 'Voir l’original',
  'tr.viewTranslation': 'Voir la traduction',
  'tr.translatedBadge': 'Traduit de l’anglais',
  'tr.fallbackNote': 'Traduction indisponible — texte d’origine affiché',
  'skip.capture': 'Aller \u00e0 la capture',
  'aria.projects': 'Projets',
  'aria.workflow': 'Flux de travail',
  'aria.pipeline': 'Cha\u00eene de mod\u00e8les',
  'aria.summary': 'R\u00e9sum\u00e9 de l\'inspection',
  'aria.drop': 'D\u00e9posez une capture PNG ou JPEG ici, ou appuyez sur Entr\u00e9e pour choisir un fichier',
  'ident.cacheToggleTitle': 'R\u00e9utilise un r\u00e9sultat IA pr\u00e9c\u00e9dent pour cette image exacte au lieu de payer \u00e0 nouveau la latence du mod\u00e8le. Les r\u00e9sultats en cache sont \u00e9tiquet\u00e9s.',
  'img.captureAlt': 'Capture de chantier en cours d\'inspection',
  'img.evidenceAlt': 'Capture de r\u00e9alit\u00e9 du chantier avec les r\u00e9gions de preuve',
  'reviewer.namePh': 'ex. Takou Rah',
  'reviewer.rolePh': 'ex. Ing\u00e9nieur de chantier',
  'panel.notePh': 'note de revue facultative',
  'foot.thesis': 'L\'IA ne remplace pas l\'inspecteur. Elle lui dit o\u00f9 regarder en premier.',
  'foot.local': 'Surface d\'inspection locale. Boucle locale uniquement.',

  'prov.provider': 'Fournisseur',
  'prov.model': 'Modèle',
  'prov.inferenceExecuted': 'Inférence exécutée',
  'prov.elementsDetected': 'Éléments détectés',
  'prov.observationsAccepted': 'Observations acceptées',
  'prov.observationsRejected': 'Observations rejetées',
  'prov.latency': 'Latence',
  'prov.capturedAt': 'Capturé le',
  'prov.humanReview': 'Revue humaine effectuée',
  'prov.yes': 'oui',
  'prov.no': 'non',
  'prov.restored': 'non — résultat restauré depuis le disque',
  'prov.notRerun': 'non réexécuté',
  'prov.geometry':
    "Ce fichier source portait l'orientation EXIF {n}. Ses pixels ont été normalisés en orientation 1 "
    + "avant l'inspection : le modèle, l'affichage et la surcouche de preuve utilisent donc un seul "
    + 'repère. Aucune image n’a été réencodée.',
  'prov.geometryStored': 'Enregistré {sw}×{sh}, affiché {dw}×{dh}.',
  'prov.failedHead': 'INSPECTION ÉCHOUÉE ({kind})',
  'prov.partialHead': 'INSPECTION PARTIELLE',
  'pipe.partial': '{analysed} photo(s) analys\u00e9e(s) sur {total}, les autres ont \u00e9chou\u00e9 et n\u2019ont fourni rien',
  'prov.rejectedHead': '{n} ENTRÉES DU MODÈLE REJETÉES PAR LA VALIDATION',

  'fail.timeout': "Le fournisseur d'IA a expiré. Le modèle n'a pas répondu à temps ; aucun résultat n'a été produit.",
  'fail.unavailable': "Impossible de joindre le fournisseur d'IA (réseau ou erreur serveur). Aucun résultat n'a été produit.",
  'fail.authentication': "Le fournisseur d'IA a rejeté le credential (échec d'authentification). Vérifiez NEBIUS_API_KEY.",
  'fail.rateLimited': "Le fournisseur d'IA a limité le débit de cette requête. Patientez un instant et relancez.",
  'fail.notConfigured': "Aucun fournisseur d'IA n'est configuré ; aucune inspection n'a été effectuée.",
  'fail.malformed': "La réponse du fournisseur d'IA est illisible. Aucun résultat n'a été produit.",
  'fail.error': "L'inspection a échoué. Aucun résultat n'a été produit.",

  'header.cached': 'RÉSULTAT IA EN CACHE — inférence du {at}',
  'header.cachedEarlier': 'une exécution antérieure',
  'header.liveInference': 'inférence en direct',

  'intro.pending': "Le modèle n'a encore rien reçu.",
  'intro.failed': "La dernière inspection ne s'est pas terminée — voir la note d'échec ci-dessous.",
  'intro.cached': "Inspection restaurée de cette capture. Relancez l'inspection pour une lecture fraîche.",
  'intro.fresh': 'Inférence terminée — les constatations attendent la décision d\u2019une personne nommée.',
  'intro.idle': 'Photographiez le chantier, puis lancez l\u2019inspection.',

  'rail.pending': '{pending} en attente de revue, {verified} vérifiées',
  'rail.reality': 'RÉALITÉ',
  'rail.inspection': 'INSPECTION',
  'rail.findings': 'CONSTATATIONS',
  'rail.confidence': 'CONFIANCE',
  'rail.overall': 'GLOBAL',
  'rail.elementsDetected': 'éléments détectés',
  'rail.attentionAreas': 'zones d\u2019attention',
  'rail.awaitingReview': 'en attente de revue',
  'rail.highestFinding': 'constatation la plus élevée',

  'panel.realityBrief': 'Synthèse de la réalité',
  'panel.priorities': "Priorités d'inspection",
  'panel.whereToLook': 'OÙ REGARDER',
  'panel.provenance': 'Provenance et \u00e9ligibilit\u00e9',
  'panel.realityEvidence': 'Réalité et preuves',
  'panel.evidenceHint': 'Sélectionnez une constatation pour voir où elle a été relevée sur le chantier.',
  'panel.reviewer': 'INSPECTEUR RÉFÉRENT',
  'panel.reviewerUnset': 'Non configuré',
  'panel.setReviewer': 'Définir l\u2019inspecteur',
  'panel.changeReviewer': 'Modifier l\u2019inspecteur',
  'panel.reviewerUnsetMeta': 'Non défini',
  'panel.verificationNote': 'Note de vérification',
  'panel.trustSuspected': 'IA_SUSPECTÉE',
  'panel.trustUnverified': 'NON VÉRIFIÉ',
  'panel.trustNote': 'La confiance ne se vérifie jamais elle-même.',
  'panel.findingsAndVerification': 'Constatations et vérification',
  'panel.findingsHint': 'Chaque constatation issue de l\u2019IA exige une personne nommée pour confirmer, rejeter ou différer.',
  'panel.nvidiaRequirement': 'Exigence NVIDIA',
  'panel.inspection': 'Inspection',
  'panel.prioritiesHint': "Où votre inspecteur doit regarder en premier. Ce ne sont pas des verdicts.",
  'panel.trustTo': 'vers',
  'stage.noCapture': 'Aucune capture chargée.',
  'panel.stageReasoningHeading': 'Raisonnement de chantier',
  'panel.stageReasoningNotRun': 'NON EXÉCUTÉ',

  'pipe.notRun': 'pas encore exécuté',
  'pipe.awaitingInspection': 'en attente de la première inspection',
  'pipe.nothingVerified': 'rien de vérifié',
  'pipe.didNotComplete': 'inachevé — {kind}',
  'pipe.syntheticFixture': 'fixture synthétique, pas une inférence IA',
  'pipe.restoredResult': 'résultat restauré, pas un appel frais',
  'pipe.visionCounts': '{elements} élément(s), {observations} observation(s) en {ms} ms',
  'pipe.compareEngine': 'Moteur déterministe SiteLens (src/compare.ts)',
  'pipe.noExpectedState': 'aucun état attendu chargé',
  'pipe.compareCounts': '{matched} conforme · {attention} attention · {undetermined} indéterminé',
  'pipe.degenerate': 'apporte peu à la lecture visuelle',
  'pipe.verifyPending': 'rien de vérifié — {n} en attente d\u2019une personne nommée',
  'pipe.verifyCounts': '{verified} vérifiées · {rejected} rejetées',

  'reason.stageLabel': 'ÉTAPE 2 · NEMOTRON',
  'reason.noConfidence': 'aucune confiance indiquée',
  'reason.footPrefix': 'A raisonné sur {detections} élément(s) détecté(s) et {rows} ligne(s) de comparaison',
  'reason.footCached': ', restauré avec l\u2019inspection d\u2019origine',
  'reason.footLive': ' en {ms} ms',
  'reason.noneProduced': "Aucun raisonnement de chantier n'a été produit pour cette capture.",
  'reason.unavailableHead': 'RAISONNEMENT DE CHANTIER INDISPONIBLE',

  'qual.notMet': 'NON SATISFAITE',
  'qual.noQualifying': 'aucune inférence NVIDIA admissible sur cette exécution',
  'qual.qualifyingStage': ' · étape admissible : {stage}',
  'qual.stageReasoning': 'raisonnement de chantier (Nemotron)',
  'qual.stageVision': 'analyse visuelle',
  'qual.nvidiaModel': 'MODÈLE NVIDIA',
  'qual.notNvidiaModel': 'NON UN MODÈLE NVIDIA',
  'qual.visionHead': 'ÉTAPE VISUELLE :',
  'qual.reasoningHead': 'ÉTAPE RAISONNEMENT :',
  'qual.roleVision': 'Extraction des preuves visuelles sur la photographie du chantier',
  'qual.roleReasoning': 'Raisonnement de chantier sur ces preuves et sur la comparaison',
  'qual.stageEligible': 'Modèle open source NVIDIA, utilisé pour {role}, appelé sur {platform}.',
  'qual.stageNotNvidia':
    '{model} n\u2019est pas un modèle NVIDIA. Il assure l\u2019extraction des preuves visuelles dans le '
    + 'pipeline hybride ; l\u2019inférence NVIDIA admissible est celle de l\u2019étape de raisonnement.',
  'qual.stageUnverified':
    'Identifiant de modèle NVIDIA, dont aucune sortie vérifiée n\u2019a été produite pour cette exécution.',
  'qual.stageDidNotRun': 'Cette étape ne s\u2019est pas exécutée ; elle n\u2019a rien apporté à cette inspection.',
  'qual.pathMet':
    'Les preuves visuelles sont produites par {visionModel} puis transmises à {qualifyingModel} pour '
    + 'un raisonnement spécifique au chantier. L\u2019inférence NVIDIA admissible s\u2019exécute via {platform}.',
  'qual.pathPartial':
    'Aucune inférence NVIDIA admissible ne s\u2019est terminée sur cette exécution ; l\u2019exigence NVIDIA '
    + 'est donc déclarée PARTIELLE et non satisfaite.',
  'qual.pathNotMet':
    'Cette exécution ne contient aucune inférence open source NVIDIA ; elle ne satisfait donc pas '
    + 'l\u2019exigence NVIDIA.',

  'obs.empty': "Aucune observation brute n'a été renvoyée pour cette capture.",
  'obs.band': '{value} · bande {band}',
  'obs.fullFrame': '(plein cadre — le modèle n\u2019a renvoyé aucune zone localisée pour cette observation)',
  'obs.next': 'Suivant : {action}',

  'capture.sourceUpload': 'TÉLÉVERSEMENT',
  'capture.sourceDataset': 'JEU LOCAL',
  'capture.sourceFixture': 'FIXTURE DE DÉMO',
  'capture.titleUpload': 'Photographie fournie par l\u2019opérateur.',
  'capture.titleDataset':
    "Photographie authentique issue du jeu de validation local, conservée uniquement sur cette machine. "
    + "Elle n'est pas suivie par git et n'a pas été prise sur le chantier de ce projet.",
  'capture.titleFixture':
    'Scène synthétique générée en code. Ce n\u2019est pas une photographie, et ce n\u2019est pas une preuve d\u2019exactitude.',

  'review.reviewerMissingFinding':
    "INSPECTEUR NON CONFIGURÉ — Définissez l'identité de l'inspecteur avant d'enregistrer une décision humaine.",
  'review.reviewerMissingObservation':
    "INSPECTEUR NON CONFIGURÉ — Définissez l'identité de l'inspecteur avant d'enregistrer une décision.",
  'review.recorded': 'Constatation {status} par {reviewer}.',
  'review.recordedObservation': 'Observation {status} par {reviewer}.',
  'review.lampRecorded': 'Revue humaine enregistrée',
  'review.confirmed': 'confirmée',
  'review.rejected': 'rejetée',
  'review.deferred': 'différée pour revue',

  'finding.what': 'CONSTAT',
  'finding.where': 'OÙ',
  'finding.why': 'MOTIF DU SIGNALEMENT',
  'finding.expected': 'ATTENDU',
  'finding.difference': 'ÉCART',
  'finding.confidence': 'CONFIANCE',
  'finding.action': 'ACTION RECOMMANDÉE',
  'finding.evidence': 'PREUVE',
  'finding.verification': 'VÉRIFICATION',
  'finding.origin.comparison': 'COMPARAISON',
  'finding.origin.visual': 'VISUEL',
  'finding.empty': "Aucune constatation. Lancez une inspection, ou rien dans cette capture ne s'écarte de la référence.",
  'finding.confidenceNote': "confiance du modèle dans sa seule lecture visuelle",
  'finding.aiPrefix': 'CONSTATATION IA — CONFIANCE {pct}',
  'finding.settledPrefix': 'VÉRIFIÉ PAR UN HUMAIN → {status}',
  'finding.settledBy': 'par {reviewer} le {at}',
  'finding.confirm': 'CONFIRMER',
  'finding.reject': 'REJETER',
  'finding.needsReview': 'À REVOIR',
  'finding.evidence.headFullFrame': 'PREUVE VISUELLE',
  'finding.evidence.headNone': 'AUCUNE PREUVE VISUELLE',
  'finding.evidence.fullFrame':
    "Preuve en pleine image — le modèle de vision n'a renvoyé aucune zone localisée. La constatation "
    + "s'appuie sur l'image inspectée elle-même ; la preuve est la description ci-dessus, et non une zone mise en évidence.",
  'finding.evidence.none':
    "Aucune preuve visuelle exploitable pour cette constatation dans cette capture. Elle repose sur la "
    + "comparaison avec l'état attendu, et non sur une lecture visuelle de l'image.",

  'evidenceState.LOCALIZED': 'Zone localisée',
  'evidenceState.FULL_FRAME': 'Preuve en pleine image',
  'evidenceState.NONE': 'Aucune preuve visuelle',

  'comparison.empty': "Aucun état attendu chargé : rien ne peut être comparé.",
  'comparison.expected': 'ATTENDU',
  'comparison.observed': 'OBSERVÉ',
  'comparison.difference': 'ÉCART',
  'comparison.countBasis': 'BASE DU DÉCOMPTE',
  'comparison.countBasisNote': "Décompte visuel sur une seule photographie. Ce n'est pas une quantité mesurée.",
  'comparison.expected.present': '{element} attendu ({note})',
  'comparison.expected.presentNoNote': '{element} attendu',
  'comparison.expected.absent': 'aucun {element} attendu ({note})',
  'comparison.expected.absentNoNote': 'aucun {element} attendu',
  'comparison.expected.countOne': '{n} {unit} attendu ({note})',
  'comparison.expected.countOneNoNote': '{n} {unit} attendu',
  'comparison.expected.countMany': '{n} {unitPlural} attendus ({note})',
  'comparison.expected.countManyNoNote': '{n} {unitPlural} attendus',
  'comparison.observed.notDeterminable': 'non déterminable à partir de cette capture',
  'comparison.observed.noneSeen': "aucun élément visible dans cette capture",
  'comparison.observed.absent': 'aucun {element} détecté',
  'comparison.observed.countOne': '{n} {unit} compté',
  'comparison.observed.countMany': '{n} {unitPlural} comptés',
  'comparison.observed.present': '{element} détecté',
  'comparison.diff.fewer':
    '{delta} {unitPlural} en moins comptés que prévu (décompte visuel {observed}, prévu {expected})',
  'comparison.diff.more':
    '{delta} {unitPlural} en plus comptés que prévu (décompte visuel {observed}, prévu {expected})',
  'comparison.diff.unexpected': "{element} visible alors qu'il n'était pas prévu dans cette zone",
  'comparison.diff.missing': "{element} attendu mais non détecté dans cette capture",

  'cf.title.undetermined': '{element} non confirmable sur cette capture',
  'cf.title.count': "Le décompte de {element} diffère de l'attendu",
  'cf.title.unexpected': '{element} présent alors que non attendu',
  'cf.title.missing': '{element} attendu mais non détecté',
  'cf.reason.undetermined':
    "{expected}, mais la capture ne montre pas assez pour confirmer ou infirmer. Une seule photographie "
    + "ne peut trancher : le point reste ouvert jusqu'à une visite ou une seconde vue.",
  'cf.reason.mismatch': 'Attendu : {expected}. Observé : {observed}.',
  'cf.evidence.localized':
    "Le modèle a localisé cet élément dans la capture ; voir la zone mise en évidence.",
  'cf.evidence.fullFrame':
    "Preuve en pleine image : la constatation s'appuie sur l'image inspectée, mais le modèle n'a pas "
    + 'renvoyé de zone localisée.',
  'cf.evidence.none':
    "Aucune lecture visuelle de cet élément dans cette capture ; la constatation repose sur la "
    + "comparaison avec l'état attendu plutôt que sur une preuve image.",
  'cf.rec.undetermined':
    "À confirmer par inspection physique : parcourir la zone et consigner la présence de {element}. "
    + "Ne pas traiter cela comme un manque avant vérification.",
  'cf.rec.count':
    "Vérifier le décompte de {element} sur site avant de planifier toute reprise. Le chiffre ci-dessus "
    + "est un DÉCOMPTE VISUEL issu d'une seule photographie, et non une quantité mesurée.",
  'cf.rec.unexpected':
    "Confirmer si {element} doit se trouver dans cette zone, puis décider si cela gêne la zone de travail.",
  'cf.rec.missing':
    "Inspecter directement l'emplacement de {element} et consigner si le travail est réellement incomplet.",
  'cf.difference.undetermined': 'Attendu : {expected} ; non déterminable à partir de cette capture.',

  'priority.empty':
    "Aucune zone d'attention ouverte. Rien n'a été signalé, ou chaque signalement a déjà été examiné.",
  'priority.basis.comparison': "Comparaison avec l'état attendu — confiance {pct} %",
  'priority.basis.visual': 'Lecture visuelle — confiance {pct} %',

  'brief.noneDetected': "Aucun élément de construction n'a été rapporté dans cette capture.",
  'brief.countedAcross': '{total} éléments de chantier décomptés sur {types} types détectés',
  'brief.typesDetected': '{n} types d’élément de construction détectés (non décomptés)',
  'brief.deviationsOne': '{n} écart potentiel par rapport à l’état attendu',
  'brief.deviationsMany': '{n} écarts potentiels par rapport à l’état attendu',
  'brief.unsettledOne': '{n} point que cette capture ne peut trancher',
  'brief.unsettledMany': '{n} points que cette capture ne peut trancher',
  'brief.attentionOne': '{n} comparaison avec l’état attendu demande votre attention',
  'brief.attentionMany': '{n} comparaisons avec l’état attendu demandent votre attention',
  'brief.matchedOne': '{n} vérification conforme à l’état attendu',
  'brief.matchedMany': '{n} vérifications conformes à l’état attendu',
  'brief.overallPrefix': 'Inspection globale : {overall}',
  'brief.highestPriority': 'Priorité maximale : {title}',
  'overall.ATTENTION_REQUIRED': 'ATTENTION REQUISE',
  'overall.REVIEW_SUGGESTED': 'EXAMEN SUGGÉRÉ',
  'overall.NO_ATTENTION': 'AUCUNE ATTENTION REQUISE',

  'reasoning.notRun':
    "Lancez l'inspection pour que Nemotron raisonne sur ce que les preuves établissent et n'établissent pas.",
  'reasoning.summary': 'CE QUE CELA SIGNIFIE',
  'reasoning.whatMatters': 'CE QUI DÉTERMINE',
  'reasoning.rationale': 'RAISONNEMENT',
  'reasoning.recommendation': 'RECOMMANDATION',
  'reasoning.verification': 'VÉRIFICATION',
  'reasoning.certainty': 'CERTITUDE',
  'reasoning.modelStated': 'indiqué par le modèle : {value} — ni une mesure, ni une vérification',
  'reasoning.degenerate':
    "AVERTISSEMENT : cette réponse reprend étroitement l'observation visuelle et n'apporte que peu de raisonnement.",
  'reasoning.additional':
    "Le raisonnement ci-dessus s'ajoute à l'observation visuelle ; il ne la récite pas.",
  'reasoning.foot':
    "Rien n'a été inventé à sa place. La comparaison ci-dessus est calculée en code et tient debout seule.",

  'status.UNVERIFIED': 'NON VÉRIFIÉ',
  'status.NEEDS_REVIEW': 'À REVOIR',
  'status.VERIFIED': 'VÉRIFIÉ',
  'status.REJECTED': 'REJETÉ',
  'status.OVERRIDDEN': 'REMPLACÉ',

  'elig.ELIGIBLE': 'ADMISSIBLE',
  'elig.NOT_ELIGIBLE': 'NON ADMISSIBLE',
  'elig.NOT_VERIFIED': 'NON VÉRIFIÉ',

  'action.NO_ACTION': 'aucune action',
  'action.HUMAN_REVIEW': 'revue humaine',
  'action.INSPECT_CLOSER': 'inspection rapprochée',
  'action.CAPTURE_REFERENCE_PLAN': 'relever le plan de référence',
  'action.SCHEDULE_FOLLOW_UP': 'planifier un suivi',
  'severity.INFO': 'INFORMATIF',
  'severity.LOW': 'FAIBLE',
  'severity.MEDIUM': 'MOYENNE',
  'severity.HIGH': 'ÉLEVÉE',
  'comparisonStatus.MATCH': 'CONFORME',
  'comparisonStatus.ATTENTION': 'ATTENTION',
  'comparisonStatus.UNDETERMINED': 'INDÉTERMINÉ',
  'certainty.SUPPORTED': 'ÉTAYÉ',
  'certainty.UNCERTAIN': 'INCERTAIN',
  'certainty.INSUFFICIENT_EVIDENCE': 'PREUVES INSUFFISANTES',
  'countBasis.VISUAL_COUNT': 'DÉCOMPTE VISUEL',
  'countBasis.NOT_DETERMINABLE': 'NON DÉTERMINABLE',
  'expectation.PRESENT': 'présent',
  'expectation.COUNT': 'décompte',
  'expectation.ABSENT': 'absent',
  'category.DEVIATION': 'ÉCART',
  'category.MISSING_ELEMENT': 'ÉLÉMENT MANQUANT',
  'category.INCOMPLETE_WORK': 'TRAVAUX INCOMPLETS',
  'category.UNEXPECTED_CONDITION': 'ÉTAT INATTENDU',
  'category.QUALITY': 'QUALITÉ',
  'category.COORDINATION': 'COORDINATION',
  'category.SAFETY_ATTENTION': 'ATTENTION SÉCURITÉ',
  'category.UNDETERMINED': 'INDÉTERMINÉ',

  'element.COLUMN': 'poteau',
  'element.SLAB': 'dalle',
  'element.WALL': 'mur',
  'element.OPENING': 'ouverture',
  'element.MEP_ROUGH_IN': 'réseau MEP',
  'element.FORMWORK': 'coffrage',
  'element.SCAFFOLD': 'échafaudage',
  'element.EQUIPMENT': 'engin',
  'element.WORKER': 'ouvrier',
  'element.REBAR': 'ferraillage',
  'element.FINISH': 'finition',
  'element.EXCAVATION': 'fouille',
  'elementPlural.COLUMN': 'poteaux',
  'elementPlural.SLAB': 'dalles',
  'elementPlural.WALL': 'murs',
  'elementPlural.OPENING': 'ouvertures',
  'elementPlural.MEP_ROUGH_IN': 'réseaux MEP',
  'elementPlural.FORMWORK': 'coffrages',
  'elementPlural.SCAFFOLD': 'échafaudages',
  'elementPlural.EQUIPMENT': 'engins',
  'elementPlural.WORKER': 'ouvriers',
  'elementPlural.REBAR': 'ferraillages',
  'elementPlural.FINISH': 'finitions',
  'elementPlural.EXCAVATION': 'fouilles',
};

const AR: Record<TranslationKey, string> = {
  // -- selection messages --------------------------------------------------
  'imgs.restored': 'أُعيد آخر فحص لهذه الصورة. أعد الفحص للحصول على قراءة جديدة.',
  'imgs.selected': 'تم اختيار الصورة. اضغط فحص الواقع لتحليلها.',
  'imgs.restoredShort': 'تم اختيار الصورة؛ يُعرض آخر فحص لها.',
  'imgs.selectedShort': 'تم اختيار الصورة.',
  'imgs.selectFailed': 'تعذّر اختيار الصورة',
  // -- photographs, run and attribution (multi-image) ------------------------
  'imgs.head': 'صور الفحص',
  'imgs.count': '{count} صورة',
  'imgs.countZero': 'لا صورة مفتوحة',
  'imgs.note': 'تُحلَّل كلها كفحص واحد. أي اختلاف بين الصور يُبلَّغ عنه كاختلاف ولا يُجمع أبدًا.',
  'imgs.addMore': 'إضافة صور',
  'imgs.remove': 'إزالة',
  'imgs.inspect': 'فحص الواقع',
  'imgs.added': 'أُضيفت {count} صورة إلى {project}. افحص عندما تكون جاهزًا.',
  'imgs.duplicates': '{count} من أصل {total} صورة محددة كانت مكررة ومطابقة تمامًا وقد رُفضت ولم تُتجاهل بصمت.',
  'imgs.partial': 'أُضيفت {accepted}، ورُفضت {refused}.',
  'imgs.reading': 'قراءة الصورة {index} من {total}',
  'imgs.readFailed': 'تعذّرت قراءة هذا الملف.',
  'imgs.rejected': 'صور مرفوضة',
  'imgs.loaded': 'تم تحميل {count} صورة — افحص عندما تكون جاهزًا',
  'imgs.ready': 'الصور جاهزة',
  'imgs.noneOpen': 'افتح صورة واحدة على الأقل قبل الفحص.',
  'imgs.ordinal': '{index}',
  'imgs.dropOne': 'إزالة {label} من هذا الفحص',
  'imgs.status.ready': 'جاهزة',
  'imgs.status.done': 'تم تحليلها',
  'imgs.status.failed': 'فشل',
  'imgs.obsCount': '{count} ملاحظة',
  'imgs.basisPending': 'لم يُنفَّذ فحص لهذه الصور.',
  'imgs.basisPartial': 'فشلت {failed} صورة ولم تُقدم أي دليل. يقوم هذا الفحص على {analysed} صورة.',

  // -- the evidence stage, and the reviewer gate -----------------------------
  'imgs.evidencePhotos': 'صور الفحص:',
  'imgs.evidenceBasedOn': 'فحص واحد، {count} صورة',
  'imgs.selectAll': 'تحديد الكل',
  'imgs.clear': 'إزالة التحديد',
  'gate.required': 'مراجع مطلوب',
  'gate.reason': 'حدّد اسم مراجع الفحص لتسجيل تحقق بشري. حتى ذلك الحين تبقى كل النتائج غير محققة.',
  'gate.setup': 'إعداد مراجع',
  'imgs.allOpen': 'جميع لقطات هذا المشروع مفتوحة بالفعل كفحص واحد.',
  'run.working': 'جارٍ تحليل الواقع',
  'run.brief': 'تحليل الواقع — يقرأ MiniCPM {count} صورة واحدة تلو الأخرى، وتُحسب المقارنة في الكود، ثم يستنتج Nemotron مرة واحدة حول الأدلة المجمعة.',
  'run.notify': 'فحص جارٍ على {count} صورة: استدلال بصري حقيقي لكل صورة، ومقارنة حتمية واحدة، ثم تمريرة استنتاج Nemotron واحدة.',
  'run.elapsed': 'قيد التشغيل — مضى {secs} ثانية، {count} صورة للتحليل. لا يوجد مؤشر تقدم لكل مرحلة، فقط الزمن المنقضي.',
  'run.done': 'اكتمل {how} خلال {secs} ثانية. {findings} ملاحظة، جميعها غير مُتحقق منها وتنتظر قرارًا بشريًا مُسمّى.',
  'run.readyLamp': 'الملاحظات جاهزة — بانتظار مراجعة بشرية',
  'run.partialLamp': 'جزئي — فشلت بعض الصور',
  'run.partial': 'فحص جزئي: تم تحليل {analysed} صورة، وفشلت {failed} ({names}). الصور الفاشلة لم تساهم بشيء.',
  'run.withReasoning': '{how}: {overall}. استنتاج Nemotron: {certainty}. لم يُتحقق من شيء بعد.',
  'run.noReasoning': '{how}: {overall}. الاستنتاج الإنشائي غير متاح ({kind}) — المقارنة أدناه سليمة ولم يُختلق شيء بدلًا منه.',
  'run.plainDone': '{how}: {overall}. لم يُتحقق من شيء بعد.',
  'origin.cached': 'نتيجة ذكاء اصطناعي مخزَّنة (استدلال سابق)',
  'origin.fixture': 'بيانات تجريبية',
  'origin.fresh': 'استدلال ذكاء اصطناعي مباشر',
  'obs.from': 'من {label}',
  'imgs.countAtCap': '{count} صورة — الحد الأقصى لفحص واحد',
  'meta.zone': 'المنطقة',
  'meta.capture': 'اللقطة',
  'meta.captureHint': 'صور مفتوحة',
  'meta.reviewer': 'المراجع',
  'meta.stateReady': 'اللقطة جاهزة',
  'meta.vision': 'الرؤية',
  'meta.reasoning': 'الاستنتاج',
  'meta.source': 'المصدر',
  'proj.label': 'المشروع',
  'proj.new': 'مشروع جديد',
  'tab.capture': 'اللقطة',
  'tab.inspect': 'الفحص',
  'tab.evidence': 'الأدلة',
  'tab.findings': 'الملاحظات',
  'qual.met': 'مُستوفى',
  'qual.partial': 'جزئي',
  'qual.hybrid': 'مسار استدلال هجين',
  'qual.pipeline': 'مسار الاستدلال',
  'qual.unavailable': 'غير متاح',
  'qual.row.vision': 'مرحلة الرؤية',
  'qual.row.reasoning': 'الاستنتاج الإنشائي',
  'qual.row.platform': 'منصة الاستدلال',
  'qual.tag.vision': 'نموذج NVIDIA \u00b7 {role}',
  'qual.tag.vision.not': 'ليس نموذج NVIDIA \u00b7 {role}',
  'qual.tag.reasoning': 'نموذج NVIDIA ، مُؤهِّل \u00b7 {role}',
  'qual.tag.reasoning.not': 'ليس هو الاستدلال المؤهل \u00b7 {role}',
  'qual.tag.platform': 'استدعاء عبر هذه المنصة',
  'qual.tag.platform.not': 'لا توجد منصة لهذه المرحلة',
  'lang.label': 'لغة الفحص',
  'lang.hint': 'عرض فقط. الفحص والأدلة ومنشأها لم تتغير.',
  'lang.sourceEnglish': 'نص صادر عن النموذج بالإنجليزية — يُعرض دون ترجمة',
  'lang.canonicalBadge': 'البيانات الأساسية لم تتغير',
  'tr.viewOriginal': 'عرض الأصل',
  'tr.viewTranslation': 'عرض الترجمة',
  'tr.translatedBadge': 'مترجم من الإنجليزية',
  'tr.fallbackNote': 'الترجمة غير متاحة — يُعرض الأصل',
  'skip.capture': 'انتقل إلى مرحلة الالتقاط',
  'aria.projects': 'المشاريع',
  'aria.workflow': 'سير العمل',
  'aria.pipeline': 'سلسلة النماذج',
  'aria.summary': 'ملخص الفحص',
  'aria.drop': 'أفلت صور الموقع هنا، أو اضغط Enter لاختيار الملفات',
  'ident.cacheToggleTitle': 'أعد استخدام نتيجة ذكاء اصطناعي سابقة لهذه الصورة بالذات بدلاً من دفع زمن النموذج مرة أخرى. النتائج المخزنة مُوسمة.',
  'img.captureAlt': 'تصوير موقع إنشائي قيد الفحص',
  'img.evidenceAlt': 'تصوير واقع من الموقع مع مناطق الأدلة',
  'reviewer.namePh': 'مثال: طارق راجح',
  'reviewer.rolePh': 'مثال: مهندس موقع',
  'panel.notePh': 'ملاحظة اختيارية للمراجعة',
  'foot.thesis': 'الذكاء الاصطناعي لا يحل محل المفتش، بل يدلّه على أين ينظر أولًا.',
  'foot.local': 'واجهة فحص محلية. على الحلقة المحلية فقط.',

  'prov.provider': 'مزود الخدمة',
  'prov.model': 'النموذج',
  'prov.inferenceExecuted': 'تم تنفيذ الاستدلال',
  'prov.elementsDetected': 'العناصر المُرصَدة',
  'prov.observationsAccepted': 'الملاحظات المقبولة',
  'prov.observationsRejected': 'الملاحظات المرفوضة',
  'prov.latency': 'زمن الاستجابة',
  'prov.capturedAt': 'وقت الالتقاط',
  'prov.humanReview': 'تم التحقق البشري',
  'prov.yes': 'نعم',
  'prov.no': 'لا',
  'prov.restored': 'لا — النتيجة مُستعادة من القرص',
  'prov.notRerun': 'لم يُعاد التشغيل',
  'prov.geometry':
    'كان ملف المصدر هذا يحمل اتجاه EXIF رقم {n}. تم تطبيع بكسلاته إلى الاتجاه 1 قبل الفحص، '
    + 'لذلك يستخدم النموذج والعرض وطبقة الدليل نظام إحداثيات واحدًا. لم يُعَد ترميز أي صورة.',
  'prov.geometryStored': 'المخزَّن {sw}×{sh}، والمعروض {dw}×{dh}.',
  'prov.failedHead': 'فشل الفحص ({kind})',
  'prov.partialHead': 'فحص جزئي',
  'pipe.partial': 'تم تحليل {analysed} صورة من أصل {total}، والباقي فشل ولم يساهم بشيء',
  'prov.rejectedHead': '{n} مدخلًا من النموذج رُفضت بواسطة التحقق',

  'fail.timeout': 'انتهت مهلة مزود الذكاء الاصطناعي. لم يستجب النموذج في الوقت المحدد؛ ولم يُنتَج أي نتيجة.',
  'fail.unavailable': 'تعذّر الوصول إلى مزود الذكاء الاصطناعي (شبكة أو خطأ في الخادم). لم يُنتَج أي نتيجة.',
  'fail.authentication': 'رفض مزود الذكاء الاصطناعي بيانات الاعتماد (فشل المصادقة). تحقّق من NEBIUS_API_KEY.',
  'fail.rateLimited': 'حدّ مزود الذكاء الاصطناعي معدّل الطلبات. انتظر لحظة ثم أعد التشغيل.',
  'fail.notConfigured': 'لا يوجد مزود ذكاء اصطناعي مُهيّأ، لذلك لم يُجرَ أي فحص.',
  'fail.malformed': 'الاستجابة التي أعادها المزود غير قابلة للقراءة. لم يُنتَج أي نتيجة.',
  'fail.error': 'فشل الفحص. لم يُنتَج أي نتيجة.',

  'header.cached': 'نتيجة ذكاء اصطناعي مخزَّنة — الاستدلال بتاريخ {at}',
  'header.cachedEarlier': 'تشغيل سابق',
  'header.liveInference': 'استدلال مباشر',

  'intro.pending': 'لم يُسأل النموذج أي شيء بعد.',
  'intro.failed': 'لم يكتمل آخر فحص — راجع ملاحظة الفشل أدناه.',
  'intro.cached': 'يُعرض الفحص المُستعاد لهذه الصورة. أعد الفحص للحصول على قراءة جديدة.',
  'intro.fresh': 'اكتمل الاستدلال — الملاحظات بانتظار قرار شخص مُسمّى.',
  'intro.idle': 'التقط صورة للموقع، ثم شغّل الفحص.',

  'rail.pending': '{pending} بانتظار المراجعة، {verified} مُتحقق منها',
  'rail.reality': 'الواقع',
  'rail.inspection': 'الفحص',
  'rail.findings': 'الملاحظات',
  'rail.confidence': 'الثقة',
  'rail.overall': 'الإجمالي',
  'rail.elementsDetected': 'عنصرًا مُرصَدة',
  'rail.attentionAreas': 'مناطق انتباه',
  'rail.awaitingReview': 'بانتظار المراجعة',
  'rail.highestFinding': 'أعلى ملاحظة',

  'panel.realityBrief': 'ملخص الواقع',
  'panel.priorities': 'أولويات الفحص',
  'panel.whereToLook': 'أين تنظر',
  'panel.provenance': 'الأصل والأهلية',
  'panel.realityEvidence': 'الواقع والأدلة',
  'panel.evidenceHint': 'اختر ملاحظة لبيان المكان الذي رُصدت فيه على الموقع.',
  'panel.reviewer': 'المراجع المسؤول',
  'panel.reviewerUnset': 'غير مُهيّأ',
  'panel.setReviewer': 'تعيين المراجع',
  'panel.changeReviewer': 'تغيير المراجع',
  'panel.reviewerUnsetMeta': 'غير محدد',
  'panel.verificationNote': 'ملاحظة التحقق',
  'panel.trustSuspected': 'مُشتبه به من الذكاء الاصطناعي',
  'panel.trustUnverified': 'غير مُتحقق منه',
  'panel.trustNote': 'الثقة لا تُتحقق من نفسها.',
  'panel.findingsAndVerification': 'الملاحظات والتحقق',
  'panel.findingsHint': 'كل ملاحظة من الذكاء الاصطناعي تحتاج شخصًا مُسمّى يؤكدها أو يرفضها أو يؤجلها.',
  'panel.nvidiaRequirement': 'متطلب NVIDIA',
  'panel.inspection': 'الفحص',
  'panel.prioritiesHint': 'أين ينبغي للمشرف أن ينظر أولًا. هذه ليست أحكامًا.',
  'panel.trustTo': 'إلى',
  'stage.noCapture': 'لا توجد صورة محمَّلة.',
  'panel.stageReasoningHeading': 'الاستنتاج الإنشائي',
  'panel.stageReasoningNotRun': 'لم يُشغَّل',

  'pipe.notRun': 'لم يُشغَّل بعد',
  'pipe.awaitingInspection': 'بانتظار أول فحص',
  'pipe.nothingVerified': 'لا شيء مُتحقق منه',
  'pipe.didNotComplete': 'لم يكتمل — {kind}',
  'pipe.syntheticFixture': 'بيانات اصطناعية، وليست استدلالًا بالذكاء الاصطناعي',
  'pipe.restoredResult': 'نتيجة مُستعادة، وليست نداءً جديدًا',
  'pipe.visionCounts': '{elements} عنصرًا، و{observations} ملاحظة خلال {ms} مللي ثانية',
  'pipe.compareEngine': 'محرك SiteLens الحتمي (src/compare.ts)',
  'pipe.noExpectedState': 'لم تُحمَّل حالة متوقعة',
  'pipe.compareCounts': '{matched} مطابق · {attention} انتباه · {undetermined} غير محسوم',
  'pipe.degenerate': 'لا يضيف تقريبًا إلى القراءة البصرية',
  'pipe.verifyPending': 'لا شيء مُتحقق منه — {n} بانتظار شخص مُسمّى',
  'pipe.verifyCounts': '{verified} مُتحقق منها · {rejected} مرفوضة',

  'reason.stageLabel': 'المرحلة ٢ · NEMOTRON',
  'reason.noConfidence': 'لم يُذكر أي درجة ثقة',
  'reason.footPrefix': 'استنتج بناءً على {detections} عنصرًا مُرصَدة و{rows} صف مقارنة',
  'reason.footCached': '، مُستعادة مع الفحص الأصلي',
  'reason.footLive': ' خلال {ms} مللي ثانية',
  'reason.noneProduced': 'لم يُنتَج استنتاج إنشائي لهذه الصورة.',
  'reason.unavailableHead': 'الاستنتاج الإنشائي غير متاح',

  'qual.notMet': 'غير مُستوفى',
  'qual.noQualifying': 'لم يكتمل أي استدلال NVIDIA مؤهل في هذه العملية',
  'qual.qualifyingStage': ' · المرحلة المؤهلة: {stage}',
  'qual.stageReasoning': 'الاستنتاج الإنشائي (Nemotron)',
  'qual.stageVision': 'التحليل البصري',
  'qual.nvidiaModel': 'نموذج NVIDIA',
  'qual.notNvidiaModel': 'ليس نموذج NVIDIA',
  'qual.visionHead': 'مرحلة الرؤية:',
  'qual.reasoningHead': 'مرحلة الاستنتاج:',
  'qual.roleVision': 'استخراج الأدلة البصرية من صورة الموقع',
  'qual.roleReasoning': 'الاستنتاج الإنشائي على تلك الأدلة وعلى نتيجة المقارنة',
  'qual.stageEligible': 'نموذج مفتوح المصدر من NVIDIA، يُستخدم في {role}، عبر {platform}.',
  'qual.stageNotNvidia':
    '{model} ليس نموذجًا من NVIDIA. يؤدّي استخراج الأدلة البصرية داخل خط الأنابيب الهجين؛ أما الاستدلال '
    + 'المؤهل من NVIDIA فهو استدلال مرحلة الاستنتاج.',
  'qual.stageUnverified': 'معرّف نموذج من NVIDIA، لم يُثبت أنه أنتج مخرجات موثّقة في هذه العملية.',
  'qual.stageDidNotRun': 'لم تُشغَّل هذه المرحلة، لذلك لم تساهم في هذا الفحص.',
  'qual.pathMet':
    'تُنتَج الأدلة البصرية بواسطة {visionModel} وتُمرَّر إلى {qualifyingModel} لإجراء استنتاج خاص '
    + 'بالإنشاء. الاستدلال NVIDIA المؤهل يعمل عبر {platform}.',
  'qual.pathPartial':
    'لم يكتمل أي استدلال NVIDIA مؤهل في هذه العملية، لذلك يُبلَّغ عن متطلب NVIDIA كـ «جزئي» لا كـ «مُستوفى».',
  'qual.pathNotMet':
    'لا تتضمّن هذه العملية أي استدلال مفتوح المصدر من NVIDIA، لذلك لا تستوفي متطلب NVIDIA.',

  'obs.empty': 'لم تُرجَع أي ملاحظات خام لهذه الصورة.',
  'obs.band': '{value} · نطاق {band}',
  'obs.fullFrame': '(الصورة كاملة — لم يُرجع النموذج منطقة محدَّدة لهذه الملاحظة)',
  'obs.next': 'التالي: {action}',

  'capture.sourceUpload': 'مرفوع',
  'capture.sourceDataset': 'مجموعة محلية',
  'capture.sourceFixture': 'بيانات تجريبية',
  'capture.titleUpload': 'صورة قدّمها المشغّل.',
  'capture.titleDataset':
    'صورة أصلية من مجموعة التحقق المحلية، محفوظة على هذا الجهاز فقط. وهي غير متتبَّعة في git، '
    + 'ولم تُلتقط في موقع هذا المشروع.',
  'capture.titleFixture':
    'مشهد اصطناعي مُولَّد بالكود. ليس صورة فوتوغرافية، وليس دليلًا على الدقة.',

  'review.reviewerMissingFinding':
    'المراجع غير مُهيّأ — عيّن هوية المراجع قبل تسجيل قرار بشري على ملاحظة.',
  'review.reviewerMissingObservation':
    'المراجع غير مُهيّأ — عيّن هوية المراجع قبل تسجيل قرار.',
  'review.recorded': 'تم {status} الملاحظة بواسطة {reviewer}.',
  'review.recordedObservation': 'تم {status} الملاحظة بواسطة {reviewer}.',
  'review.lampRecorded': 'تم تسجيل التحقق البشري',
  'review.confirmed': 'تأكيد',
  'review.rejected': 'رفض',
  'review.deferred': 'تأجيل للمراجعة',

  'finding.what': 'المُلاحَظ',
  'finding.where': 'الموقع',
  'finding.why': 'سبب الإبلاغ',
  'finding.expected': 'المتوقَّع',
  'finding.difference': 'الانحراف',
  'finding.confidence': 'درجة الثقة',
  'finding.action': 'الإجراء الموصى به',
  'finding.evidence': 'الدليل',
  'finding.verification': 'التحقق الميداني',
  'finding.origin.comparison': 'مقارنة',
  'finding.origin.visual': 'بصري',
  'finding.empty': 'لا توجد ملاحظات. شغّل الفحص، أو لا يوجد في هذه الصورة ما يخالف المرجع.',
  'finding.confidenceNote': 'ثقة النموذج في قراءته البصرية فقط',
  'finding.aiPrefix': 'ملاحظة الذكاء الاصطناعي — الثقة {pct}',
  'finding.settledPrefix': 'تحقّق منها إنسان ← {status}',
  'finding.settledBy': 'بواسطة {reviewer} في {at}',
  'finding.confirm': 'تأكيد',
  'finding.reject': 'رفض',
  'finding.needsReview': 'يحتاج مراجعة',
  'finding.evidence.headFullFrame': 'دليل بصري',
  'finding.evidence.headNone': 'لا يوجد دليل بصري',
  'finding.evidence.fullFrame':
    'دليل على الصورة كاملة — لم يُرجِع نموذج الرؤية منطقة محدَّدة. الملاحظة تستند إلى الصورة '
    + 'المفحوصة نفسها؛ والدليل هو الوصف أعلاه وليس منطقة مُبرَزة.',
  'finding.evidence.none':
    'لا يوجد دليل بصري قابل للاستخدام لهذه الملاحظة في هذه الصورة. تستند الملاحظة إلى المقارنة '
    + 'مع الحالة المتوقعة، لا إلى قراءة بصرية للصورة.',

  'evidenceState.LOCALIZED': 'منطقة محدَّدة',
  'evidenceState.FULL_FRAME': 'دليل على الصورة كاملة',
  'evidenceState.NONE': 'لا يوجد دليل بصري',

  'comparison.empty': 'لم يتم تحميل حالة متوقعة، لذا لا يمكن إجراء مقارنة.',
  'comparison.expected': 'المتوقَّع',
  'comparison.observed': 'الملاحَظ',
  'comparison.difference': 'الانحراف',
  'comparison.countBasis': 'أساس العد',
  'comparison.countBasisNote': 'عدّ بصري من صورة واحدة. ليس كمية مقاسة.',
  'comparison.expected.present': 'المتوقع {element} ({note})',
  'comparison.expected.presentNoNote': 'المتوقع {element}',
  'comparison.expected.absent': 'لا يُتوقع {element} ({note})',
  'comparison.expected.absentNoNote': 'لا يُتوقع {element}',
  'comparison.expected.countOne': 'المتوقع {n} {unit} ({note})',
  'comparison.expected.countOneNoNote': 'المتوقع {n} {unit}',
  'comparison.expected.countMany': 'المتوقع {n} {unitPlural} ({note})',
  'comparison.expected.countManyNoNote': 'المتوقع {n} {unitPlural}',
  'comparison.observed.notDeterminable': 'غير قابل للتحديد من هذه الصورة',
  'comparison.observed.noneSeen': 'لا يوجد شيء ظاهر في هذه الصورة',
  'comparison.observed.absent': 'لم يتم رصد {element}',
  'comparison.observed.countOne': 'تم عدّ {n} {unit}',
  'comparison.observed.countMany': 'تم عدّ {n} {unitPlural}',
  'comparison.observed.present': 'تم رصد {element}',
  'comparison.diff.fewer':
    'تم رصد {delta} {unitPlural} أقل مما هو متوقع (العدّ البصري {observed}، المتوقع {expected})',
  'comparison.diff.more':
    'تم رصد {delta} {unitPlural} أكثر مما هو متوقع (العدّ البصري {observed}، المتوقع {expected})',
  'comparison.diff.unexpected': '{element} ظاهر ولكنه غير متوقع في هذه المنطقة',
  'comparison.diff.missing': 'كان {element} متوقعًا ولم يتم رصده في هذه الصورة',

  'cf.title.undetermined': 'لا يمكن تأكيد {element} من هذه الصورة',
  'cf.title.count': 'عدد {element} يختلف عن المتوقع',
  'cf.title.unexpected': '{element} موجود رغم أنه غير متوقع',
  'cf.title.missing': '{element} متوقع ولم يتم رصده',
  'cf.reason.undetermined':
    '{expected}، لكن الصورة لا تُظهر ما يكفي للتأكيد أو النفي. صورة واحدة لا تحسم الأمر؛ تبقى النقطة '
    + 'مفتوحة حتى معاينة ميدانية أو صورة ثانية.',
  'cf.reason.mismatch': 'المتوقع: {expected}. الملاحَظ: {observed}.',
  'cf.evidence.localized': 'حدَّد النموذج موضع هذا العنصر في الصورة؛ انظر المنطقة المُبرَزة.',
  'cf.evidence.fullFrame':
    'دليل على الصورة كاملة: تستند الملاحظة إلى الصورة المفحوصة، لكن النموذج لم يُرجِع منطقة محدَّدة.',
  'cf.evidence.none':
    'لا توجد قراءة بصرية لهذا العنصر في هذه الصورة؛ تستند الملاحظة إلى المقارنة مع الحالة المتوقعة '
    + 'بدلًا من دليل صوري.',
  'cf.rec.undetermined':
    'أكِّد بالفحص الميداني: تجوّل في المنطقة وسجِّل ما إذا كان {element} موجودًا. لا تعتبره نقصًا قبل التحقق.',
  'cf.rec.count':
    'تحقق من عدد {element} في الموقع قبل التخطيط لأي عمل تصحيحي. الرقم أعلاه عدّ بصري من صورة '
    + 'واحدة، وليس كمية مقاسة.',
  'cf.rec.unexpected':
    'أكِّد ما إذا كان {element} مطلوبًا في هذه المنطقة، ثم قرر ما إذا كان يعترض منطقة العمل.',
  'cf.rec.missing':
    'افحص موقع {element} مباشرةً وسجِّل ما إذا كان العمل غير مكتمل فعليًا.',
  'cf.difference.undetermined': 'المتوقع: {expected}؛ غير قابل للتحديد من هذه الصورة.',

  'priority.empty': 'لا توجد مناطق انتباه مفتوحة. لم يتم الإبلاغ عن شيء، أو تمت مراجعة كل إبلاغ.',
  'priority.basis.comparison': 'مقارنة مع الحالة المتوقعة — ثقة {pct}%',
  'priority.basis.visual': 'قراءة بصرية — ثقة {pct}%',

  'brief.noneDetected': 'لم يتم الإبلاغ عن أي عناصر إنشائية في هذه الصورة.',
  'brief.countedAcross': 'تم عدّ {total} عنصرًا في الموقع عبر {types} أنواع مُرصَدة',
  'brief.typesDetected': 'تم رصد {n} أنواع من العناصر الإنشائية (غير معدودة)',
  'brief.deviationsOne': 'انحراف محتمل واحد مقابل الحالة المتوقعة',
  'brief.deviationsMany': '{n} انحرافات محتملة مقابل الحالة المتوقعة',
  'brief.unsettledOne': 'عنصر واحد لا تحسمه هذه الصورة',
  'brief.unsettledMany': '{n} عناصر لا تحسمها هذه الصورة',
  'brief.attentionOne': 'مقارنة واحدة مع الحالة المتوقعة تحتاج إلى الانتباه',
  'brief.attentionMany': '{n} مقارنات مع الحالة المتوقعة تحتاج إلى الانتباه',
  'brief.matchedOne': 'فحص واحد مطابق للحالة المتوقعة',
  'brief.matchedMany': '{n} فحوص مطابقة للحالة المتوقعة',
  'brief.overallPrefix': 'الفحص الإجمالي: {overall}',
  'brief.highestPriority': 'الأولوية القصوى: {title}',
  'overall.ATTENTION_REQUIRED': 'يحتاج إلى انتباه',
  'overall.REVIEW_SUGGESTED': 'يوصى بالمراجعة',
  'overall.NO_ATTENTION': 'لا يحتاج إلى انتباه',

  'reasoning.notRun': 'شغّل الفحص كي يستنتج Nemotron ما تثبته الأدلة وما لا تثبته.',
  'reasoning.summary': 'ما الذي يعنيه ذلك',
  'reasoning.whatMatters': 'ما الحاسم',
  'reasoning.rationale': 'الاستنتاج',
  'reasoning.recommendation': 'التوصية',
  'reasoning.verification': 'التحقق',
  'reasoning.certainty': 'درجة اليقين',
  'reasoning.modelStated': 'مذكور من النموذج: {value} — ليس قياسًا وليس تحققًا',
  'reasoning.degenerate':
    'تحذير: تعيد هذه الإجابة عن الملاحظة البصرية بشكل شبه كامل ولا تضيف استنتاجًا يُذكر.',
  'reasoning.additional': 'الاستنتاج أعلاه مضاف إلى الملاحظة البصرية، وليس إعادة لها.',
  'reasoning.foot':
    'لم يُختلق بديل في مكانه. المقارنة أعلاه محسوبة في الكود وهي قائمة بذاتها.',

  'status.UNVERIFIED': 'غير مُتحقق منه',
  'status.NEEDS_REVIEW': 'يحتاج مراجعة',
  'status.VERIFIED': 'مُتحقق منه',
  'status.REJECTED': 'مرفوض',
  'status.OVERRIDDEN': 'مُستبدَل',

  'elig.ELIGIBLE': 'مُستوفٍ',
  'elig.NOT_ELIGIBLE': 'غير مُستوفٍ',
  'elig.NOT_VERIFIED': 'غير مُتحقق',

  'action.NO_ACTION': 'لا إجراء',
  'action.HUMAN_REVIEW': 'مراجعة بشرية',
  'action.INSPECT_CLOSER': 'فحص أقرب',
  'action.CAPTURE_REFERENCE_PLAN': 'التقاط المخطط المرجعي',
  'action.SCHEDULE_FOLLOW_UP': 'جدولة متابعة',
  'severity.INFO': 'معلوماتي',
  'severity.LOW': 'منخفضة',
  'severity.MEDIUM': 'متوسطة',
  'severity.HIGH': 'مرتفعة',
  'comparisonStatus.MATCH': 'مطابق',
  'comparisonStatus.ATTENTION': 'انتباه',
  'comparisonStatus.UNDETERMINED': 'غير محسوم',
  'certainty.SUPPORTED': 'مُسنَد',
  'certainty.UNCERTAIN': 'غير مؤكد',
  'certainty.INSUFFICIENT_EVIDENCE': 'أدلة غير كافية',
  'countBasis.VISUAL_COUNT': 'عدّ بصري',
  'countBasis.NOT_DETERMINABLE': 'غير قابل للتحديد',
  'expectation.PRESENT': 'موجود',
  'expectation.COUNT': 'عدد',
  'expectation.ABSENT': 'غائب',
  'category.DEVIATION': 'انحراف',
  'category.MISSING_ELEMENT': 'عنصر مفقود',
  'category.INCOMPLETE_WORK': 'أعمال غير مكتملة',
  'category.UNEXPECTED_CONDITION': 'حالة غير متوقعة',
  'category.QUALITY': 'جودة',
  'category.COORDINATION': 'تنسيق',
  'category.SAFETY_ATTENTION': 'انتباه للسلامة',
  'category.UNDETERMINED': 'غير محسوم',

  'element.COLUMN': 'عمود',
  'element.SLAB': 'بلاطة',
  'element.WALL': 'جدار',
  'element.OPENING': 'فتحة',
  'element.MEP_ROUGH_IN': 'تمديدات ميكانيكية وكهربائية',
  'element.FORMWORK': 'قوالب',
  'element.SCAFFOLD': 'سقالات',
  'element.EQUIPMENT': 'معدات',
  'element.WORKER': 'عمال',
  'element.REBAR': 'حديد التسليح',
  'element.FINISH': 'تشطيب',
  'element.EXCAVATION': 'حفرة',
  'elementPlural.COLUMN': 'أعمدة',
  'elementPlural.SLAB': 'بلاطات',
  'elementPlural.WALL': 'جدران',
  'elementPlural.OPENING': 'فتحات',
  'elementPlural.MEP_ROUGH_IN': 'تمديدات ميكانيكية وكهربائية',
  'elementPlural.FORMWORK': 'قوالب',
  'elementPlural.SCAFFOLD': 'سقالات',
  'elementPlural.EQUIPMENT': 'معدات',
  'elementPlural.WORKER': 'عمال',
  'elementPlural.REBAR': 'حديد التسليح',
  'elementPlural.FINISH': 'تشطيبات',
  'elementPlural.EXCAVATION': 'حفر',
};

const ZH: Record<TranslationKey, string> = {
  // -- selection messages --------------------------------------------------
  'imgs.restored': '已恢复这张照片的上次检查。重新检查可获得新的判读。',
  'imgs.selected': '已选择照片。点击检查现场开始分析。',
  'imgs.restoredShort': '已选择照片；显示其上次检查。',
  'imgs.selectedShort': '已选择照片。',
  'imgs.selectFailed': '无法选择该照片',
  // -- photographs, run and attribution (multi-image) ------------------------
  'imgs.head': '\u68c0\u67e5\u7167\u7247',
  'imgs.count': '{count} \u5f20\u7167\u7247',
  'imgs.countZero': '\u672a\u6253\u5f00\u7167\u7247',
  'imgs.note': '\u8fd9\u4e9b\u7167\u7247\u4f5c\u4e3a\u4e00\u6b21\u68c0\u67e5\u4e00\u8d77\u5206\u6790\u3002\u7167\u7247\u4e4b\u95f4\u7684\u5206\u6b67\u4f1a\u88ab\u62a5\u544a\u4e3a\u5206\u6b67\uff0c\u7edd\u4e0d\u76f8\u52a0\u3002',
  'imgs.addMore': '\u6dfb\u52a0\u7167\u7247',
  'imgs.remove': '\u79fb\u9664',
  'imgs.inspect': '\u68c0\u67e5\u73b0\u573a',
  'imgs.added': '\u5df2\u5411 {project} \u6dfb\u52a0 {count} \u5f20\u7167\u7247\u3002\u968f\u65f6\u53ef\u4ee5\u5f00\u59cb\u68c0\u67e5\u3002',
  'imgs.duplicates': '\u6240\u9009 {total} \u5f20\u4e2d\u6709 {count} \u5f20\u4e0e\u5176\u4ed6\u5b8c\u5168\u76f8\u540c\uff0c\u5df2\u88ab\u62d2\u7edd\uff0c\u800c\u4e0d\u662f\u88ab\u9ed8\u5ffd\u3002',
  'imgs.partial': '\u6dfb\u52a0 {accepted} \u5f20\uff0c\u62d2\u7edd {refused} \u5f20\u3002',
  'imgs.reading': '\u6b63\u5728\u8bfb\u53d6\u7b2c {index} \u5f20\u7167\u7247\uff0c\u5171 {total} \u5f20',
  'imgs.readFailed': '\u65e0\u6cd5\u8bfb\u53d6\u8be5\u6587\u4ef6\u3002',
  'imgs.rejected': '\u7167\u7247\u88ab\u62d2\u7edd',
  'imgs.loaded': '\u5df2\u52a0\u8f7d {count} \u5f20\u7167\u7247 \u2014 \u968f\u65f6\u53ef\u4ee5\u5f00\u59cb\u68c0\u67e5',
  'imgs.ready': '\u7167\u7247\u5df2\u5c31\u7eea',
  'imgs.noneOpen': '\u68c0\u67e5\u524d\u8bf7\u81f3\u5c11\u6253\u5f00\u4e00\u5f20\u7167\u7247\u3002',
  'imgs.ordinal': '{index}',
  'imgs.dropOne': '\u4ece\u672c\u6b21\u68c0\u67e5\u4e2d\u79fb\u9664 {label}',
  'imgs.status.ready': '\u5df2\u5c31\u7eea',
  'imgs.status.done': '\u5df2\u5206\u6790',
  'imgs.status.failed': '\u5931\u8d25',
  'imgs.obsCount': '{count} \u6761\u89c2\u5bdf',
  'imgs.basisPending': '\u8fd9\u4e9b\u7167\u7247\u8fd8\u6ca1\u6709\u8fd0\u884c\u8fc7\u68c0\u67e5\u3002',
  'imgs.basisPartial': '\u6709 {failed} \u5f20\u7167\u7247\u5931\u8d25\u4e14\u672a\u63d0\u4f9b\u4efb\u4f55\u8bc1\u636e\u3002\u672c\u6b21\u68c0\u67e5\u4f9d\u636e {analysed} \u5f20\u7167\u7247\u3002',

  // -- the evidence stage, and the reviewer gate -----------------------------
  'imgs.evidencePhotos': '\u68c0\u67e5\u7167\u7247\uff1a',
  'imgs.evidenceBasedOn': '\u4e00\u6b21\u68c0\u67e5\uff0c{count} \u5f20\u7167\u7247',
  'imgs.selectAll': '\u5168\u9009',
  'imgs.clear': '\u6e05\u9664',
  'gate.required': '\u9700\u8981\u5ba1\u6838\u4eba',
  'gate.reason': '\u8bf7\u6307\u5b9a\u68c0\u67e5\u5ba1\u6838\u4eba\u4ee5\u8bb0\u5f55\u4eba\u5de5\u6838\u9a8c\u3002\u5728\u6b64\u4e4b\u524d\uff0c\u6240\u6709\u53d1\u73b0\u5747\u4fdd\u6301\u672a\u6838\u9a8c\u72b6\u6001\u3002',
  'gate.setup': '\u8bbe\u7f6e\u5ba1\u6838\u4eba',
  'imgs.allOpen': '\u6b64\u9879\u76ee\u7684\u6240\u6709\u91c7\u96c6\u5747\u5df2\u4f5c\u4e3a\u4e00\u6b21\u68c0\u67e5\u6253\u5f00\u3002',
  'run.working': '\u6b63\u5728\u68c0\u67e5\u73b0\u573a',
  'run.brief': 'MiniCPM \u9010\u5f20\u8bfb\u53d6 {count} \u5f20\u7167\u7247\uff0c\u5bf9\u6bd4\u7531\u4ee3\u7801\u8ba1\u7b97\uff0c\u7136\u540e Nemotron \u5bf9\u5408\u5e76\u540e\u7684\u8bc1\u636e\u8fdb\u884c\u4e00\u6b21\u63a8\u7406\u3002',
  'run.notify': '\u6b63\u5728\u68c0\u67e5 {count} \u5f20\u7167\u7247\uff1a\u6bcf\u5f20\u4e00\u6b21\u771f\u5b9e\u89c6\u89c9\u63a8\u7406\uff0c\u4e00\u6b21\u786e\u5b9a\u6027\u5bf9\u6bd4\uff0c\u7136\u540e\u4e00\u6b21 Nemotron \u63a8\u7406\u3002',
  'run.elapsed': '\u8fd0\u884c\u4e2d \u2014 \u5df2\u7528 {secs} \u79d2\uff0c\u5f85\u5206\u6790 {count} \u5f20\u7167\u7247\u3002\u6ca1\u6709\u5206\u9636\u6bb5\u8fdb\u5ea6\u4fe1\u53f7\uff0c\u53ea\u6709\u5df2\u7528\u65f6\u95f4\u3002',
  'run.done': '{how} \u5728 {secs} \u79d2\u5185\u5b8c\u6210\u3002{findings} \u6761\u53d1\u73b0\uff0c\u5168\u90e8\u5f85\u6838\u5b9e\u5e76\u7b49\u5f85\u4e00\u4f4d\u5177\u540d\u4eba\u58eb\u51b3\u5b9a\u3002',
  'run.readyLamp': '\u53d1\u73b0\u5df2\u5c31\u7eea \u2014 \u7b49\u5f85\u4eba\u5de5\u5ba1\u6838',
  'run.partialLamp': '\u90e8\u5206\u5b8c\u6210 \u2014 \u90e8\u5206\u7167\u7247\u5931\u8d25',
  'run.partial': '\u90e8\u5206\u68c0\u67e5\uff1a\u5df2\u5206\u6790 {analysed} \u5f20\uff0c{failed} \u5f20\u5931\u8d25\uff08{names}\uff09\u3002\u5931\u8d25\u7684\u7167\u7247\u672a\u63d0\u4f9b\u4efb\u4f55\u8bc1\u636e\u3002',
  'run.withReasoning': '{how}\uff1a{overall}\u3002Nemotron \u63a8\u7406\uff1a{certainty}\u3002\u76ee\u524d\u5c1a\u672a\u6838\u5b9e\u3002',
  'run.noReasoning': '{how}\uff1a{overall}\u3002\u65bd\u5de5\u63a8\u7406\u4e0d\u53ef\u7528\uff08{kind}\uff09\u2014 \u4e0b\u65b9\u5bf9\u6bd4\u4e0d\u53d7\u5f71\u54cd\uff0c\u4e5f\u6ca1\u6709\u4efb\u4f55\u5185\u5bb9\u88ab\u4f2a\u9020\u66ff\u4ee3\u3002',
  'run.plainDone': '{how}\uff1a{overall}\u3002\u76ee\u524d\u5c1a\u672a\u6838\u5b9e\u3002',
  'origin.cached': '\u5df2\u7f13\u5b58\u7684 AI \u7ed3\u679c\uff08\u4e4b\u524d\u7684\u63a8\u7406\uff09',
  'origin.fixture': '\u6f14\u793a\u6570\u636e',
  'origin.fresh': '\u771f\u5b9e AI \u63a8\u7406',
  'obs.from': '\u6765\u81ea {label}',
  'imgs.countAtCap': '{count} \u5f20\u7167\u7247 \u2014 \u5355\u6b21\u68c0\u67e5\u7684\u4e0a\u9650',
  'meta.zone': '\u533a\u57df',
  'meta.capture': '\u91c7\u96c6',
  'meta.captureHint': '\u5f20\u7167\u7247\u5df2\u6253\u5f00',
  'meta.reviewer': '\u5ba1\u6838\u4eba',
  'meta.stateReady': '\u91c7\u96c6\u5df2\u5c31\u7eea',
  'meta.vision': '\u89c6\u89c9',
  'meta.reasoning': '\u63a8\u7406',
  'meta.source': '\u6765\u6e90',
  'proj.label': '\u9879\u76ee',
  'proj.new': '\u65b0\u5efa\u9879\u76ee',
  'tab.capture': '\u91c7\u96c6',
  'tab.inspect': '\u68c0\u67e5',
  'tab.evidence': '\u8bc1\u636e',
  'tab.findings': '\u53d1\u73b0',
  'qual.met': '\u5df2\u6ee1\u8db3',
  'qual.partial': '\u90e8\u5206\u6ee1\u8db3',
  'qual.hybrid': '\u6df7\u5408\u63a8\u7406\u7ba1\u7ebf',
  'qual.pipeline': '\u63a8\u7406\u7ba1\u7ebf',
  'qual.unavailable': '\u4e0d\u53ef\u7528',
  'qual.row.vision': '\u89c6\u89c9\u9636\u6bb5',
  'qual.row.reasoning': '\u65bd\u5de5\u63a8\u7406',
  'qual.row.platform': '\u63a8\u7406\u5e73\u53f0',
  'qual.tag.vision': 'NVIDIA \u6a21\u578b \u00b7 {role}',
  'qual.tag.vision.not': '\u975e NVIDIA \u6a21\u578b \u00b7 {role}',
  'qual.tag.reasoning': 'NVIDIA \u6a21\u578b\uff0c\u8ba1\u8d44 \u00b7 {role}',
  'qual.tag.reasoning.not': '\u975e\u8ba1\u8d44\u63a8\u7406 \u00b7 {role}',
  'qual.tag.platform': '\u901a\u8fc7\u8be5\u5e73\u53f0\u8c03\u7528',
  'qual.tag.platform.not': '\u8be5\u9636\u6bb5\u65e0\u5e73\u53f0',
  'lang.label': '检查语言',
  'lang.hint': '仅影响呈现。检查结果、证据与来源信息均未改变。',
  'lang.sourceEnglish': '模型生成的英文原文 — 未作翻译',
  'lang.canonicalBadge': '原始数据未改变',
  'tr.viewOriginal': '查看原文',
  'tr.viewTranslation': '查看译文',
  'tr.translatedBadge': '译自英文',
  'tr.fallbackNote': '暂无译文 — 显示原文',
  'skip.capture': '\u8df3\u81f3\u91c7\u96c6\u533a\u57df',
  'aria.projects': '\u9879\u76ee',
  'aria.workflow': '\u5de5\u4f5c\u6d41\u7a0b',
  'aria.pipeline': '\u6a21\u578b\u7ba1\u7ebf',
  'aria.summary': '\u68c0\u67e5\u6458\u8981',
  'aria.drop': '\u5c06\u73b0\u573a\u7167\u7247\u62d6\u653e\u6b64\u5904\uff0c\u6216\u6309 Enter \u9009\u62e9\u6587\u4ef6',
  'ident.cacheToggleTitle': '\u5bf9\u8fd9\u5f20\u7167\u7247\u590d\u7528\u4e4b\u524d\u6210\u529f\u7684 AI \u7ed3\u679c\uff0c\u800c\u4e0d\u662f\u518d\u6b21\u652f\u4ed8\u6a21\u578b\u5ef6\u8fdd\u3002\u7f13\u5b58\u7ed3\u679c\u4f1a\u88ab\u6807\u6ce8\u3002',
  'img.captureAlt': '\u6b63\u5728\u68c0\u67e5\u7684\u73b0\u573a\u91c7\u96c6',
  'img.evidenceAlt': '\u5e26\u8bc1\u636e\u533a\u57df\u7684\u73b0\u573a\u91c7\u96c6',
  'reviewer.namePh': '\u4f8b\u5982\uff1a\u674e\u5efa\u56fd',
  'reviewer.rolePh': '\u4f8b\u5982\uff1a\u73b0\u573a\u5de5\u7a0b\u5e08',
  'panel.notePh': '\u53ef\u9009\u7684\u5ba1\u6838\u8bf4\u660e',
  'foot.thesis': 'AI 不会取代检查员，它只是告诉检查员该先看哪里。',
  'foot.local': '\u672c\u5730\u68c0\u67e5\u754c\u9762\uff0c\u4ec5\u9650\u56de\u73af\u8bbf\u95ee\u3002',

  'prov.provider': '服务商',
  'prov.model': '模型',
  'prov.inferenceExecuted': '已执行推理',
  'prov.elementsDetected': '检出构件',
  'prov.observationsAccepted': '已接受的观察',
  'prov.observationsRejected': '被拒绝的观察',
  'prov.latency': '耗时',
  'prov.capturedAt': '采集时间',
  'prov.humanReview': '已人工核实',
  'prov.yes': '是',
  'prov.no': '否',
  'prov.restored': '否 — 结果从磁盘恢复',
  'prov.notRerun': '未重新运行',
  'prov.geometry':
    '该源文件带有 EXIF 方向 {n}。其像素在检查前已归一为方向 1，因此模型、显示与证据图层使用同一'
    + '坐标系。未对任何图像重新编码。',
  'prov.geometryStored': '存储 {sw}×{sh}，显示 {dw}×{dh}。',
  'prov.failedHead': '检查失败（{kind}）',
  'prov.partialHead': '\u90e8\u5206\u68c0\u67e5',
  'pipe.partial': '{total} \u5f20\u7167\u7247\u4e2d\u5df2\u5206\u6790 {analysed} \u5f20\uff0c\u5176\u4f59\u5931\u8d25\u4e14\u672a\u63d0\u4f9b\u8bc1\u636e',
  'prov.rejectedHead': '{n} 条模型输出被校验拒绝',

  'fail.timeout': 'AI 服务方超时。模型未及时应答；未产生任何结果。',
  'fail.unavailable': '无法连接 AI 服务方（网络或服务端错误）。未产生任何结果。',
  'fail.authentication': 'AI 服务方拒绝了该凭据（认证失败）。请检查 NEBIUS_API_KEY。',
  'fail.rateLimited': 'AI 服务方对该请求做了限流。请稍候再运行一次。',
  'fail.notConfigured': '未配置 AI 服务方，因此未执行任何检查。',
  'fail.malformed': 'AI 服务方返回的响应无法解析。未产生任何结果。',
  'fail.error': '检查失败。未产生任何结果。',

  'header.cached': '已缓存的 AI 结果 — 推理时间 {at}',
  'header.cachedEarlier': '此前的运行',
  'header.liveInference': '实时推理',

  'intro.pending': '尚未向模型提出任何问题。',
  'intro.failed': '上一次检查未完成 — 请查看下方的失败说明。',
  'intro.cached': '正在显示该影像恢复的检查结果。重新检查可获得新的判读。',
  'intro.fresh': '推理已完成 — 检查项正等待具名人员作出决定。',
  'intro.idle': '拍摄现场影像，然后运行检查。',

  'rail.pending': '{pending} 项待复核，{verified} 项已核实',
  'rail.reality': '现实',
  'rail.inspection': '检查',
  'rail.findings': '检查项',
  'rail.confidence': '置信度',
  'rail.overall': '总体',
  'rail.elementsDetected': '个已检出构件',
  'rail.attentionAreas': '个关注区域',
  'rail.awaitingReview': '项待复核',
  'rail.highestFinding': '置信度最高的检查项',

  'panel.realityBrief': '现场现状摘要',
  'panel.priorities': '检查重点',
  'panel.whereToLook': '该看哪里',
  'panel.provenance': '\u6765\u6e90\u4e0e\u8d44\u683c',
  'panel.realityEvidence': '现状与证据',
  'panel.evidenceHint': '选择一项检查内容，以高亮其在现场的位置。',
  'panel.reviewer': '检查复核人',
  'panel.reviewerUnset': '未设置',
  'panel.setReviewer': '设置复核人',
  'panel.changeReviewer': '更换复核人',
  'panel.reviewerUnsetMeta': '未设置',
  'panel.verificationNote': '核实备注',
  'panel.trustSuspected': 'AI 存疑',
  'panel.trustUnverified': '未核实',
  'panel.trustNote': '置信度本身不能作为核实。',
  'panel.findingsAndVerification': '检查项与核实',
  'panel.findingsHint': '每一项 AI 检查内容都需由具名人员确认、驳回或暂缓。',
  'panel.nvidiaRequirement': 'NVIDIA 要求',
  'panel.inspection': '检查',
  'panel.prioritiesHint': '复核人员应首先查看的位置。这些不是判定结论。',
  'panel.trustTo': '转为',
  'stage.noCapture': '尚未载入影像。',
  'panel.stageReasoningHeading': '施工推断',
  'panel.stageReasoningNotRun': '未运行',

  'pipe.notRun': '尚未运行',
  'pipe.awaitingInspection': '等待首次检查',
  'pipe.nothingVerified': '尚无核实',
  'pipe.didNotComplete': '未完成 — {kind}',
  'pipe.syntheticFixture': '合成样例数据，并非 AI 推理',
  'pipe.restoredResult': '恢复的结果，并非新的调用',
  'pipe.visionCounts': '{elements} 个构件、{observations} 条观察，用时 {ms} 毫秒',
  'pipe.compareEngine': 'SiteLens 确定性引擎 (src/compare.ts)',
  'pipe.noExpectedState': '未加载预期状态',
  'pipe.compareCounts': '{matched} 项相符 · {attention} 项需关注 · {undetermined} 项未判定',
  'pipe.degenerate': '对视觉判读几乎没有新增内容',
  'pipe.verifyPending': '尚无核实 — {n} 项等待具名人员',
  'pipe.verifyCounts': '{verified} 项已核实 · {rejected} 项已驳回',

  'reason.stageLabel': '第 2 阶段 · NEMOTRON',
  'reason.noConfidence': '未给出置信度',
  'reason.footPrefix': '基于 {detections} 个已检出构件、{rows} 行比对结果推断',
  'reason.footCached': '，与原始检查一并恢复',
  'reason.footLive': '，用时 {ms} 毫秒',
  'reason.noneProduced': '该影像尚未产生施工推断。',
  'reason.unavailableHead': '施工推断不可用',

  'qual.notMet': '未满足',
  'qual.noQualifying': '本次运行没有符合要求的 NVIDIA 推理',
  'qual.qualifyingStage': ' · 符合要求的阶段：{stage}',
  'qual.stageReasoning': '施工推断（Nemotron）',
  'qual.stageVision': '视觉分析',
  'qual.nvidiaModel': 'NVIDIA 模型',
  'qual.notNvidiaModel': '非 NVIDIA 模型',
  'qual.visionHead': '视觉阶段：',
  'qual.reasoningHead': '推断阶段：',
  'qual.roleVision': '从现场影像中提取视觉证据',
  'qual.roleReasoning': '基于该证据与比对结果的施工推断',
  'qual.stageEligible': 'NVIDIA 开源模型，用于{role}，通过 {platform} 调用。',
  'qual.stageNotNvidia':
    '{model} 不是 NVIDIA 模型。它在混合管线中承担视觉证据提取；符合要求的 NVIDIA 推理来自推断阶段。',
  'qual.stageUnverified': 'NVIDIA 模型标识，但本次运行未证明其产生了通过验证的输出。',
  'qual.stageDidNotRun': '该阶段未运行，因此未对本次检查作出任何贡献。',
  'qual.pathMet':
    '视觉证据由 {visionModel} 产出，随后传入 {qualifyingModel} 进行施工专项推断。符合要求的 NVIDIA '
    + '推理通过 {platform} 运行。',
  'qual.pathPartial': '本次运行没有完成任何符合要求的 NVIDIA 推理，因此 NVIDIA 要求报告为“部分满足”而非“已满足”。',
  'qual.pathNotMet': '本次运行不包含任何 NVIDIA 开源推理，因此不满足 NVIDIA 要求。',

  'obs.empty': '该影像未返回任何原始观察。',
  'obs.band': '{value} · {band} 区间',
  'obs.fullFrame': '（全画面 — 模型未为该观察返回局部区域）',
  'obs.next': '下一步：{action}',

  'capture.sourceUpload': '上传',
  'capture.sourceDataset': '本地数据集',
  'capture.sourceFixture': '演示样例',
  'capture.titleUpload': '由操作人员提供的照片。',
  'capture.titleDataset':
    '取自本地验证数据集的真实照片，仅保存在本机。它不受 git 管理，且并非在本项目现场拍摄。',
  'capture.titleFixture': '由代码生成的合成场景。它不是照片，也不能作为准确性的证据。',

  'review.reviewerMissingFinding': '未设置复核人 — 在记录人工检查结论前，请先设置复核人身份。',
  'review.reviewerMissingObservation': '未设置复核人 — 请先设置复核人身份。',
  'review.recorded': '检查项已由 {reviewer}{status}。',
  'review.recordedObservation': '观察项已由 {reviewer}{status}。',
  'review.lampRecorded': '已记录人工核实',
  'review.confirmed': '确认',
  'review.rejected': '驳回',
  'review.deferred': '暂缓复核',

  'finding.what': '观察',
  'finding.where': '位置',
  'finding.why': '上报原因',
  'finding.expected': '预期',
  'finding.difference': '偏差',
  'finding.confidence': '置信度',
  'finding.action': '建议措施',
  'finding.evidence': '证据',
  'finding.verification': '现场核实',
  'finding.origin.comparison': '比对',
  'finding.origin.visual': '视觉',
  'finding.empty': '暂无检查项。请运行检查，或该影像与基准无差异。',
  'finding.confidenceNote': '模型对其视觉判读的置信度，仅此而已',
  'finding.aiPrefix': 'AI 检查项 — 置信度 {pct}',
  'finding.settledPrefix': '已由人工核实 → {status}',
  'finding.settledBy': '核实人 {reviewer}，时间 {at}',
  'finding.confirm': '确认',
  'finding.reject': '驳回',
  'finding.needsReview': '需复核',
  'finding.evidence.headFullFrame': '视觉证据',
  'finding.evidence.headNone': '无视觉证据',
  'finding.evidence.fullFrame':
    '全画面证据 — 视觉模型未返回局部区域。该检查项由所检查的影像本身支持；证据是上方的文字描述，'
    + '而非高亮区域。',
  'finding.evidence.none':
    '该影像中没有可用于此检查项的视觉证据。它依据的是与预期状态的比对，而非对影像的视觉判读。',

  'evidenceState.LOCALIZED': '局部区域',
  'evidenceState.FULL_FRAME': '全画面证据',
  'evidenceState.NONE': '无视觉证据',

  'comparison.empty': '未加载预期状态，因此无法进行比对。',
  'comparison.expected': '预期',
  'comparison.observed': '实测',
  'comparison.difference': '偏差',
  'comparison.countBasis': '计数依据',
  'comparison.countBasisNote': '来自单张照片的目视计数，并非实测数量。',
  'comparison.expected.present': '预期有{element}（{note}）',
  'comparison.expected.presentNoNote': '预期有{element}',
  'comparison.expected.absent': '预期无{element}（{note}）',
  'comparison.expected.absentNoNote': '预期无{element}',
  'comparison.expected.countOne': '预期 {n} {unit}（{note}）',
  'comparison.expected.countOneNoNote': '预期 {n} {unit}',
  'comparison.expected.countMany': '预期 {n} {unitPlural}（{note}）',
  'comparison.expected.countManyNoNote': '预期 {n} {unitPlural}',
  'comparison.observed.notDeterminable': '无法从该影像判定',
  'comparison.observed.noneSeen': '该影像中未见',
  'comparison.observed.absent': '未检出{element}',
  'comparison.observed.countOne': '已计数 {n} {unit}',
  'comparison.observed.countMany': '已计数 {n} {unitPlural}',
  'comparison.observed.present': '已检出{element}',
  'comparison.diff.fewer':
    '计数比预期少 {delta} {unitPlural}（目视计数 {observed}，预期 {expected}）',
  'comparison.diff.more':
    '计数比预期多 {delta} {unitPlural}（目视计数 {observed}，预期 {expected}）',
  'comparison.diff.unexpected': '{element}已可见，但该区域并未预期出现',
  'comparison.diff.missing': '预期有{element}，但该影像中未检出',

  'cf.title.undetermined': '无法从该影像确认{element}',
  'cf.title.count': '{element}数量与预期不符',
  'cf.title.unexpected': '{element}已出现，但并非预期',
  'cf.title.missing': '预期有{element}但未检出',
  'cf.reason.undetermined':
    '{expected}，但该影像不足以确认或否定。单张照片无法定论；在实地巡视或补充影像之前，此项保持未决。',
  'cf.reason.mismatch': '预期：{expected}。实测：{observed}。',
  'cf.evidence.localized': '模型已定位该元素在影像中的位置，请查看高亮区域。',
  'cf.evidence.fullFrame':
    '全画面证据：该检查项由所检查的影像支持，但模型未返回局部区域。',
  'cf.evidence.none':
    '该影像中没有对该元素的视觉判读；此检查项依据的是与预期状态的比对，而非影像证据。',
  'cf.rec.undetermined':
    '以实地检查确认：巡视该区域并记录{element}是否存在。在核实之前，不得视为缺项。',
  'cf.rec.count':
    '在计划任何整改之前，先在现场核实{element}的数量。上方数字为来自单张照片的目视计数，并非实测数量。',
  'cf.rec.unexpected':
    '先确认{element}是否应当出现在该区域，再判断其是否妨碍作业面。',
  'cf.rec.missing':
    '直接检查{element}所在位置，并记录工程是否确实未完成。',
  'cf.difference.undetermined': '预期：{expected}；无法从该影像判定。',

  'priority.empty': '暂无待关注的区域。既未上报任何问题，或每个问题都已复核完毕。',
  'priority.basis.comparison': '与预期状态比对 — 置信度 {pct}%',
  'priority.basis.visual': '视觉判读 — 置信度 {pct}%',

  'brief.noneDetected': '该影像中未报告任何施工构件。',
  'brief.countedAcross': '在 {types} 个已检出类型中共计数 {total} 个现场构件',
  'brief.typesDetected': '检出 {n} 类施工构件（未计数）',
  'brief.deviationsOne': '与预期状态相比存在 1 项潜在偏差',
  'brief.deviationsMany': '与预期状态相比存在 {n} 项潜在偏差',
  'brief.unsettledOne': '有 1 项该影像无法判定',
  'brief.unsettledMany': '有 {n} 项该影像无法判定',
  'brief.attentionOne': '有 1 项与预期状态的比对需要关注',
  'brief.attentionMany': '有 {n} 项与预期状态的比对需要关注',
  'brief.matchedOne': '有 1 项与预期状态相符',
  'brief.matchedMany': '有 {n} 项与预期状态相符',
  'brief.overallPrefix': '总体检查：{overall}',
  'brief.highestPriority': '最高优先级：{title}',
  'overall.ATTENTION_REQUIRED': '需要关注',
  'overall.REVIEW_SUGGESTED': '建议复核',
  'overall.NO_ATTENTION': '无需关注',

  'reasoning.notRun': '运行检查后，由 Nemotron 推断这些证据能证明什么、不能证明什么。',
  'reasoning.summary': '这意味着什么',
  'reasoning.whatMatters': '关键所在',
  'reasoning.rationale': '推断依据',
  'reasoning.recommendation': '建议',
  'reasoning.verification': '核实事项',
  'reasoning.certainty': '确定程度',
  'reasoning.modelStated': '模型自述：{value} — 既非测量，也非核实',
  'reasoning.degenerate': '警告：该回答几乎只是重复视觉观察，几乎没有新增推断。',
  'reasoning.additional': '上述推断是对视觉观察的补充，而非重复。',
  'reasoning.foot': '没有以任何内容代替它。上方比对由代码计算，可独立成立。',

  'status.UNVERIFIED': '未核实',
  'status.NEEDS_REVIEW': '需复核',
  'status.VERIFIED': '已核实',
  'status.REJECTED': '已驳回',
  'status.OVERRIDDEN': '已替代',

  'elig.ELIGIBLE': '符合资格',
  'elig.NOT_ELIGIBLE': '不符合资格',
  'elig.NOT_VERIFIED': '未验证',

  'action.NO_ACTION': '无需处置',
  'action.HUMAN_REVIEW': '人工复核',
  'action.INSPECT_CLOSER': '近距离检查',
  'action.CAPTURE_REFERENCE_PLAN': '拍摄基准图纸',
  'action.SCHEDULE_FOLLOW_UP': '安排跟进',
  'severity.INFO': '提示性',
  'severity.LOW': '低',
  'severity.MEDIUM': '中',
  'severity.HIGH': '高',
  'comparisonStatus.MATCH': '相符',
  'comparisonStatus.ATTENTION': '需关注',
  'comparisonStatus.UNDETERMINED': '未判定',
  'certainty.SUPPORTED': '有依据',
  'certainty.UNCERTAIN': '不确定',
  'certainty.INSUFFICIENT_EVIDENCE': '证据不足',
  'countBasis.VISUAL_COUNT': '目视计数',
  'countBasis.NOT_DETERMINABLE': '无法判定',
  'expectation.PRESENT': '应存在',
  'expectation.COUNT': '数量',
  'expectation.ABSENT': '应不存在',
  'category.DEVIATION': '偏差',
  'category.MISSING_ELEMENT': '构件缺失',
  'category.INCOMPLETE_WORK': '工程未完成',
  'category.UNEXPECTED_CONDITION': '非预期状况',
  'category.QUALITY': '质量',
  'category.COORDINATION': '配合',
  'category.SAFETY_ATTENTION': '安全关注',
  'category.UNDETERMINED': '未判定',

  'element.COLUMN': '柱',
  'element.SLAB': '楼板',
  'element.WALL': '墙体',
  'element.OPENING': '洞口',
  'element.MEP_ROUGH_IN': '机电预留预埋',
  'element.FORMWORK': '模板',
  'element.SCAFFOLD': '脚手架',
  'element.EQUIPMENT': '设备',
  'element.WORKER': '工人',
  'element.REBAR': '钢筋',
  'element.FINISH': '饰面',
  'element.EXCAVATION': '开挖',
  'elementPlural.COLUMN': '柱',
  'elementPlural.SLAB': '楼板',
  'elementPlural.WALL': '墙体',
  'elementPlural.OPENING': '洞口',
  'elementPlural.MEP_ROUGH_IN': '机电预留预埋',
  'elementPlural.FORMWORK': '模板',
  'elementPlural.SCAFFOLD': '脚手架',
  'elementPlural.EQUIPMENT': '设备',
  'elementPlural.WORKER': '工人',
  'elementPlural.REBAR': '钢筋',
  'elementPlural.FINISH': '饰面',
  'elementPlural.EXCAVATION': '开挖',
};

/**
 * Every catalog, keyed by language.
 *
 * Served to the browser so the client can label enums and render chrome without
 * a second copy of the vocabulary drifting out of step with this one.
 */
export const UI_STRINGS: Readonly<Record<InspectionLanguage, Record<TranslationKey, string>>> = {
  en: EN,
  fr: FR,
  ar: AR,
  zh: ZH,
};

export type { TranslationKey };

/* ------------------------------------------------------------------ *
 * Translator
 * ------------------------------------------------------------------ */

export interface Translator {
  readonly language: InspectionLanguage;
  readonly dir: TextDirection;
  /** Look a label up. Never throws, never returns undefined. */
  t(key: string): string;
  /** Element name in the current language, singular. */
  element(kind: string): string;
  /** Element name in the current language, plural/counted form. */
  elementPlural(kind: string): string;
}

/**
 * Fill `{token}` placeholders.
 *
 * Deliberately not a general templating engine: a token with no supplied value
 * is left visible rather than blanked, so a missing parameter shows up on screen
 * during development instead of silently shortening a sentence.
 */
export function fill(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, token: string) => {
    const value = params[token];
    return value === undefined || value === null ? whole : String(value);
  });
}

/**
 * Capitalise for a sentence start, but only where the script has case.
 * Arabic and Chinese are left untouched: forcing `toUpperCase()` on them would
 * corrupt nothing but would imply a case distinction that does not exist.
 */
export function sentenceCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

export function translatorFor(language: InspectionLanguage): Translator {
  const catalog = UI_STRINGS[language];
  const english = UI_STRINGS[DEFAULT_INSPECTION_LANGUAGE];
  const lookup = (key: string): string => {
    const value = catalog[key as TranslationKey];
    if (typeof value === 'string') return value;
    // Fail closed to English rather than to an empty label.
    const fallback = english[key as TranslationKey];
    return typeof fallback === 'string' ? fallback : key;
  };

  return {
    language,
    dir: LANGUAGE_DIRECTION[language],
    t: lookup,
    element: (kind: string) => lookup(`element.${kind}`),
    elementPlural: (kind: string) => lookup(`elementPlural.${kind}`),
  };
}

/* ------------------------------------------------------------------ *
 * Browser payload
 * ------------------------------------------------------------------ */

export interface ClientLanguageOption {
  readonly code: InspectionLanguage;
  /** Endonym. Never an English name and never a flag. */
  readonly label: string;
  readonly dir: TextDirection;
  readonly bcp47: string;
}

export interface ClientLocalization {
  readonly languages: readonly ClientLanguageOption[];
  readonly strings: Readonly<Record<InspectionLanguage, Record<TranslationKey, string>>>;
  readonly defaultLanguage: InspectionLanguage;
}

/**
 * The vocabulary, serialized for the browser.
 *
 * This module stays the single source of truth: the client renders from these
 * strings rather than from a second copy that could drift. The payload is
 * static data, so shipping it costs one response and no request per switch.
 */
export function clientLocalizationPayload(): ClientLocalization {
  return {
    languages: INSPECTION_LANGUAGES.map((code) => ({
      code,
      label: LANGUAGE_LABELS[code],
      dir: LANGUAGE_DIRECTION[code],
      bcp47: LANGUAGE_BCP47[code],
    })),
    strings: UI_STRINGS,
    defaultLanguage: DEFAULT_INSPECTION_LANGUAGE,
  };
}