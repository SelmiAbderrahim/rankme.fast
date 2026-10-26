/**
 * Small, conservative per-locale word lists for the deterministic AI-Visibility
 * suggestion path. A word on a list only ever means "do not build a
 * category phrase around me": a miss costs one suggestion, never a wrong one.
 *
 *  - `STOPWORDS`  function words and marketing filler. A category phrase may
 *    not start or end with one, and the similarity check ignores them.
 *  - `LINKERS`    the few stopwords that may sit INSIDE a phrase ("résumé de
 *    podcast", "bill of materials").
 *  - `GENERIC_NOUNS` product nouns ("tool", "outil", "Werkzeug"). They are fine
 *    next to a real topic but never a category on their own.
 *  - `NAVIGATION_WORDS` page labels, account chrome and price words. A query or
 *    title built from them describes a page ("episode pricing"), not something
 *    a buyer asks an AI assistant to recommend.
 *
 * Chinese is unspaced, so it has no word lists: phrases are whole clauses split
 * on punctuation and a handful of function characters, and navigation labels
 * are matched as substrings (`ZH_NAVIGATION`).
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { PAGE_LABEL_WORDS } from './prompt-seed-quality.js';

type SpacedLocale = Exclude<SupportedLocale, 'zh'>;

const words = (list: string): ReadonlySet<string> =>
  new Set(list.split(/\s+/).filter(Boolean));

export const STOPWORDS: Record<SpacedLocale, ReadonlySet<string>> = {
  en: words(
    `a an the and or but of to for with without in on at by from into onto your our my their
     its this that these those is are be was were it as any all more most you we i us not no
     can will get got just also than then so very new best top free online official welcome
     home use using used make makes made help helps helping built easy simple fast quick
     powerful smart better great good one every each how what why which who when where start
     try join learn read see view find every way ways much many own up out over per via accurate precise ready instantly automatically minutes minute seconds hours today
     should would could shall may might must do does did am`,
  ),
  fr: words(
    `le la les un une des du de d l et ou mais en au aux pour avec sans dans sur par chez
     votre vos notre nos mon ma mes leur leurs ce cet cette ces est sont être a ont plus
     moins très tout tous toute toutes comme que qui quoi où quand pourquoi nouveau nouvelle
     meilleur meilleure gratuit gratuite gratuitement officiel facile simple rapide utiliser
     essayer découvrir chaque prêt prête prêts prêtes précis précise précises précises minutes minute quelques partir à au`,
  ),
  de: words(
    `der die das den dem des ein eine einen einem einer eines und oder aber von zu für mit
     ohne in im auf an am bei aus nach über unter durch ihr ihre ihren ihrer unser unsere
     mein meine dein deine ist sind war wurde wird kann mehr sehr alle alles als wie was
     warum welche welcher welches wer wo wann neu neue beste bester bestes kostenlos
     offiziell einfach schnell nutzen verwenden jetzt bereit zur zum zu im am genaue genau genaues minuten bereits`,
  ),
  es: words(
    `el la los las un una unos unas de del al y o pero en con sin para por sobre entre desde
     hasta tu tus su sus mi mis nuestro nuestra es son ser fue más menos muy todo todos toda
     todas como que quién qué cuál cuándo dónde nuevo nueva mejor gratis gratuito oficial
     fácil sencillo rápido usar probar descubre cada lista listo listas listos preciso precisa precisas minutos minuto`,
  ),
  ru: words(
    `и в во на с со к ко по о об от до за из у для при про над под без через или но а да
     не ни как что это этот эта эти тот те все всё весь вся ваш ваша ваши наш наша наши
     мой моя мои их его её он она оно мы вы они бы же ли уже еще ещё только также очень
     новый новая новое лучший лучшая лучшие бесплатно бесплатный официальный простой быстрый
     легко использовать попробовать каждого каждый каждой готовая готовый готовое готовые точная точный точное минуты минут`,
  ),
  ar: words(
    `من في على إلى الى عن مع و أو او هذا هذه ذلك تلك التي الذي الذين هو هي هم نحن أنت أنتم
     لك لكم لنا كل أي اي ما ماذا كيف لماذا أين متى هل لا لم لن قد أن إن بدون دون بين حتى
     أكثر جديد مجاني مجانا رسمي سهل بسيط سريع أفضل ابدأ جرب جاهز جاهزة جاهزا دقيقة دقيق دقائق دقيقا`,
  ),
};

export const LINKERS: Record<SpacedLocale, ReadonlySet<string>> = {
  en: words('of'),
  fr: words('de du des d la le les'),
  de: words(''),
  es: words('de del la el los las'),
  ru: words('к по'),
  ar: words(''),
};

export const GENERIC_NOUNS: Record<SpacedLocale, ReadonlySet<string>> = {
  en: words('tool tools software app apps platform platforms solution solutions service services website site page pages generator generators maker makers checker checkers tracker trackers builder builders creator creators template templates'),
  fr: words('outil outils logiciel logiciels application applications plateforme plateformes solution solutions service services site page pages générateur générateurs modèle modèles'),
  de: words('tool tools werkzeug werkzeuge software app apps plattform plattformen lösung lösungen dienst dienste service website seite seiten generator generatoren vorlage vorlagen'),
  es: words('herramienta herramientas software aplicación aplicaciones plataforma plataformas solución soluciones servicio servicios sitio página páginas generador generadores plantilla plantillas'),
  ru: words('инструмент инструменты программа программы приложение приложения платформа платформы решение решения сервис сервисы сайт страница страницы генератор генераторы шаблон шаблоны'),
  ar: words('أداة أدوات برنامج برامج تطبيق تطبيقات منصة منصات حل حلول خدمة خدمات موقع صفحة صفحات مولد قالب قوالب'),
};

/** Price, account and page-chrome words per locale; English always applies too. */
const NAVIGATION_BY_LOCALE: Record<SpacedLocale, ReadonlySet<string>> = {
  en: new Set([
    ...PAGE_LABEL_WORDS,
    'price', 'prices', 'plan', 'plans', 'cost', 'costs', 'coupon', 'discount', 'trial',
    'subscribe', 'checkout', 'cart', 'billing', 'invoice', 'refund', 'sitemap',
  ]),
  fr: words('tarif tarifs prix connexion inscription compte contact aide mentions confidentialité cookies démo essai facturation abonnement'),
  de: words('preis preise kosten anmelden anmeldung registrieren registrierung konto kontakt hilfe impressum datenschutz agb demo testversion abrechnung abonnement'),
  es: words('precio precios planes plan sesión registro cuenta contacto ayuda privacidad cookies demostración prueba facturación suscripción'),
  ru: words('цена цены тариф тарифы вход регистрация аккаунт контакты помощь поддержка конфиденциальность демо пробный оплата подписка'),
  ar: words('سعر أسعار الأسعار تسجيل دخول حساب اتصل تواصل مساعدة دعم الخصوصية الشروط تجربة فاتورة اشتراك'),
};

const withEnglish = (locale: SpacedLocale): ReadonlySet<string> =>
  new Set([...NAVIGATION_BY_LOCALE.en, ...NAVIGATION_BY_LOCALE[locale]]);

export const NAVIGATION_WORDS: Record<SpacedLocale, ReadonlySet<string>> = {
  en: withEnglish('en'),
  ar: withEnglish('ar'),
  fr: withEnglish('fr'),
  de: withEnglish('de'),
  es: withEnglish('es'),
  ru: withEnglish('ru'),
};

export const ZH_NAVIGATION = [
  '价格', '定价', '资费', '套餐', '登录', '注册', '账户', '账号', '联系', '关于', '博客',
  '帮助', '支持', '隐私', '条款', '常见问题', '演示', '试用', '订阅', '付款',
] as const;

/** Characters that split an unspaced Chinese clause into smaller phrases. */
export const ZH_SPLIT =
  /的|和|与|及|或|在|为|把|将|从|并|且|生成|制作|创建|每一期|每|可直接|几分钟|分钟|一键|快速|轻松|自动|精准|准确|发布|按期|付费|无需|订阅/u;
