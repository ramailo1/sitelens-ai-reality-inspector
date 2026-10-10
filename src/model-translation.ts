/**
 * Presentation-layer translation memory for model-authored English prose.
 *
 * THE ONE RULE IN THIS FILE: translation changes PRESENTATION and nothing else.
 *
 * The canonical inspection (ids, enums, counts, boxes, provenance, reviews and
 * the original English strings the models actually returned) is computed once,
 * validated once, persisted once and never rewritten here. This module reads a
 * finished English string and returns a second string that says the same thing
 * in another supported language. It never mutates its input, never calls a
 * model, never performs network I/O and never re-runs the pipeline.
 *
 * Two tiers, one contract. The MEMORY below is the offline tier: human-reviewed,
 * full-sentence translations of KNOWN fixture sentences, deterministic and
 * testable without paid calls. The LIVE tier (further down in this file) handles
 * NOVEL model prose through the already-configured Nebius Token Factory chat
 * endpoint with the already-configured credential - no new service, host,
 * credential or configuration variable. Both tiers resolve through the same
 * lookup, carry the same freshness key (exact source text), and fall back to
 * the original English with an honest label when unavailable. The language
 * switch itself stays a local read in both tiers: live translations are
 * computed once per inspection run and shipped in the same payload, never on
 * switch, and never as a vision or reasoning re-inference.
 *
 * Inventing a translation of a safety claim is exactly the failure this
 * product exists to avoid. The memory never invents; the live tier returns
 * only validated model output and falls back per entry rather than guessing.
 *
 * Freshness: lookup is by EXACT source text (trimmed). When the source text
 * changes, the key changes, the old translation no longer matches and the UI
 * falls back to the original. An outdated translation can never appear current.
 *
 * What is covered: free English written by MiniCPM or Nemotron that the UI
 * actually shows - detection evidence, observation text, evidence descriptions,
 * AI finding title / observation / reason / evidence / recommendation /
 * location, and reasoning summary / whatMatters / rationale / recommendation /
 * verification. Stable identifiers, enums, model names, hashes, counts, boxes,
 * provenance and reviewer words are never translated here.
 */

import type { InspectionLanguage } from './localization.ts';
import { resolveReasoningConfig } from './config.ts';
import { safeResolveReasoningCredentials } from './providers/nemotron-reasoner.ts';

/** Target languages that need a translation. English needs none. */
export type ModelTranslationTarget = 'fr' | 'ar' | 'zh';

/** Version of this memory. Bumped when entries change, so caches invalidate. */
export const MODEL_TRANSLATION_VERSION = 'model-memory-v1' as const;

export interface ModelTranslationResult {
  readonly source: string;
  /** Text to display. The original when no translation exists. */
  readonly text: string;
  /** True only when `text` is a genuine translation of `source`. */
  readonly translated: boolean;
  /** Which tier produced the text: the offline memory, the live Nebius chat
   *  translation, or 'none' when falling back to the original. */
  readonly provider: 'model-memory-v1' | 'live-neb-translate-v1' | 'none';
}

/** Version of the live translation contract. Bumped when the prompt or the
 *  accepted response shape changes, so an old cached entry is never served
 *  against a newer contract. Part of every live cache key. */
export const LIVE_TRANSLATION_VERSION = 'live-neb-translate-v1' as const;

type Triple = { readonly fr: string; readonly ar: string; readonly zh: string };

/**
 * Human-reviewed, full-sentence translations of KNOWN model sentences.
 *
 * Keys are the EXACT English source strings (trimmed). Values are the same
 * fact in three languages. Numbers, enum keywords (e.g. ATTENTION) and model
 * names are preserved verbatim inside the translations.
 */
