---
title: 'ربط Looker Studio'
description: 'انسخ موصل RankMeFast للقراءة فقط إلى Apps Script واعرض بيانات تحسين محركات البحث المخزنة في Looker Studio. ميزة الوكالة.'
locale: ar
slug: looker-studio
section: developers
order: 4
---

# ربط Looker Studio

يتيح مصدر موصل المجتمع لحساب **الوكالة** قراءة البيانات المخزنة مسبقًا في نسخة RankMeFast الخاصة به. لا يبدأ فحصًا ولا يتصل بمزوّد ولا يستهلك مقياس استخدام. تبقى حدود الطلبات الحالية لكل عنوان IP ولكل مفتاح سارية. راجع [واجهة API العامة](./public-api.ar.md) لعقد HTTP الأساسي.

## قبل البدء

اطلب من المشغّل تفعيل `PUBLIC_EXPORTS_ENABLED`. أنشئ مفتاح API من **الحساب ← مفاتيح API** وانسخه عند ظهوره؛ بعد ذلك يحتفظ RankMeFast بملخص SHA-256 فقط. تحتاج أيضًا إلى أصل HTTPS لنسختك من دون `/api/v1`.

## التثبيت والاتصال

1. أنشئ مشروع Google Apps Script.
2. انسخ `tools/looker-connector/Code.gs` إلى محرر الشفرة و`appsscript.json` إلى محرر البيان.
3. أنشئ نشرًا تجريبيًا لموصل المجتمع وافتحه في Looker Studio.
4. أدخل مفتاح API في شاشة مصادقة **Key** المنفصلة من Google. لا تلصقه في إعدادات الموصل أو الشفرة.
5. أدخل عنوان النسخة، واختر مجموعة البيانات، وأدخل معرّف موقع من 24 محرفًا لسجل الترتيب أو ميزات SERP أو صفوف الروابط الخلفية. يقبل مرشح المحرك: الكل وGoogle وBing وYouTube وAmazon.

يُدخل المستخدم عنوان النسخة وقت الإعداد؛ لا يحتوي الموصل الملتزم على أصل API ثابت. يستخدم سجل الترتيب صفحات `X-Next-Cursor` من 10 مجموعات كلمات مفتاحية، بينما تستخدم الكلمات المفتاحية وميزات SERP وصفوف الروابط الخلفية صفحات من 1,000 صف. تتوقف جميعها عند 10,000 صف لكل تحديث، وإذا تكرر المؤشر يتوقف الموصل بخطأ بدل الدخول في حلقة. وعندما يرسل Looker نطاقًا زمنيًا، يمرّر الموصل تاريخيه الشاملين في كل صفحة من سجل الترتيب.

## تعيين الحقول

| مجموعة البيانات | مسار API | معرّفات حقول Looker |
|---|---|---|
| المواقع | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| سجل الترتيب | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| الكلمات المفتاحية | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| ميزات SERP | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| صفوف الروابط الخلفية | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

تعني `source_kind=provider_observation` أن صف SERP أو الرابط الخلفي ملاحظة مزوّد مخزنة وليس تقديرًا. يبقى `features_json` و`top_results_json` نص JSON، وتبقى القيم الشبيهة بالصيغة نصًا محايدًا.

## استكشاف الأخطاء والأمان

يعني `401` أن المفتاح مفقود أو ملغى، و`402` أن الحساب ليس من فئة الوكالة، و`404` أن الموقع لا يخص الحساب، و`429` امتلاء حد API، و`503` تعطيل التصدير العام. استخدم HTTPS وألغِ أي مفتاح مكشوف فورًا وأنشئ مصدر بيانات منفصلًا لكل موقع أو مجموعة بيانات.

يتبع الأثر دليل Google [لبناء الموصل](https://developers.google.com/looker-studio/connector/build) ودليل [المصادقة](https://developers.google.com/looker-studio/connector/auth) و[مرجع API](https://developers.google.com/looker-studio/connector/reference) و[مرجع البيان](https://developers.google.com/looker-studio/connector/manifest)، وتمت مراجعتها في 2026-08-04. النشر في المعرض والأتمتة خارج النطاق.

[العودة إلى فهرس الوثائق](./index.ar.md)
