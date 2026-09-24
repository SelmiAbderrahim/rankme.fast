import { AiAvailabilityError, AiBudgetRefusalError, AiMalformedOutputError, AiQuotaError, AiSafetyError, AiTimeoutError, type AiGenerationProvider, type AiGenerationResult, type AiJsonSchema, type GenerateStructuredInput, } from './ai-generation.js';
import type { SupportedLocale } from '../i18n/locales.js';
export type FakeAiOutcome = 'success' | 'timeout' | 'quota' | 'unavailable' | 'malformed' | 'safety' | 'budget';
export interface FakeAiGenerationOptions {
    /** Consumed in order; the final outcome repeats after the sequence ends. */
    outcomes?: readonly FakeAiOutcome[];
    /** Task-specific deterministic override, useful when a Zod refinement is stricter than JSON Schema. */
    objects?: Partial<Record<GenerateStructuredInput<object>['task'], Readonly<object>>>;
}
interface JsonSchemaNode extends Record<string, unknown> {
    type?: string | readonly string[];
    const?: unknown;
    enum?: readonly unknown[];
    properties?: Readonly<Record<string, AiJsonSchema>>;
    required?: readonly string[];
    items?: AiJsonSchema;
    minItems?: number;
    minimum?: number;
    minLength?: number;
    format?: string;
    oneOf?: readonly AiJsonSchema[];
    anyOf?: readonly AiJsonSchema[];
}
function fakeString(schema: JsonSchemaNode): string {
    const formatted = schema.format === 'date-time'
        ? '2026-01-01T00:00:00.000Z'
        : schema.format === 'date'
            ? '2026-01-01'
            : schema.format === 'email'
                ? 'fixture@example.test'
                : schema.format === 'uri'
                    ? 'https://example.test/'
                    : 'fixture';
    return formatted.padEnd(Math.max(formatted.length, schema.minLength ?? 0), 'x');
}
/** Deterministic, content-free JSON-Schema sample used only by the keyless fake. */
export function makeFakeSchemaValue(schema: AiJsonSchema): unknown {
    const node: JsonSchemaNode = schema;
    if ('const' in node)
        return node.const;
    if (node.enum && node.enum.length > 0)
        return node.enum[0];
    const union = node.oneOf ?? node.anyOf;
    if (union && union.length > 0)
        return makeFakeSchemaValue(union[0]!);
    const type = Array.isArray(node.type) ? node.type.find((item) => item !== 'null') : node.type;
    switch (type) {
        case 'object': {
            const value: Record<string, unknown> = {};
            const properties = node.properties ?? {};
            const keys = node.required ?? Object.keys(properties);
            for (const key of keys)
                value[key] = makeFakeSchemaValue(properties[key] ?? {});
            return value;
        }
        case 'array':
            return Array.from({ length: Math.max(1, node.minItems ?? 0) }, () => makeFakeSchemaValue(node.items ?? {}));
        case 'integer':
            return Math.ceil(node.minimum ?? 0);
        case 'number':
            return node.minimum ?? 0;
        case 'boolean':
            return true;
        case 'null':
            return null;
        case 'string':
        default:
            return fakeString(node);
    }
}
/**
 * Task-aware deterministic sample for `keyword_clustering`.
 *
 * The generic schema sample fills `memberIds` with `"fixture"`, which the
 * clustering pipeline's citation-stripping then drops (hallucinated member
 * ids never survive), so every keyless-stack clustering pass persisted the
 * "finished without clusters" terminal — the accept/dismiss workspace was
 * undrivable in dev/CI. Echo the REAL member ids from the profile's
 * sanitized input instead: content-free labels, deterministic split, and
 * every id verifiably cited from the input (the same guarantee the live
 * providers are held to). Falls back to the generic sample whenever the
 * input shape is not the clustering payload.
 */