const MEMORY: Readonly<Record<string, Triple>> = {
  // -- demo fixture: detection evidence ------------------------------------
  'Four vertical structural members are distinguishable across the frame.': {
    fr: 'Quatre éléments verticaux de structure sont distinguables dans le cadre.',
    ar: 'يمكن تمييز أربعة عناصر إنشائية رأسية عبر الإطار.',
    zh: '画面中可辨认出四根竖向结构构件。',
  },
  'A large horizontal deck surface spans the lower half of the frame.': {
    fr: 'Une grande surface de dalle horizontale couvre la moitié inférieure du cadre.',
    ar: 'يمتد سطح بلاطة أفقية كبيرة عبر النصف السفلي من الإطار.',
    zh: '一块大型水平楼板面横跨画面下半部分。',
  },
  'Masonry is visible at the left edge of the frame.': {
    fr: 'De la maçonnerie est visible au bord gauche du cadre.',
    ar: 'يظهر بناء حجري عند الحافة اليسرى من الإطار.',
    zh: '画面左边缘可见砌体。',
  },
  'Services are partially visible behind the frame; extent is unclear.': {
    fr: 'Des réseaux sont partiellement visibles derrière le cadre ; leur étendue reste incertaine.',
    ar: 'تظهر التمديدات جزئيًا خلف الإطار؛ ومداها غير واضح.',
    zh: '管线在画面后方部分可见，范围尚不明确。',
  },
  // -- demo fixture: findings -------------------------------------------------
  'Column spacing looks irregular': {
    fr: 'Espacement des poteaux irrégulier',
    ar: 'تباعد الأعمدة يبدو غير منتظم',
    zh: '柱间距看似不规则',
  },
  'The visible columns are not evenly spaced across the frame.': {
    fr: 'Les poteaux visibles ne sont pas espacés régulièrement dans le cadre.',
    ar: 'الأعمدة الظاهرة ليست متباعدة بانتظام عبر الإطار.',
    zh: '画面中可见柱间距不均匀。',
  },
  'Column spacing appears to vary, which is commonly caused by a setting-out error rather than a design change.': {
    fr: 'L’espacement des poteaux semble varier, ce qui vient généralement d’une erreur d’implantation plutôt que d’une modification de conception.',
    ar: 'يبدو أن تباعد الأعمدة متفاوت، وهو ما ينتج عادة عن خطأ في التوقيع وليس عن تغيير في التصميم.',
    zh: '柱间距似乎不一致，通常是由放线误差而非设计变更引起的。',
  },
  'The gaps between adjacent vertical members differ visibly.': {
    fr: 'Les intervalles entre éléments verticaux adjacents diffèrent visiblement.',
    ar: 'تختلف الفجوات بين العناصر الرأسية المتجاورة بشكل واضح.',
    zh: '相邻竖向构件之间的间距明显不同。',
  },
  'Verify column positions against the setting-out drawing using a physical survey measurement before any corrective work is planned.': {
    fr: 'Vérifiez la position des poteaux par rapport au plan d’implantation par un relevé physique avant toute reprise.',
    ar: 'تحقق من مواقع الأعمدة مقابل مخطط التوقيع بقياس مساحي ميداني قبل التخطيط لأي عمل تصحيحي.',
    zh: '在计划任何整改前，先用实测核对柱位置与放线图。',
  },
  'across the mid-ground': {
    fr: 'au second plan',
    ar: 'في وسط المشهد',
    zh: '画面中景',
  },
  'Open slab edge with no visible edge protection': {
    fr: 'Rive de dalle ouverte sans protection visible',
    ar: 'حافة بلاطة مفتوحة دون حماية ظاهرة',
    zh: '楼板临边无可见防护',
  },
  'A deck edge is exposed with no continuous barrier visible.': {
    fr: 'Une rive de plancher est exposée sans barrière continue visible.',
    ar: 'حافة السقف مكشوفة دون حاجز متواصل ظاهر.',
    zh: '楼板边缘裸露，未见连续围挡。',
  },
  'Edge protection is normally present at an open deck. Its absence in this view is either a genuine gap or simply outside the frame.': {
    fr: 'Une protection de rive est normalement présente sur un plancher ouvert. Son absence ici est soit un manque réel, soit hors cadre.',
    ar: 'عادة توجد حماية للحافة عند السقف المفتوح. وغيابها في هذا المنظر إما نقص حقيقي أو خارج الإطار فحسب.',
    zh: '敞开楼板通常应有临边防护。此处未见，可能是确实缺失，也可能在画面之外。',
  },
  'The deck perimeter shows no continuous rail or barrier.': {
    fr: 'Le pourtour du plancher ne montre aucun garde-corps continu.',
    ar: 'لا يظهر محيط السقف أي درابزين أو حاجز متواصل.',
    zh: '楼板周边未见连续栏杆或围挡。',
  },
  'Confirm edge protection physically before the next activity starts on this level.': {
    fr: 'Confirmez physiquement la protection de rive avant la prochaine activité à ce niveau.',
    ar: 'تأكد ميدانيًا من حماية الحافة قبل بدء النشاط التالي في هذا المستوى.',
    zh: '在该层下一道工序开始前，先实地确认临边防护。',
  },
  'upper left of the deck': {
    fr: 'en haut à gauche du plancher',
    ar: 'أعلى يسار السقف',
    zh: '楼板左上方',
  },
  // -- demo fixture: observations ---------------------------------------------
  'A steel frame structure with vertical columns is visible across the site.': {
    fr: 'Une ossature métallique avec des poteaux verticaux est visible sur le chantier.',
    ar: 'يظهر هيكل فولاذي بأعمدة رأسية عبر الموقع.',
    zh: '现场可见带竖向柱的钢框架结构。',
  },
  'Vertical steel members are clearly distinguishable in the mid-ground.': {
    fr: 'Des éléments métalliques verticaux sont clairement distinguables au second plan.',
    ar: 'يمكن تمييز العناصر الفولاذية الرأسية بوضوح في وسط المشهد.',
    zh: '中景中可清晰辨认竖向钢构件。',
  },
  'Scaffolding is erected along the left elevation, indicating work in progress there.': {
    fr: 'Un échafaudage est monté le long de la façade gauche, signe de travaux en cours.',
    ar: 'السقالات منصوبة على الواجهة اليسرى، مما يدل على أعمال جارية هناك.',
    zh: '左立面搭设有脚手架，表明该处正在施工。',
  },
  'A regular tubular scaffold pattern is visible on the left side of the frame.': {
    fr: 'Une trame régulière d’échafaudage tubulaire est visible à gauche du cadre.',
    ar: 'يظهر نمط سقالات أنبوبية منتظمة على الجانب الأيسر من الإطار.',
    zh: '画面左侧可见规则的钢管脚手架。',
  },
  'An open edge is visible at the upper level without a visible guardrail in this view.': {
    fr: 'Une rive ouverte est visible au niveau supérieur sans garde-corps apparent.',
    ar: 'تظهر حافة مفتوحة في المستوى العلوي دون درابزين ظاهر في هذا المنظر.',
    zh: '上层可见敞开边缘，此视角未见护栏。',
  },
  'The floor edge at upper-left shows no continuous barrier in the image.': {
    fr: 'La rive du plancher en haut à gauche ne montre aucune barrière continue sur l’image.',
    ar: 'لا تظهر حافة الأرضية أعلى اليسار أي حاجز متواصل في الصورة.',
    zh: '图像左上方楼板边缘未见连续围挡。',
  },
  // -- test fixtures: detection evidence --------------------------------------
  'nine cast columns are visible across the frame': {
    fr: 'neuf poteaux coulés sont visibles dans le cadre',
    ar: 'تظهر تسعة أعمدة مصبوبة عبر الإطار',
    zh: '画面中可见九根现浇柱',
  },
  'a dense bar mat fills the lower half of the frame': {
    fr: 'un tapis dense d’armatures remplit la moitié inférieure du cadre',
    ar: 'تملأ شبكة حديد كثيفة النصف السفلي من الإطار',
    zh: '密集的钢筋网布满画面下半部分',
  },
  'an open trench is visible at the frame edge': {
    fr: 'une fouille ouverte est visible au bord du cadre',
    ar: 'تظهر حفرة مفتوحة عند حافة الإطار',
    zh: '画面边缘可见敞开沟槽',
  },
  'no scaffold tower appears anywhere in the frame': {
    fr: 'aucune tour d’échafaudage n’apparaît dans le cadre',
    ar: 'لا تظهر أي برج سقالات في الإطار',
    zh: '画面中未见任何脚手架塔',
  },
  // -- test fixtures: observations --------------------------------------------
  'Column casting is part way across the bay.': {
    fr: 'Le coulage des poteaux est en cours dans la travée.',
    ar: 'صب الأعمدة جارٍ جزئيًا عبر الباكية.',
    zh: '该开间柱浇筑已完成一部分。',
  },
  'formwork and column starters mid-frame': {
    fr: 'coffrage et amorces de poteaux au centre du cadre',
    ar: 'قوالب وبدايات أعمدة في وسط الإطار',
    zh: '画面中部为模板与柱预留插筋',
  },
  // -- test fixtures: AI finding ----------------------------------------------
  'Open excavation at the frame edge': {
    fr: 'Fouille ouverte au bord du cadre',
    ar: 'حفرة مفتوحة عند حافة الإطار',
    zh: '画面边缘敞开开挖',
  },
  'An open excavation is visible beside the working area.': {
    fr: 'Une fouille ouverte est visible près de la zone de travail.',
    ar: 'تظهر حفرة مفتوحة بجوار منطقة العمل.',
    zh: '作业区旁可见敞开基坑。',
  },
  'The trench edge has no visible barrier.': {
    fr: 'Le bord de la tranchée n’a aucune barrière visible.',
    ar: 'لا يوجد حاجز ظاهر على حافة الخندق.',
    zh: '沟槽边缘未见围挡。',
  },
  'A soil trench runs along the right edge of the frame.': {
    fr: 'Une tranchée de terre longe le bord droit du cadre.',
    ar: 'يمتد خندق ترابي على طول الحافة اليمنى من الإطار.',
    zh: '一条土沟沿画面右边缘延伸。',
  },
  'Walk the trench edge and confirm the barrier is in place.': {
    fr: 'Parcourez le bord de la tranchée et confirmez que la barrière est en place.',
    ar: 'تجول على حافة الخندق وتأكد من وجود الحاجز.',
    zh: '沿沟槽巡视，确认围挡已到位。',
  },
  'right edge of the frame': {
    fr: 'bord droit du cadre',
    ar: 'الحافة اليمنى من الإطار',
    zh: '画面右边缘',
  },
  // -- test fixtures: reasoning -----------------------------------------------
  'Column casting is part way across the bay and cannot be settled from one frame.': {
    fr: 'Le coulage des poteaux est en cours dans la travée et ne peut être tranché sur une seule image.',
    ar: 'صب الأعمدة جارٍ جزئيًا عبر الباكية ولا يمكن حسمه من صورة واحدة.',
    zh: '该开间柱浇筑尚未完成，单张影像无法判定。',
  },
  'Whether the column count matches the programme is not readable here.': {
    fr: 'Le nombre de poteaux ne peut être rapproché du programme sur cette image.',
    ar: 'لا يمكن قراءة ما إذا كان عدد الأعمدة مطابقًا للبرنامج هنا.',
    zh: '此处无法判断柱数量是否与计划相符。',
  },
  'Nine columns are visible and the deterministic comparison returns ATTENTION, but spacing, cover and anchorage are not established by the image.': {
    fr: 'Neuf poteaux sont visibles et la comparaison déterministe renvoie ATTENTION, mais l’espacement, l’enrobage et l’ancrage ne sont pas établis par l’image.',
    ar: 'تظهر تسعة أعمدة وتعيد المقارنة الحتمية ATTENTION، لكن التباعد والغطاء والتثبيت لا تثبتها الصورة.',
    zh: '可见九根柱，确定性比对为 ATTENTION，但间距、保护层与锚固无法由图像确定。',
  },
  'Walk the bay against the approved column grid before the next pour.': {
    fr: 'Parcourez la travée par rapport à la trame de poteaux approuvée avant la prochaine coulée.',
    ar: 'تجول في الباكية مقابل شبكة الأعمدة المعتمدة قبل الصبة التالية.',
    zh: '下次浇筑前，对照已批准柱网巡视该开间。',
  },
  'Physically confirm the column count and starter positions on site.': {
    fr: 'Confirmez physiquement sur site le nombre de poteaux et la position des amorces.',
    ar: 'تأكد ميدانيًا من عدد الأعمدة ومواقع البدايات في الموقع.',
    zh: '到现场实地确认柱数量与插筋位置。',
  },
  // -- conduit example (task illustration) ------------------------------------
  'Embedded electrical conduit is visible along the wall.': {
    fr: 'Un conduit électrique encastré est visible le long du mur.',
    ar: 'يظهر مسار كهربائي مدفون على طول الجدار.',
    zh: '沿墙可见预埋电气导管。',
  },
  'A continuous conduit run is visible against the wall surface.': {
    fr: 'Un cheminement continu de conduit est visible contre la paroi.',
    ar: 'يظهر مسار مواسير متواصل على سطح الجدار.',
    zh: '墙面上可见连续的导管走线。',
  },
  'Embedded conduit run along the wall': {
    fr: 'Cheminement encastré le long du mur',
    ar: 'مسار مواسير مدفون على طول الجدار',
    zh: '沿墙预埋导管走线',
  },
  'An embedded electrical conduit run is visible along the wall.': {
    fr: 'Un cheminement électrique encastré est visible le long du mur.',
    ar: 'يظهر مسار كهربائي مدفون على طول الجدار.',
    zh: '沿墙可见预埋电气导管走线。',
  },
  'The conduit path should be confirmed against the MEP layout before covering.': {
    fr: 'Le cheminement doit être confirmé par rapport au plan MEP avant recouvrement.',
    ar: 'يجب التأكد من مسار المواسير مقابل مخطط الأعمال الميكانيكية والكهربائية قبل التغطية.',
    zh: '隐蔽前，应对照机电图纸确认导管路径。',
  },
  'A linear conduit is visible running horizontally along the wall.': {
    fr: 'Un conduit linéaire est visible horizontalement le long du mur.',
    ar: 'يظهر مسار خطي أفقي على طول الجدار.',
    zh: '可见一条沿墙水平走向的导管。',
  },
  'Verify the conduit route against the approved MEP drawing before concealment.': {
    fr: 'Vérifiez le parcours du conduit par rapport au plan MEP approuvé avant dissimulation.',
    ar: 'تحقق من مسار المواسير مقابل المخطط المعتمد قبل الإخفاء.',
    zh: '隐蔽前，对照已批准机电图核实导管路由。',
  },
  'The conduit run is visible but its completeness cannot be settled from one frame.': {
    fr: 'Le cheminement est visible mais son achèvement ne peut être tranché sur une seule image.',
    ar: 'مسار المواسير ظاهر لكن لا يمكن حسم اكتماله من صورة واحدة.',
    zh: '导管走线可见，但单张影像无法判定其完整性。',
  },
  // -- construction domain: crane oversail, penetrations, cover & rebar -------
  'Crane jib oversail beyond the site boundary': {
    fr: 'Survol de flèche de grue au-delà de la limite de chantier',
    ar: 'تجاوز ذراع الرافعة خارج حدود الموقع',
    zh: '塔吊起重臂越界悬挑超出场地边界',
  },
  'Tower crane oversail requires neighbouring plot clearance before lifting over the perimeter.': {
    fr: 'Le survol de la grue à tour exige une autorisation de la parcelle voisine avant tout levage au-delà du périmètre.',
    ar: 'يتطلب تجاوز الرافعة البرجية لحدود الموقع تصريحًا من العقار المجاور قبل الرفع فوق المحيط.',
    zh: '塔吊越界悬挑在跨越场地周边起吊前须取得邻近地块许可。',
  },
  'Slab penetration sleeve and concrete cover around rebar require physical check before pour.': {
    fr: 'Le fourreau de réservation en dalle et l’enrobage du ferraillage doivent être contrôlés sur site avant coulage.',
    ar: 'تتطلب جلبة الفتحة في البلاطة والغطاء الخرساني حول حديد التسليح فحصًا ميدانيًا قبل الصب.',
    zh: '浇筑前须实地检查楼板预留洞套管及钢筋混凝土保护层。',
  },
};

