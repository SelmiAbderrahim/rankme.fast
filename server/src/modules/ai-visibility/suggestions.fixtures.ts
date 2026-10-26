/**
 * Deterministic evaluation fixtures for AI-Visibility suggestions.
 *
 * One realistic site, EpisodeBrief, whose offering is podcast show notes,
 * transcripts and episode titles. The English fixture is the reported
 * production case: its top queries ("episode pricing") are page labels, not
 * categories. Every other locale carries the same site written natively
 * (crawled copy, never machine-translated English), so the evaluation proves
 * category relevance and output language for all seven locales.
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';
import type { EvidencePage } from './site-profile.js';

export const FIXTURE_DOMAIN = 'episodebrief.com';

interface LocaleFixture {
  pages: EvidencePage[];
  keywords: string[];
  gscQueries: string[];
  /** Phrases a buyer would recognise as this site's category in that language. */
  expectedCategoryTerms: string[];
  /** Navigation terms that must never become a category or appear in a prompt. */
  navigationTerms: string[];
}

const page = (
  path: string,
  title: string,
  metaDescription: string,
  h1: string[],
): EvidencePage => ({ url: `https://${FIXTURE_DOMAIN}${path}`, title, metaDescription, h1 });

export const LOCALE_FIXTURES: Record<SupportedLocale, LocaleFixture> = {
  en: {
    pages: [
      page(
        '/',
        'EpisodeBrief — Turn podcast episodes into show notes',
        'Generate podcast show notes, transcripts and episode titles from any podcast episode.',
        ['Podcast show notes in minutes'],
      ),
      page('/pricing', 'Episode pricing | EpisodeBrief', 'Pay per episode. No subscription.', [
        'Episode pricing',
      ]),
      page(
        '/transcripts',
        'Podcast transcripts that are ready to publish',
        'Accurate podcast transcripts with speaker labels.',
        [],
      ),
    ],
    keywords: ['episode pricing', 'podcast show notes generator'],
    gscQueries: ['episode pricing', 'podcast transcript tool'],
    expectedCategoryTerms: ['show notes', 'transcript'],
    navigationTerms: ['pricing'],
  },
  fr: {
    pages: [
      page(
        '/fr',
        'EpisodeBrief : notes de podcast pour chaque épisode',
        'Créez des notes de podcast, des transcriptions de podcast et des titres à partir de chaque épisode.',
        ['Notes de podcast en quelques minutes'],
      ),
      page('/fr/tarifs', 'Tarifs | EpisodeBrief', 'Payez par épisode, sans abonnement.', ['Tarifs']),
      page(
        '/fr/transcriptions',
        'Transcription de podcast prête à publier',
        'Une transcription de podcast précise, avec les intervenants.',
        [],
      ),
    ],
    keywords: ['tarif épisode'],
    gscQueries: ['tarif épisode'],
    expectedCategoryTerms: ['notes de podcast', 'transcription'],
    navigationTerms: ['tarif'],
  },
  de: {
    pages: [
      page(
        '/de',
        'EpisodeBrief: Shownotes für Podcast-Folgen',
        'Erstelle Podcast Shownotes, Podcast Transkripte und Folgentitel aus jeder Folge.',
        ['Podcast Shownotes in Minuten'],
      ),
      page('/de/preise', 'Preise | EpisodeBrief', 'Zahle pro Folge, ohne Abo.', ['Preise']),
      page(
        '/de/transkripte',
        'Podcast Transkripte, bereit zur Veröffentlichung',
        'Genaue Podcast Transkripte mit Sprecherzuordnung.',
        [],
      ),
    ],
    keywords: ['folgen preise'],
    gscQueries: ['folgen preise'],
    expectedCategoryTerms: ['podcast shownotes', 'podcast transkripte'],
    navigationTerms: ['preise'],
  },
  es: {
    pages: [
      page(
        '/es',
        'EpisodeBrief: notas de podcast para cada episodio',
        'Crea notas de podcast, transcripciones de podcast y títulos a partir de cada episodio.',
        ['Notas de podcast en minutos'],
      ),
      page('/es/precios', 'Precios | EpisodeBrief', 'Paga por episodio, sin suscripción.', ['Precios']),
      page(
        '/es/transcripciones',
        'Transcripción de podcast lista para publicar',
        'Transcripciones de podcast precisas con hablantes.',
        [],
      ),
    ],
    keywords: ['precio episodio'],
    gscQueries: ['precio episodio'],
    expectedCategoryTerms: ['notas de podcast', 'transcripci'],
    navigationTerms: ['precio'],
  },
  ru: {
    pages: [
      page(
        '/ru',
        'EpisodeBrief: заметки к выпускам подкаста',
        'Создавайте заметки к подкасту, расшифровки подкаста и заголовки из каждого выпуска.',
        ['Заметки к подкасту за минуты'],
      ),
      page('/ru/tseny', 'Цены | EpisodeBrief', 'Платите за выпуск, без подписки.', ['Цены']),
      page(
        '/ru/rasshifrovka',
        'Расшифровка подкаста, готовая к публикации',
        'Точная расшифровка подкаста с разметкой спикеров.',
        [],
      ),
    ],
    keywords: ['цена выпуска'],
    gscQueries: ['цена выпуска'],
    expectedCategoryTerms: ['расшифровк', 'подкаст'],
    navigationTerms: ['цена', 'цены'],
  },
  ar: {
    pages: [
      page(
        '/ar',
        'EpisodeBrief: ملاحظات الحلقات للبودكاست',
        'أنشئ ملاحظات البودكاست والنصوص المكتوبة للبودكاست وعناوين الحلقات من كل حلقة.',
        ['ملاحظات البودكاست في دقائق'],
      ),
      page('/ar/prices', 'الأسعار | EpisodeBrief', 'ادفع لكل حلقة بدون اشتراك.', ['الأسعار']),
      page(
        '/ar/transcripts',
        'النصوص المكتوبة للبودكاست جاهزة للنشر',
        'النصوص المكتوبة للبودكاست دقيقة مع تحديد المتحدثين.',
        [],
      ),
    ],
    keywords: ['سعر الحلقة'],
    gscQueries: ['سعر الحلقة'],
    expectedCategoryTerms: ['البودكاست'],
    navigationTerms: ['سعر', 'الأسعار'],
  },
  zh: {
    pages: [
      page(
        '/zh',
        'EpisodeBrief：播客节目笔记',
        '从每一期播客生成播客节目笔记、播客文字稿和节目标题。',
        ['几分钟生成播客节目笔记'],
      ),
      page('/zh/pricing', '价格 | EpisodeBrief', '按期付费，无需订阅。', ['价格']),
      page('/zh/transcripts', '可直接发布的播客文字稿', '精准的播客文字稿，标注说话人。', []),
    ],
    keywords: ['节目价格'],
    gscQueries: ['节目价格'],
    expectedCategoryTerms: ['播客'],
    navigationTerms: ['价格'],
  },
};

/** Competitors the account stored for the fixture site — the only rivals a prompt may name. */
export const FIXTURE_COMPETITORS = ['castmagic.io', 'podsqueeze.com'];