function parseSanitizedInput(sanitizedInput: string): unknown {
    const match = /<untrusted_customer_data>\n([\s\S]*)\n<\/untrusted_customer_data>/.exec(sanitizedInput);
    if (!match)
        return null;
    try {
        return JSON.parse(match[1]!);
    }
    catch {
        return null;
    }
}
interface FakeGeneratedCopy {
    explanation: string;
    contentBriefTitle: string;
    contentBriefAudience: string;
    contentBriefOutline: string;
    draftTitle: string;
    draftBody: string;
    competitorComparison: string;
    keywordClusterA: string;
    keywordClusterB: string;
    reviewComplaintLabel: string;
    reviewPraiseLabel: string;
    reviewSummary: string;
    appReviewLabel: string;
    brandDigest: string;
    fabricatedBrandDigest: string;
    audienceTitle: string;
    audienceSummary: string;
    briefScoreRationale: string;
    briefOutlineHeading: (index: number) => string;
    briefOutlinePurpose: string;
    briefQuestion: (index: number) => string;
    disavowRationale: string;
    clusterLabel: (index: number) => string;
}
/** Authored product prose for keyless/dev generation in every supported locale. */
const FAKE_GENERATED_COPY: Record<SupportedLocale, FakeGeneratedCopy> = {
    en: {
        explanation: 'The supplied evidence points to a clear content opportunity.',
        contentBriefTitle: 'Evidence-led content brief',
        contentBriefAudience: 'Readers looking for a clear, practical answer',
        contentBriefOutline: 'Explain the topic using the supplied evidence',
        draftTitle: 'A practical guide based on the supplied evidence',
        draftBody: 'This draft explains the topic using only the supplied facts.',
        competitorComparison: 'The supplied evidence highlights meaningful differences between the pages.',
        keywordClusterA: 'Related keyword group A',
        keywordClusterB: 'Related keyword group B',
        reviewComplaintLabel: 'Recurring customer concern',
        reviewPraiseLabel: 'Recurring customer praise',
        reviewSummary: 'This theme is supported by the cited stored reviews.',
        appReviewLabel: 'Recurring app feedback',
        brandDigest: 'The retained mentions show a recurring brand signal.',
        fabricatedBrandDigest: 'This brand signal deliberately cites an unavailable row.',
        audienceTitle: 'Recurring audience request',
        audienceSummary: 'The retained sources show a recurring audience need.',
        briefScoreRationale: 'The guidance score uses only the stored corpus comparison.',
        briefOutlineHeading: (index) => `Evidence-led section ${index}`,
        briefOutlinePurpose: 'Cover the topic using the cited stored page as evidence.',
        briefQuestion: (index) => `Stored audience question ${index}`,
        disavowRationale: 'This note cites the stored rubric observations for this row.',
        clusterLabel: (index) => `Related topic ${index}`,
    },
    ar: {
        explanation: 'تشير الأدلة المقدمة إلى فرصة واضحة لتحسين المحتوى.',
        contentBriefTitle: 'موجز محتوى قائم على الأدلة',
        contentBriefAudience: 'قراء يبحثون عن إجابة واضحة وعملية',
        contentBriefOutline: 'اشرح الموضوع بالاستناد إلى الأدلة المقدمة',
        draftTitle: 'دليل عملي قائم على الأدلة المقدمة',
        draftBody: 'تشرح هذه المسودة الموضوع باستخدام الحقائق المقدمة فقط.',
        competitorComparison: 'تبرز الأدلة المقدمة فروقاً مهمة بين الصفحات.',
        keywordClusterA: 'مجموعة كلمات رئيسية مترابطة أ',
        keywordClusterB: 'مجموعة كلمات رئيسية مترابطة ب',
        reviewComplaintLabel: 'ملاحظة متكررة من العملاء',
        reviewPraiseLabel: 'إشادة متكررة من العملاء',
        reviewSummary: 'تدعم المراجعات المحفوظة والمذكورة هذا الموضوع.',
        appReviewLabel: 'ملاحظات متكررة حول التطبيق',
        brandDigest: 'تُظهر الإشارات المحفوظة دلالة متكررة حول العلامة التجارية.',
        fabricatedBrandDigest: 'تستشهد هذه الدلالة عمداً بصف غير متاح.',
        audienceTitle: 'طلب متكرر من الجمهور',
        audienceSummary: 'تُظهر المصادر المحفوظة حاجة متكررة لدى الجمهور.',
        briefScoreRationale: 'تعتمد الدرجة الإرشادية على مقارنة المحتوى المحفوظ فقط.',
        briefOutlineHeading: (index) => `قسم قائم على الأدلة ${index}`,
        briefOutlinePurpose: 'غطِّ الموضوع باستخدام الصفحة المحفوظة والمذكورة دليلاً.',
        briefQuestion: (index) => `سؤال محفوظ من الجمهور ${index}`,
        disavowRationale: 'تستند هذه الملاحظة إلى مشاهدات معيار التقييم المحفوظة لهذا الصف.',
        clusterLabel: (index) => `موضوع مترابط ${index}`,
    },
    fr: {
        explanation: 'Les éléments fournis révèlent une occasion claire d’améliorer le contenu.',
        contentBriefTitle: 'Brief de contenu fondé sur les preuves',
        contentBriefAudience: 'Lecteurs à la recherche d’une réponse claire et pratique',
        contentBriefOutline: 'Expliquer le sujet à partir des éléments fournis',
        draftTitle: 'Guide pratique fondé sur les éléments fournis',
        draftBody: 'Ce brouillon explique le sujet uniquement à partir des faits fournis.',
        competitorComparison: 'Les éléments fournis mettent en évidence des différences utiles entre les pages.',
        keywordClusterA: 'Groupe de mots-clés associés A',
        keywordClusterB: 'Groupe de mots-clés associés B',
        reviewComplaintLabel: 'Préoccupation récurrente des clients',
        reviewPraiseLabel: 'Éloge récurrent des clients',
        reviewSummary: 'Ce thème est étayé par les avis enregistrés et cités.',
        appReviewLabel: 'Retour récurrent sur l’application',
        brandDigest: 'Les mentions retenues révèlent un signal de marque récurrent.',
        fabricatedBrandDigest: 'Ce signal de marque cite volontairement une ligne indisponible.',
        audienceTitle: 'Demande récurrente du public',
        audienceSummary: 'Les sources retenues révèlent un besoin récurrent du public.',
        briefScoreRationale: 'Le score indicatif repose uniquement sur la comparaison du corpus enregistré.',
        briefOutlineHeading: (index) => `Section fondée sur les preuves ${index}`,
        briefOutlinePurpose: 'Traiter le sujet en utilisant la page enregistrée et citée comme preuve.',
        briefQuestion: (index) => `Question enregistrée du public ${index}`,
        disavowRationale: 'Cette note cite les observations enregistrées de la grille pour cette ligne.',
        clusterLabel: (index) => `Sujet associé ${index}`,
    },
    de: {
        explanation: 'Die bereitgestellten Belege zeigen eine klare inhaltliche Chance.',
        contentBriefTitle: 'Evidenzbasiertes Content-Briefing',
        contentBriefAudience: 'Leserinnen und Leser, die eine klare, praktische Antwort suchen',
        contentBriefOutline: 'Das Thema anhand der bereitgestellten Belege erklären',
        draftTitle: 'Ein praktischer Leitfaden auf Basis der bereitgestellten Belege',
        draftBody: 'Dieser Entwurf erklärt das Thema ausschließlich anhand der bereitgestellten Fakten.',
        competitorComparison: 'Die bereitgestellten Belege zeigen relevante Unterschiede zwischen den Seiten.',
        keywordClusterA: 'Verwandte Keyword-Gruppe A',
        keywordClusterB: 'Verwandte Keyword-Gruppe B',
        reviewComplaintLabel: 'Wiederkehrendes Kundenanliegen',
        reviewPraiseLabel: 'Wiederkehrendes Kundenlob',
        reviewSummary: 'Dieses Thema wird durch die zitierten gespeicherten Bewertungen belegt.',
        appReviewLabel: 'Wiederkehrendes App-Feedback',
        brandDigest: 'Die gespeicherten Erwähnungen zeigen ein wiederkehrendes Markensignal.',
        fabricatedBrandDigest: 'Dieses Markensignal verweist absichtlich auf einen nicht vorhandenen Eintrag.',
        audienceTitle: 'Wiederkehrende Publikumsanfrage',
        audienceSummary: 'Die gespeicherten Quellen zeigen einen wiederkehrenden Bedarf des Publikums.',
        briefScoreRationale: 'Die Orientierungspunktzahl beruht ausschließlich auf dem gespeicherten Korpusvergleich.',
        briefOutlineHeading: (index) => `Evidenzbasierter Abschnitt ${index}`,
        briefOutlinePurpose: 'Das Thema mithilfe der zitierten gespeicherten Seite als Beleg behandeln.',
        briefQuestion: (index) => `Gespeicherte Publikumsfrage ${index}`,
        disavowRationale: 'Dieser Hinweis verweist auf die gespeicherten Bewertungsbeobachtungen für diese Zeile.',
        clusterLabel: (index) => `Verwandtes Thema ${index}`,
    },
    es: {
        explanation: 'Las pruebas aportadas señalan una oportunidad clara de contenido.',
        contentBriefTitle: 'Brief de contenido basado en pruebas',
        contentBriefAudience: 'Lectores que buscan una respuesta clara y práctica',
        contentBriefOutline: 'Explicar el tema usando las pruebas aportadas',
        draftTitle: 'Una guía práctica basada en las pruebas aportadas',
        draftBody: 'Este borrador explica el tema utilizando únicamente los hechos aportados.',
        competitorComparison: 'Las pruebas aportadas muestran diferencias relevantes entre las páginas.',
        keywordClusterA: 'Grupo de palabras clave relacionadas A',
        keywordClusterB: 'Grupo de palabras clave relacionadas B',
        reviewComplaintLabel: 'Preocupación recurrente de los clientes',
        reviewPraiseLabel: 'Elogio recurrente de los clientes',
        reviewSummary: 'Este tema está respaldado por las reseñas guardadas que se citan.',
        appReviewLabel: 'Comentarios recurrentes sobre la aplicación',
        brandDigest: 'Las menciones conservadas muestran una señal de marca recurrente.',
        fabricatedBrandDigest: 'Esta señal de marca cita deliberadamente una fila no disponible.',
        audienceTitle: 'Solicitud recurrente de la audiencia',
        audienceSummary: 'Las fuentes conservadas muestran una necesidad recurrente de la audiencia.',
        briefScoreRationale: 'La puntuación orientativa se basa únicamente en la comparación del corpus guardado.',
        briefOutlineHeading: (index) => `Sección basada en pruebas ${index}`,
        briefOutlinePurpose: 'Tratar el tema usando como prueba la página guardada que se cita.',
        briefQuestion: (index) => `Pregunta guardada de la audiencia ${index}`,
        disavowRationale: 'Esta nota cita las observaciones guardadas de la rúbrica para esta fila.',
        clusterLabel: (index) => `Tema relacionado ${index}`,
    },
    ru: {
        explanation: 'Предоставленные данные указывают на понятную возможность улучшить контент.',
        contentBriefTitle: 'Контент-бриф на основе данных',
        contentBriefAudience: 'Читатели, которым нужен ясный и практичный ответ',
        contentBriefOutline: 'Раскрыть тему с опорой на предоставленные данные',
        draftTitle: 'Практическое руководство на основе предоставленных данных',
        draftBody: 'Этот черновик раскрывает тему только на основе предоставленных фактов.',
        competitorComparison: 'Предоставленные данные показывают существенные различия между страницами.',
        keywordClusterA: 'Группа связанных ключевых слов A',
        keywordClusterB: 'Группа связанных ключевых слов B',
        reviewComplaintLabel: 'Повторяющееся замечание клиентов',
        reviewPraiseLabel: 'Повторяющаяся похвала клиентов',
        reviewSummary: 'Эта тема подтверждается указанными сохранёнными отзывами.',
        appReviewLabel: 'Повторяющиеся отзывы о приложении',
        brandDigest: 'Сохранённые упоминания показывают повторяющийся сигнал о бренде.',
        fabricatedBrandDigest: 'Этот сигнал о бренде намеренно ссылается на недоступную запись.',
        audienceTitle: 'Повторяющийся запрос аудитории',
        audienceSummary: 'Сохранённые источники показывают повторяющуюся потребность аудитории.',
        briefScoreRationale: 'Ориентировочная оценка основана только на сравнении сохранённого корпуса.',
        briefOutlineHeading: (index) => `Раздел на основе данных ${index}`,
        briefOutlinePurpose: 'Раскрыть тему, используя указанную сохранённую страницу как источник.',
        briefQuestion: (index) => `Сохранённый вопрос аудитории ${index}`,
        disavowRationale: 'Эта заметка ссылается на сохранённые наблюдения по критериям для данной строки.',
        clusterLabel: (index) => `Связанная тема ${index}`,
    },
    zh: {
        explanation: '所提供的证据表明存在明确的内容机会。',
        contentBriefTitle: '基于证据的内容简报',
        contentBriefAudience: '希望获得清晰实用答案的读者',
        contentBriefOutline: '使用所提供的证据解释主题',
        draftTitle: '基于所提供证据的实用指南',
        draftBody: '本草稿仅使用所提供的事实解释主题。',
        competitorComparison: '所提供的证据显示了页面之间有意义的差异。',
        keywordClusterA: '相关关键词组 A',
        keywordClusterB: '相关关键词组 B',
        reviewComplaintLabel: '反复出现的客户意见',
        reviewPraiseLabel: '反复出现的客户好评',
        reviewSummary: '引用的已保存评论支持这一主题。',
        appReviewLabel: '反复出现的应用反馈',
        brandDigest: '保留的提及显示出反复出现的品牌信号。',
        fabricatedBrandDigest: '该品牌信号故意引用了一条不存在的记录。',
        audienceTitle: '反复出现的受众需求',
        audienceSummary: '保留的来源显示出反复出现的受众需求。',
        briefScoreRationale: '该参考分数仅基于已保存语料的比较。',
        briefOutlineHeading: (index) => `基于证据的章节 ${index}`,
        briefOutlinePurpose: '使用所引用的已保存页面作为证据来说明主题。',
        briefQuestion: (index) => `已保存的受众问题 ${index}`,
        disavowRationale: '此说明引用了该行已保存的评估标准观察结果。',
        clusterLabel: (index) => `相关主题 ${index}`,
    },
};
function idsFromCollection(parsed: unknown, collection: string): string[] {
    const rows = (parsed as Record<string, unknown> | null)?.[collection];
    if (!Array.isArray(rows))
        return [];
    return rows
        .map((row) => (row as {
        id?: unknown;
    } | null)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
/** Localized samples for the presentation profiles that otherwise hit the generic schema fake. */
function derivePresentationSample(task: string, sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput) as Record<string, unknown> | null;
    if (!parsed)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    switch (task) {
        case 'content_scorecard_explanation':
        case 'opportunity_explanation':
            return {
                explanation: copy.explanation,
                citations: idsFromCollection(parsed, 'sources').slice(0, 20),
            };
        case 'content_brief': {
            const keyword = typeof parsed.keyword === 'string' ? parsed.keyword : '';
            if (!keyword)
                return null;
            return {
                title: `${copy.contentBriefTitle}: ${keyword}`,
                audience: copy.contentBriefAudience,
                outline: [copy.contentBriefOutline],
                citations: idsFromCollection(parsed, 'competitorSnippets').slice(0, 20),
            };
        }
        case 'content_first_draft': {
            const keyword = typeof parsed.keyword === 'string' ? parsed.keyword : '';
            if (!keyword)
                return null;
            return {
                title: `${copy.draftTitle}: ${keyword}`,
                body: copy.draftBody,
                citations: idsFromCollection(parsed, 'competitorSnippets').slice(0, 20),
            };
        }
        case 'competitor_comparison':
            return {
                comparison: copy.competitorComparison,
                citations: idsFromCollection(parsed, 'competitorSnippets').slice(0, 20),
            };
        case 'cluster_labels': {
            const clusters = parsed.clusters;
            if (!Array.isArray(clusters))
                return null;
            const labels = clusters.flatMap((cluster, index) => {
                const id = (cluster as {
                    id?: unknown;
                } | null)?.id;
                return typeof id === 'string' && id.length > 0
                    ? [{ clusterId: id, label: copy.clusterLabel(index + 1) }]
                    : [];
            });
            return { labels, citations: [] };
        }
        default:
            return null;
    }
}
/** One cited signal keeps the keyless Audience Research workspace fully exercisable. */
function deriveAudienceResearchSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const sources = (parsed as {
        sources?: unknown;
    } | null)?.sources;
    if (!Array.isArray(sources))
        return null;
    const sourceId = sources
        .map((source) => (source as {
        id?: unknown;
    } | null)?.id)
        .find((id): id is string => typeof id === 'string' && id.length > 0);
    if (!sourceId)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    return {
        signals: [{
                type: 'request',
                title: copy.audienceTitle,
                summary: copy.audienceSummary,
                suggestedRoute: 'content',
                citedSourceIds: [sourceId],
            }],
        citations: [sourceId],
    };
}
function deriveKeywordClusteringSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const keywords = (parsed as {
        keywords?: unknown;
    } | null)?.keywords;
    if (!Array.isArray(keywords))
        return null;
    const ids = keywords
        .map((keyword) => (keyword as {
        id?: unknown;
    } | null)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0)
        return null;
    const half = Math.ceil(ids.length / 2);
    const copy = FAKE_GENERATED_COPY[locale];
    const clusters: object[] = [
        {
            label: copy.keywordClusterA,
            memberIds: ids.slice(0, half),
            suggestedRoute: 'brief',
            intentHomogeneity: 1,
        },
    ];
    if (ids.length > 1) {
        clusters.push({
            label: copy.keywordClusterB,
            memberIds: ids.slice(half),
            suggestedRoute: 'seo',
            intentHomogeneity: 1,
        });
    }
    return { clusters, citations: [] };
}
/**
 * Task-aware deterministic sample for `review_themes`.
 *
 * Same reasoning as the clustering sample above: the generic schema sample
 * emits `citedReviewIds: ["fixture"]`, which the citation-or-drop rule then
 * discards, so every keyless-stack sync settled on `no-reliable-themes` and
 * the themes surface was undrivable in dev/CI. Echo REAL review ids from the
 * sanitized input, split by rating, and emit a theme only when at least two
 * ids back it — exactly the bar a live provider is held to.
 */
function deriveReviewThemesSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const reviews = (parsed as {
        reviews?: unknown;
    } | null)?.reviews;
    if (!Array.isArray(reviews))
        return null;
    const complaints: string[] = [];
    const praise: string[] = [];
    for (const review of reviews) {
        const record = review as {
            id?: unknown;
            rating?: unknown;
        } | null;
        if (typeof record?.id !== 'string' || record.id.length === 0)
            continue;
        const rating = typeof record.rating === 'number' ? record.rating : 5;
        (rating <= 3 ? complaints : praise).push(record.id);
    }
    if (complaints.length === 0 && praise.length === 0)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    const theme = (label: string, ids: string[]) => ids.length >= 2 ? [{ label, summary: copy.reviewSummary, citedReviewIds: ids.slice(0, 20) }] : [];
    return {
        complaintThemes: theme(copy.reviewComplaintLabel, complaints),
        praiseThemes: theme(copy.reviewPraiseLabel, praise),
        citations: [],
    };
}
/**
 * Task-aware deterministic sample for `app_review_clusters`.
 *
 * The downstream persistence boundary requires every cited id to resolve to
 * a stored review and every quote to be an exact substring of that review.
 * Echo two real, supplied rows so the keyless composed stack exercises the
 * same citation-and-quote checks as live AI providers.
 */
function deriveAppReviewClustersSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const reviews = (parsed as {
        reviews?: unknown;
    } | null)?.reviews;
    if (!Array.isArray(reviews))
        return null;
    const cited = reviews.flatMap((review) => {
        const row = review as {
            id?: unknown;
            text?: unknown;
        } | null;
        if (typeof row?.id !== 'string' ||
            !/^review-\d{3}$/u.test(row.id) ||
            typeof row.text !== 'string' ||
            row.text.length === 0) {
            return [];
        }
        return [{ id: row.id, text: row.text }];
    }).slice(0, 2);
    if (cited.length < 2)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    return {
        clusters: [{
                label: copy.appReviewLabel,
                sentiment: 'mixed',
                citedReviewIds: cited.map((row) => row.id),
                quotes: cited.map((row) => ({ reviewId: row.id, quote: row.text.slice(0, 500) })),
            }],
        citations: cited.map((row) => row.id),
    };
}
/**
 * Marker a mention title/snippet carries to make the fake `brand_digest`
 * generation cite a row id the scan never retained. Used by the Brand Radar
 * `__scenario-nodigest` fixture bank (`fakes.ts`) so the abstention terminal
 * is reachable on a keyless composed stack.
 */
export const FAKE_BRAND_DIGEST_FABRICATE_MARKER = 'fabricate-citation-probe';
/** The id the marker makes the fake cite — deliberately never a stored row. */
export const FAKE_BRAND_DIGEST_FABRICATED_ROW_ID = 'fabricated-row-id';
/**
 * Task-aware deterministic sample for `brand_digest`.
 *
 * Same reasoning as the two samples above: the generic schema sample emits
 * `citedRowIds: ["fixture"]`, which the citation-or-drop rule then discards, so
 * every keyless-stack scan would settle on `no_reliable_digest` and the digest
 * surface would be undrivable in dev/CI. Echo REAL retained row ids from the
 * sanitized input — exactly the bar a live provider is held to.
 */
function deriveBrandDigestSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const mentions = (parsed as {
        mentions?: unknown;
    } | null)?.mentions;
    if (!Array.isArray(mentions))
        return null;
    const ids = mentions
        .map((mention) => (mention as {
        id?: unknown;
    } | null)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    // Abstention probe: a mention bank carrying the marker makes the fake model
    // cite an id the scan never retained, so the shipped citation-or-drop rule
    // drops every sentence and the scan settles `no_reliable_digest`. Without
    // this seam a keyless stack can only ever reach `digest_present`, and the
    // abstention surface would be undrivable end to end.
    const fabricates = mentions.some((mention) => {
        const row = mention as {
            title?: unknown;
            snippet?: unknown;
        } | null;
        return ((typeof row?.title === 'string' &&
            row.title.includes(FAKE_BRAND_DIGEST_FABRICATE_MARKER)) ||
            (typeof row?.snippet === 'string' &&
                row.snippet.includes(FAKE_BRAND_DIGEST_FABRICATE_MARKER)));
    });
    if (fabricates) {
        return {
            digestSentences: [
                {
                    text: copy.fabricatedBrandDigest,
                    citedRowIds: [FAKE_BRAND_DIGEST_FABRICATED_ROW_ID],
                },
            ],
            citations: [],
        };
    }
    return {
        digestSentences: [
            { text: copy.brandDigest, citedRowIds: ids.slice(0, 20) },
        ],
        citations: [],
    };
}
/** Task-aware fixture: annotate one real flagged row and abstain on the rest. */
function deriveDisavowRationaleSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const rows = (parsed as {
        rows?: unknown;
    } | null)?.rows;
    if (!Array.isArray(rows))
        return null;
    const firstId = (rows[0] as {
        id?: unknown;
    } | undefined)?.id;
    if (typeof firstId !== 'string' || firstId.length === 0)
        return null;
    const copy = FAKE_GENERATED_COPY[locale];
    return {
        rationales: [
            {
                rowId: firstId,
                rationale: copy.disavowRationale,
                citations: [firstId],
            },
        ],
        citations: [],
    };
}
/**
 * Task-aware deterministic sample for `schema_generator`.
 *
 * Same reasoning as the four samples above: the generic schema sample emits
 * `factId: "fixture"`, which the traceability post-check then drops as an
 * unknown citation, so every keyless-stack generation would settle on
 * "AI output rejected" and the evidence-chip surface would be undrivable in
 * dev, CI and the composed E2E stack. Echo REAL supplied facts instead — the
 * fixture is held to exactly the bar a live provider is held to: it cites a
 * supplied fact id and copies that fact's value verbatim.
 *
 * The only property semantics encoded here is the question/answer pairing:
 * when a property's menu spans BOTH the `page.h2` and `page.faqAnswers`
 * families the sample joins question-shaped headings to answers by the
 * source index supplied by the evidence assembler.
 */