/* ------------------------------------------------------------------ *
 * In-memory reuse cache
 *
 * Bounded, deterministic and process-local. A translation is keyed by the
 * EXACT source text plus the target language plus this memory version, so a
 * changed source or a changed memory can never serve a stale translation.
 * ------------------------------------------------------------------ */

const TRANSLATION_CACHE_LIMIT = 500;
const translationCache = new Map<string, ModelTranslationResult>();
const translationCacheOrder: string[] = [];

function cacheKey(source: string, target: string): string {
  return `${MODEL_TRANSLATION_VERSION}\n${target}\n${source}`;
}

function cacheGet(key: string): ModelTranslationResult | null {
  return translationCache.get(key) ?? null;
}

function cacheSet(key: string, value: ModelTranslationResult): void {
  if (translationCache.has(key)) return;
  if (translationCacheOrder.length >= TRANSLATION_CACHE_LIMIT) {
    const oldest = translationCacheOrder.shift();
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, value);
  translationCacheOrder.push(key);
}

/** Number of cached translations. Exposed for tests, never for the UI. */
export function modelTranslationCacheSize(): number {
  return translationCache.size;
}

/** Empty the reuse cache. Tests only; production never clears. */
export function clearModelTranslationCache(): void {
  translationCache.clear();
  translationCacheOrder.length = 0;
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/**
 * Translate ONE model-authored English string for display.
 *
 * Pure and total: unknown text, empty text and English itself all resolve to
 * the original with `translated: false`, never an invented or empty string.
 * A translation is claimed only on an exact memory hit for a non-English
 * target.
 */
export function translateModelText(
  source: unknown,
  target: InspectionLanguage,
): ModelTranslationResult {
  if (typeof source !== 'string') {
    return { source: '', text: '', translated: false, provider: 'none' };
  }
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { source, text: source, translated: false, provider: 'none' };
  }
  if (target === 'en') {
    return { source, text: source, translated: false, provider: 'none' };
  }
  if (target !== 'fr' && target !== 'ar' && target !== 'zh') {
    return { source, text: source, translated: false, provider: 'none' };
  }

  const key = cacheKey(trimmed, target);
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const entry = MEMORY[trimmed];
  let result: ModelTranslationResult;
  if (entry !== undefined) {
    const text = entry[target as ModelTranslationTarget];
    if (typeof text === 'string' && text.trim().length > 0) {
      result = { source, text, translated: true, provider: MODEL_TRANSLATION_VERSION };
    } else {
      result = { source, text: source, translated: false, provider: 'none' };
    }
  } else {
    result = { source, text: source, translated: false, provider: 'none' };
  }
  cacheSet(key, result);
  return result;
}

/**
 * Translate many strings at once, reusing valid cached entries.
 *
 * Order-preserving and duplicate-safe: the same source translated twice costs
 * one lookup. Never throws; every entry resolves to either a genuine
 * translation or the original with `translated: false`.
 */
export function translateModelTexts(
  sources: readonly string[],
  target: InspectionLanguage,
): readonly ModelTranslationResult[] {
  return sources.map((source) => translateModelText(source, target));
}

/**
 * Whether a translation exists for this exact source and target.
 *
 * The UI uses this to decide between a "translated" badge and an honest
 * fallback note, without ever implying a translation it does not have.
 */
export function hasModelTranslation(source: string, target: InspectionLanguage): boolean {
  if (target === 'en') return false;
  return translateModelText(source, target).translated;
}

/**
 * Build the per-inspection translation map shipped inside SessionView.
 *
 * Keys are the EXACT English source strings. Values carry fr/ar/zh display
 * texts plus per-language `translated` flags. The map is a presentation
 * projection: it is computed from canonical facts, never written back into
 * them, and a changed source simply misses the map and falls back.
 */
export function buildModelTranslationMap(
  sources: readonly string[],
): Readonly<Record<string, Readonly<Record<InspectionLanguage, ModelTranslationResult>>>> {
  const unique = [...new Set(sources.map((s) => (typeof s === 'string' ? s : '')))].filter(
    (s) => s.trim().length > 0,
  );
  const out: Record<string, Record<InspectionLanguage, ModelTranslationResult>> = {};
  for (const source of unique) {
    // Memory first, live cache second: fresh runs merge what the run filled,
    // restored inspections reuse whatever is still valid, and anything else
    // falls back honestly. Still a pure read - the async fill happens once per
    // run, never here and never on language switch.
    out[source] = {
      en: resolveDisplayTranslation(source, 'en'),
      fr: resolveDisplayTranslation(source, 'fr'),
      ar: resolveDisplayTranslation(source, 'ar'),
      zh: resolveDisplayTranslation(source, 'zh'),
    };
  }
  return out;
}