const FAKE_QUESTION_SUFFIX = /[?？؟]$/;
interface FakeSchemaFact {
    id: string;
    family: string;
    sourceIndex?: number | null;
    value: string;
}
function deriveSchemaGeneratorSample(sanitizedInput: string): object | null {
    const parsed = parseSanitizedInput(sanitizedInput) as {
        properties?: unknown;
        facts?: unknown;
    } | null;
    if (!Array.isArray(parsed?.properties) || !Array.isArray(parsed.facts))
        return null;
    const facts = parsed.facts
        .map((fact) => fact as {
        id?: unknown;
        family?: unknown;
        sourceIndex?: unknown;
        value?: unknown;
    } | null)
        .filter((fact): fact is FakeSchemaFact => typeof fact?.id === 'string' &&
        fact.id.length > 0 &&
        typeof fact.family === 'string' &&
        (fact.sourceIndex === undefined ||
            fact.sourceIndex === null ||
            Number.isInteger(fact.sourceIndex)) &&
        typeof fact.value === 'string');
    const assignments: object[] = [];
    const omissions: object[] = [];
    for (const entry of parsed.properties) {
        const property = entry as {
            name?: unknown;
            evidenceFactIds?: unknown;
        } | null;
        if (typeof property?.name !== 'string')
            continue;
        const menu = Array.isArray(property.evidenceFactIds)
            ? property.evidenceFactIds.filter((id): id is string => typeof id === 'string')
            : [];
        const matches = facts.filter((fact) => menu.includes(fact.id));
        const families = new Set(matches.map((fact) => fact.family));
        const ordered = families.has('page.h2') && families.has('page.faqAnswers')
            ? (() => {
                const questions = matches.filter((fact) => fact.family === 'page.h2' && FAKE_QUESTION_SUFFIX.test(fact.value.trim()));
                const answers = new Map(matches
                    .filter((fact) => fact.family === 'page.faqAnswers' && typeof fact.sourceIndex === 'number')
                    .map((fact) => [fact.sourceIndex, fact]));
                const zipped: FakeSchemaFact[] = [];
                for (const question of questions) {
                    if (typeof question.sourceIndex !== 'number')
                        continue;
                    const answer = answers.get(question.sourceIndex);
                    if (answer)
                        zipped.push(question, answer);
                }
                return zipped;
            })()
            : matches;
        if (ordered.length === 0) {
            omissions.push({ property: property.name, reasonCode: 'no_evidence' });
            continue;
        }
        for (const fact of ordered) {
            assignments.push({
                property: property.name,
                factId: fact.id,
                value: fact.value,
            });
        }
    }
    return {
        assignments: assignments.slice(0, 20),
        omissions: omissions.slice(0, 20),
        citations: [],
    };
}
/** Echo exact supplied pairs and use the bounded target label. */
function deriveInternalLinkingSample(sanitizedInput: string): object | null {
    const parsed = parseSanitizedInput(sanitizedInput);
    const candidates = (parsed as {
        candidates?: unknown;
    } | null)?.candidates;
    if (!Array.isArray(candidates))
        return null;
    const suggestions = candidates.flatMap((candidate) => {
        const row = candidate as {
            id?: unknown;
            sourceUrl?: unknown;
            targetUrl?: unknown;
            targetLabel?: unknown;
        } | null;
        if (typeof row?.id !== 'string' ||
            typeof row.sourceUrl !== 'string' ||
            typeof row.targetUrl !== 'string' ||
            typeof row.targetLabel !== 'string') {
            return [];
        }
        return [{
                candidateId: row.id,
                sourceUrl: row.sourceUrl,
                targetUrl: row.targetUrl,
                anchorText: [...row.targetLabel].slice(0, 120).join(''),
            }];
    }).slice(0, 100);
    return {
        suggestions,
        citations: suggestions.slice(0, 20).map((row) => row.candidateId),
    };
}
/** Cite only ids present in the bounded stored-evidence envelope. */
function deriveBriefScoringSample(sanitizedInput: string, locale: SupportedLocale): object | null {
    const parsed = parseSanitizedInput(sanitizedInput) as {
        mode?: unknown;
        documents?: unknown;
        corpusRows?: unknown;
        paaRows?: unknown;
        secondaryTerms?: unknown;
    } | null;
    if (!parsed || (parsed.mode !== 'brief' && parsed.mode !== 'rescore'))
        return null;
    const ids = (value: unknown): string[] => Array.isArray(value)
        ? value
            .map((row) => (row as {
            id?: unknown;
        } | null)?.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    const documentIds = ids(parsed.documents);
    const statisticIds = ids(parsed.corpusRows);
    const paaIds = ids(parsed.paaRows);
    const termIds = ids(parsed.secondaryTerms);
    const generalSources = [...documentIds, ...statisticIds, ...termIds];
    const copy = FAKE_GENERATED_COPY[locale];
    if (parsed.mode === 'rescore') {
        return {
            outline: [],
            questions: [],
            score: 72,
            rationale: copy.briefScoreRationale,
            citations: generalSources.slice(0, 5),
        };
    }
    return {
        outline: documentIds.slice(0, 3).map((id, index) => ({
            id: `outline-${index + 1}`,
            heading: copy.briefOutlineHeading(index + 1),
            purpose: copy.briefOutlinePurpose,
            citations: [id],
        })),
        questions: paaIds.slice(0, 5).map((id, index) => ({
            question: copy.briefQuestion(index + 1),
            citations: [id],
        })),
        score: null,
        rationale: null,
        citations: [...generalSources.slice(0, 3), ...paaIds.slice(0, 2)],
    };
}
function throwOutcome(outcome: Exclude<FakeAiOutcome, 'success'>): never {
    switch (outcome) {
        case 'timeout': throw new AiTimeoutError();
        case 'quota': throw new AiQuotaError();
        case 'unavailable': throw new AiAvailabilityError();
        case 'malformed': throw new AiMalformedOutputError();
        case 'safety': throw new AiSafetyError();
        case 'budget': throw new AiBudgetRefusalError();
    }
}
export function createFakeAiGenerationProvider(options: FakeAiGenerationOptions = {}): AiGenerationProvider {
    const outcomes: readonly FakeAiOutcome[] = options.outcomes?.length
        ? options.outcomes
        : ['success'];
    let callIndex = 0;
    return {
        async generateStructured<T extends object>(input: GenerateStructuredInput<T>): Promise<AiGenerationResult<T>> {
            const outcome = outcomes[Math.min(callIndex, outcomes.length - 1)]!;
            callIndex += 1;
            if (outcome !== 'success')
                throwOutcome(outcome);
            const candidate = options.objects?.[input.task] ??
                derivePresentationSample(input.task, input.sanitizedInput, input.locale) ??
                (input.task === 'keyword_clustering'
                    ? deriveKeywordClusteringSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'audience_research_cluster'
                    ? deriveAudienceResearchSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'review_themes'
                    ? deriveReviewThemesSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'app_review_clusters'
                    ? deriveAppReviewClustersSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'brand_digest'
                    ? deriveBrandDigestSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'disavow_rationale'
                    ? deriveDisavowRationaleSample(input.sanitizedInput, input.locale)
                    : null) ??
                (input.task === 'schema_generator'
                    ? deriveSchemaGeneratorSample(input.sanitizedInput)
                    : null) ??
                (input.task === 'internal_linking'
                    ? deriveInternalLinkingSample(input.sanitizedInput)
                    : null) ??
                (input.task === 'brief_scoring'
                    ? deriveBriefScoringSample(input.sanitizedInput, input.locale)
                    : null) ??
                makeFakeSchemaValue(input.jsonSchema);
            const parsed = input.validationSchema.safeParse(candidate);
            if (!parsed.success)
                throw new AiMalformedOutputError();
            return {
                trust: 'untrusted',
                object: parsed.data,
                provider: 'fake',
                model: 'deterministic-schema-fixture',
                finishReason: 'stop',
                tokens: { input: null, output: null, cachedInput: null, reasoning: null },
                latencyMs: 0,
                attempts: [{
                        ordinal: 1,
                        provider: 'fake',
                        model: 'deterministic-schema-fixture',
                        status: 'success',
                        latencyMs: 0,
                        tokens: { input: null, output: null, cachedInput: null, reasoning: null },
                        configuredEstimateCostMicros: 0n,
                        actualOrEstimatedCostMicros: 0n,
                        costSource: 'estimated',
                        errorCategory: null,
                        errorCode: null,
                    }],
                configuredEstimateCostMicros: 0n,
                actualCostMicros: null,
                actualOrEstimatedCostMicros: 0n,
                warnings: ['usage_estimated'],
            };
        },
    };
}