/**
 * Collect every user-facing MODEL prose string in a canonical inspection.
 *
 * Detection evidence, observation text, evidence descriptions, AI finding
 * fields and reasoning fields. Comparison-derived prose is NOT collected: it
 * is already regenerated per language from structured facts and needs no
 * translation memory.
 */
export function collectModelProse(input: {
  readonly detections: readonly { readonly evidence: string }[];
  readonly observations: readonly {
    readonly observation: string;
    readonly evidenceDescription: string;
  }[];
  readonly findings: readonly {
    readonly origin: string;
    readonly title: string;
    readonly observation: string;
    readonly reason: string;
    readonly evidence: string;
    readonly recommendation: string;
    readonly location: string | null;
  }[];
  readonly reasoning: {
    readonly summary: string;
    readonly whatMatters: string;
    readonly rationale: string;
    readonly recommendation: string;
    readonly verification: string;
  } | null;
}): readonly string[] {
  const out: string[] = [];
  for (const detection of input.detections) {
    if (detection.evidence.trim().length > 0) out.push(detection.evidence);
  }
  for (const observation of input.observations) {
    if (observation.observation.trim().length > 0) out.push(observation.observation);
    if (observation.evidenceDescription.trim().length > 0) out.push(observation.evidenceDescription);
  }
  for (const finding of input.findings) {
    // Only MODEL-authored (AI-origin) prose needs the memory. Comparison
    // findings are regenerated per language elsewhere.
    if (finding.origin !== 'AI') continue;
    if (finding.title.trim().length > 0) out.push(finding.title);
    if (finding.observation.trim().length > 0) out.push(finding.observation);
    if (finding.reason.trim().length > 0) out.push(finding.reason);
    if (finding.evidence.trim().length > 0) out.push(finding.evidence);
    if (finding.recommendation.trim().length > 0) out.push(finding.recommendation);
    if (finding.location !== null && finding.location.trim().length > 0) out.push(finding.location);
  }
  const reasoning = input.reasoning;
  if (reasoning !== null) {
    if (reasoning.summary.trim().length > 0) out.push(reasoning.summary);
    if (reasoning.whatMatters.trim().length > 0) out.push(reasoning.whatMatters);
    if (reasoning.rationale.trim().length > 0) out.push(reasoning.rationale);
    if (reasoning.recommendation.trim().length > 0) out.push(reasoning.recommendation);
    if (reasoning.verification.trim().length > 0) out.push(reasoning.verification);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * LIVE tier: novel prose through the already-configured Nebius chat path.
 *
 * The memory above cannot translate what it has never seen, and live
 * Nemotron reasoning is novel on every run. The application already owns an
 * authorized text-generation capability for exactly this shape of work: the
 * OpenAI-compatible chat endpoint on Nebius Token Factory, reached with the
 * same base URL, model, timeout and credential already configured for
 * construction reasoning. Translation reuses all four, so there is no new
 * service, no new host, no new credential and no new configuration variable.
 *
 * Authorization boundary, stated plainly: live translation runs if and only
 * if construction reasoning itself is configured (credential present,
 * reasoning enabled). Otherwise - offline, demo fixture, missing key - only
 * the memory serves, and everything else falls back honestly. When this file
 * says "live translation is unavailable", that boundary is what it means.
 *
 * Cost and timing, also plainly: at most one chat call per target language
 * per inspection run, only for sources the memory and the cache both miss,
 * computed once when the run finishes - never on language switch, never as a
 * vision or reasoning re-inference, never twice for the same source. A failed
 * call translates nothing and fails nothing else: the inspection stands as
 * run, with the original English shown and labelled.
 * ------------------------------------------------------------------ */

/** A translation call. Returns only validated translations, keyed by source.
 *  Sources with no usable translation are simply absent: the caller falls
 *  back to the original for those, never an invention. Implementations must
 *  never throw for transport or validation failures - an empty map is the
 *  fail-closed answer. */
export interface ModelTranslator {
  readonly name: string;
  translate(
    texts: readonly string[],
    target: ModelTranslationTarget,
  ): Promise<ReadonlyMap<string, string>>;
}

const LIVE_LANGUAGE_NAMES: Readonly<Record<ModelTranslationTarget, string>> = {
  fr: 'French',
  ar: 'Arabic',
  zh: 'Simplified Chinese',
};

const CONSTRUCTION_DOMAIN_GUIDANCE: Readonly<Record<ModelTranslationTarget, string>> = {
  fr:
    'Use accurate French civil/structural engineering terminology: translate "oversail" / "crane oversail" as '
    + '"survol" / "survol de grue" (never leave "oversail" in English), "slab" as "dalle" or "plancher", '
    + '"column" as "poteau", "wall" as "mur" or "voile", "opening" / "penetration" as "ouverture" / "réservation", '
    + '"formwork" as "coffrage", "reinforcement" / "rebar" as "ferraillage" / "armatures", "concrete cover" as "enrobage", '
    + '"MEP rough-in" / "conduit" / "embedded services" as "réseau MEP" / "conduit" / "incorporations", and "setting-out" as "implantation".',
  ar:
    'Use accurate Arabic civil/structural engineering terminology: translate "oversail" / "crane oversail" as '
    + '"تجاوز حدود الموقع" / "تجاوز ذراع الرافعة لحدود الموقع" (never leave "oversail" in English), "slab" as "بلاطة", '
    + '"column" as "عمود", "wall" as "جدار", "opening" / "penetration" as "فتحة", "formwork" as "قوالب" / "شدة", '
    + '"reinforcement" / "rebar" as "حديد التسليح", "concrete cover" as "الغطاء الخرساني", '
    + '"MEP rough-in" / "conduit" / "embedded services" as "تمديدات ميكانيكية وكهربائية" / "مسار مواسير مدفون", and "setting-out" as "التوقيع المساحي".',
  zh:
    'Use accurate Simplified Chinese civil/structural engineering terminology: translate "oversail" / "crane oversail" as '
    + '"越界悬挑" / "塔吊起重臂越界悬挑" (never leave "oversail" in English), "slab" as "楼板", "column" as "柱", '
    + '"wall" as "墙体", "opening" / "penetration" as "洞口" / "预留洞", "formwork" as "模板", '
    + '"reinforcement" / "rebar" as "钢筋", "concrete cover" as "混凝土保护层", '
    + '"MEP rough-in" / "conduit" / "embedded services" as "机电预留预埋" / "预埋导管", and "setting-out" as "放线".',
};

/**
 * Post-normalize leaked English construction jargon (specifically "oversail" /
 * "oversailing") when a live LLM translation leaves the English term embedded
 * in an otherwise localized sentence.
 *
 * Narrow by construction: whole-word match on the single known term, applied
 * only when the sentence already carries the target script (Arabic, Chinese)
 * or is French output. A leading capital is preserved so sentence-initial
 * position keeps its casing; Arabic and Chinese have no case. Anything else
 * passes through untouched - this repairs one term, never rephrases prose.
 */
export function normalizeTranslatedConstructionTerms(
  text: string,
  target: ModelTranslationTarget,
): string {
  if (!/\boversail(?:ing)?\b/i.test(text)) return text;
  const replace = (term: string): string =>
    text.replace(/\boversail(?:ing)?\b/gi, (match) =>
      /^[A-Z]/.test(match) ? term.charAt(0).toUpperCase() + term.slice(1) : term,
    );
  if (target === 'ar' && /[\u0600-\u06FF]/.test(text)) {
    return replace('تجاوز حدود الموقع');
  }
  if (target === 'zh' && /[\u4E00-\u9FFF]/.test(text)) {
    return replace('越界悬挑');
  }
  if (target === 'fr') {
    return replace('survol');
  }
  return text;
}

/** Largest batch per call, so one verbose inspection cannot blow the budget. */
export const MAX_TRANSLATION_BATCH = 24;

/**
 * The translation instruction. Preservation is the load-bearing sentence:
 * identifiers, grid references, counts, measurements and the deterministic
 * vocabulary must arrive byte-identical, because a "translation" that
 * renumbers the evidence is a fabrication.
 */
export function buildTranslationPrompt(
  target: ModelTranslationTarget,
  count: number,
): string {
  return [
    `You translate construction site inspection prose from English into ${LIVE_LANGUAGE_NAMES[target]}.`,
    'Translate meaning faithfully in a plain professional register. Each input is one independent sentence or label.',
    CONSTRUCTION_DOMAIN_GUIDANCE[target],
    'Keep planned/expected state distinct from visual observations, and never turn an unverified candidate into a confirmed fact.',
    'Preserve EXACTLY as written, never translating or renumbering: model and provider names, element codes,',
    'identifiers, grid references such as C1-C12, numbers with their units, counts, measurements, timestamps,',
    'and the words ATTENTION, MATCH, UNDETERMINED, SUPPORTED, UNCERTAIN and INSUFFICIENT_EVIDENCE.',
    'Do not add facts, advice or explanation. Plain text only, no markdown, no quotation marks added.',
    'Return STRICT JSON only, no preamble, no commentary, shaped exactly as:',
    `{"translations": ["...", ...]} with exactly ${count} strings in the same order as the inputs.`,
  ].join('\n');
}

/**
 * Validate ONE untrusted translation response. Fail-closed per entry: only a
 * non-empty string at its own index is accepted; anything else leaves that
 * source honestly untranslated rather than repaired or shifted.
 *
 * Accepts the inner object directly (what the translator hands over after
 * unwrapping the chat envelope) as well as a still-enveloped payload, so a
 * gateway shape cannot silently void every entry.
 */
export function parseTranslationResponse(
  rawText: string,
  count: number,
): readonly (string | null)[] {
  const allNull = (): readonly (string | null)[] => Array<string | null>(count).fill(null);
  const aligned = (value: unknown): readonly (string | null)[] | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const list = (value as Record<string, unknown>)['translations'];
    if (!Array.isArray(list) || list.length !== count) return null;
    return list.map((entry) =>
      typeof entry === 'string' && entry.trim().length > 0 ? entry : null,
    );
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return allNull();
  }
  const direct = aligned(parsed);
  if (direct !== null) return direct;
  const content = extractTranslationContent(parsed);
  if (content === null) return allNull();
  let inner: unknown;
  try {
    inner = JSON.parse(content);
  } catch {
    return allNull();
  }
  return aligned(inner) ?? allNull();
}

/** Tolerate the OpenAI-compatible envelope and a bare content string. */
function extractTranslationContent(parsed: unknown): string | null {
  if (typeof parsed === 'string') return parsed;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const choices = (parsed as Record<string, unknown>)['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message = (first as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : null;
}

export interface NebiusChatTranslatorOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly apiKey: string;
  readonly fetchImpl?: ModelFetchLike;
}

/** Injectable fetch, so tests never perform real network I/O. */
export type ModelFetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Novel prose translated through the configured Nebius chat endpoint.
 *
 * Same resolved base URL (already host-allowlisted), bearer handling and
 * deadline enforcement as the vision and reasoning stages. Nothing is logged,
 * so there is nothing that could leak the credential. Throws nothing: every
 * failure mode - transport, status, shape - resolves to an empty map, which
 * is the honest "unavailable" the caller renders as the labelled original.
 */
export class NebiusChatTranslator implements ModelTranslator {
  public readonly name = 'live-neb-translate-v1' as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly apiKey: string;
  private readonly fetchImpl: ModelFetchLike;

  public constructor(options: NebiusChatTranslatorOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.maxTokens = options.maxTokens;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? (((input, init) => fetch(input, init as RequestInit)) as ModelFetchLike);
  }

  public async translate(
    texts: readonly string[],
    target: ModelTranslationTarget,
  ): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(
      texts.map((text) => (typeof text === 'string' ? text.trim() : '')).filter((text) => text.length > 0),
    )];
    for (let at = 0; at < unique.length; at += MAX_TRANSLATION_BATCH) {
      const slice = unique.slice(at, at + MAX_TRANSLATION_BATCH);
      const accepted = await this.translateBatch(slice, target);
      for (const [index, text] of accepted) {
        const source = slice[index];
        if (source !== undefined && text !== null) out.set(source, text);
      }
    }
    return out;
  }

  private async translateBatch(
    sources: readonly string[],
    target: ModelTranslationTarget,
  ): Promise<ReadonlyMap<number, string>> {
    const out = new Map<number, string>();
    let rawText: string;
    try {
      rawText = await this.callModel(sources, target);
    } catch {
      return out;
    }
    const parsed = parseTranslationResponse(rawText, sources.length);
    parsed.forEach((text, index) => {
      if (text !== null) out.set(index, normalizeTranslatedConstructionTerms(text, target));
    });
    return out;
  }

  private async callModel(sources: readonly string[], target: ModelTranslationTarget): Promise<string> {
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: buildTranslationPrompt(target, sources.length) },
        { role: 'user', content: JSON.stringify({ target_language: LIVE_LANGUAGE_NAMES[target], texts: sources }) },
      ],
      response_format: { type: 'json_object' },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) return '';
      try {
        return await response.text();
      } catch {
        return '';
      }
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build the live translator from the process environment, or null.
 *
 * THE DOCUMENTED BOUNDARY: live translation runs if and only if construction
 * reasoning itself is configured - the same Nebius Token Factory credential
 * (NEBIUS_API_KEY) and the same reasoning model selection
 * (NEBIUS_REASONING_MODEL and friends), enabled. No new variable, no new
 * credential, no new service. Null means memory plus honest fallback: offline,
 * demo fixture, switched-off reasoning, or missing key. Callers must treat
 * null as "live translation is unavailable", never as an error.
 */
export function createTranslatorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: ModelFetchLike,
): ModelTranslator | null {
  const config = resolveReasoningConfig(env);
  if (!config.enabled) return null;
  const credentials = safeResolveReasoningCredentials(env);
  if (credentials === undefined) return null;
  return new NebiusChatTranslator(
    {
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      apiKey: credentials.apiKey,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    },
  );
}

/* ------------------------------------------------------------------ *
 * Live cache: exact source, target language, contract version.
 *
 * Process-local and synchronous, so the sync view builder and restored
 * inspections reuse valid entries with no network. A changed source or a
 * bumped version misses and falls back; an outdated translation can never
 * appear current.
 * ------------------------------------------------------------------ */

const liveTranslationCache = new Map<string, string>();
const liveTranslationOrder: string[] = [];
const LIVE_CACHE_LIMIT = 500;

/**
 * Sources a translator positively answered WITHOUT a translation.
 *
 * A failed call records nothing - a transient outage must be retried on the
 * next run. But when a call succeeds and still carries no translation for a
 * source, re-requesting it on every later run would burn budget forever for
 * an answer that is already known. Settled misses are keyed exactly like
 * hits, so they invalidate identically when the source or version changes.
 */
const liveTranslationMiss = new Set<string>();

function liveCacheKey(source: string, target: string): string {
  return `${LIVE_TRANSLATION_VERSION}\n${target}\n${source}`;
}

/** Synchronous read of a cached live translation, or null. */
export function lookupLiveTranslation(source: string, target: InspectionLanguage): string | null {
  if (target === 'en') return null;
  return liveTranslationCache.get(liveCacheKey(source.trim(), target)) ?? null;
}

function storeLiveTranslation(source: string, target: ModelTranslationTarget, text: string): void {
  const key = liveCacheKey(source.trim(), target);
  if (liveTranslationCache.has(key)) return;
  if (liveTranslationOrder.length >= LIVE_CACHE_LIMIT) {
    const oldest = liveTranslationOrder.shift();
    if (oldest !== undefined) liveTranslationCache.delete(oldest);
  }
  liveTranslationCache.set(key, text);
  liveTranslationOrder.push(key);
}

/** Number of cached live translations. Exposed for tests, never for the UI. */
export function liveTranslationCacheSize(): number {
  return liveTranslationCache.size;
}

/** Empty the live cache. Tests only; production never clears. */
export function clearLiveTranslationCache(): void {
  liveTranslationCache.clear();
  liveTranslationOrder.length = 0;
  liveTranslationMiss.clear();
}

/**
 * Whether a source is settled for a target: memory hit, live hit, or a
 * positively answered miss. Settled sources are never re-requested; only
 * unsettled ones may cost a call. English is settled by definition.
 */
export function isTranslationSettled(source: string, target: InspectionLanguage): boolean {
  if (target === 'en' || typeof source !== 'string' || source.trim().length === 0) return true;
  if (translateModelText(source, target).translated) return true;
  const key = liveCacheKey(source.trim(), target);
  return liveTranslationCache.has(key) || liveTranslationMiss.has(key);
}

/**
 * Resolve ONE source for display: memory first, live cache second, honest
 * fallback otherwise. Pure read, never network. The async live fill happens
 * once per run (see translateModelTextsLive), never on language switch.
 */
export function resolveDisplayTranslation(
  source: string,
  target: InspectionLanguage,
): ModelTranslationResult {
  const remembered = translateModelText(source, target);
  if (remembered.translated) return remembered;
  if (typeof source !== 'string' || source.trim().length === 0 || target === 'en') {
    return remembered;
  }
  const live = lookupLiveTranslation(source, target);
  if (live !== null) {
    return { source, text: live, translated: true, provider: LIVE_TRANSLATION_VERSION };
  }
  return remembered;
}

/**
 * Fill live translations for sources the memory and cache both miss.
 *
 * At most one translator call per target language, de-duplicated sources,
 * memory hits never re-requested. Never throws: a failing translator or
 * language simply keeps its honest fallback. Not a vision or reasoning
 * inference: it translates finished prose and feeds nothing back upstream.
 */
export async function translateModelTextsLive(
  sources: readonly string[],
  translator: ModelTranslator | null,
  targets: readonly ModelTranslationTarget[] = ['fr', 'ar', 'zh'],
): Promise<void> {
  if (translator === null) return;
  const unique = [...new Set(
    sources.filter((s) => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()),
  )];
  if (unique.length === 0) return;
  for (const target of targets) {
    const missing = unique.filter((source) => !isTranslationSettled(source, target));
    if (missing.length === 0) continue;
    let translated: ReadonlyMap<string, string>;
    try {
      translated = await translator.translate(missing, target);
    } catch {
      continue;
    }
    if (translated.size === 0) continue;
    for (const source of missing) {
      const text = translated.get(source);
      if (typeof text === 'string' && text.trim().length > 0) {
        storeLiveTranslation(source, target, text);
      } else {
        // Positively answered without a translation: settled, not retried.
        liveTranslationMiss.add(liveCacheKey(source, target));
      }
    }
  }
}
