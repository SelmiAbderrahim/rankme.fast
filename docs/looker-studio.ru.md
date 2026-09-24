---
title: 'Подключение Looker Studio'
description: 'Скопируйте коннектор RankMeFast только для чтения в Apps Script и используйте сохранённые SEO-данные в Looker Studio. Функция Agency.'
locale: ru
slug: looker-studio
section: developers
order: 4
---

# Подключение Looker Studio

Community Connector позволяет аккаунту **Agency** читать данные, уже сохранённые собственной установкой RankMeFast. Он не запускает проверки, не вызывает поставщиков и не расходует метрики. Действующие лимиты по IP и ключу сохраняются. Основной HTTP-контракт описан в [публичном API](./public-api.ru.md).

## Подготовка

Попросите оператора включить `PUBLIC_EXPORTS_ENABLED`. Создайте ключ в **Аккаунт → Ключи API** и скопируйте при единственном показе; затем RankMeFast хранит только SHA-256. Также нужен HTTPS-адрес установки без `/api/v1`.

## Установка и подключение

1. Создайте проект Google Apps Script.
2. Скопируйте `tools/looker-connector/Code.gs` в редактор, а `appsscript.json` — в редактор манифеста.
3. Создайте тестовое развёртывание Community Connector и откройте его в Looker Studio.
4. Введите ключ в отдельном окне аутентификации Google **Key**, но не в конфигурации и не в коде.
5. Укажите URL и набор данных. Для истории позиций, SERP и обратных ссылок нужен 24-символьный ID сайта. Фильтр движка: Все, Google, Bing, YouTube или Amazon.

Адрес задаётся при настройке, поэтому в исходнике нет фиксированного API-сервера. История позиций читается страницами `X-Next-Cursor` по 10 групп ключевых слов; ключевые слова, функции SERP и обратные ссылки — страницами по 1 000 строк. Все наборы ограничены 10 000 строками за обновление, а повтор курсора вызывает ошибку вместо бесконечного цикла. Если Looker передаёт диапазон дат, его включительные границы добавляются к каждой странице истории.

## Соответствие полей

| Набор | Маршрут API | Идентификаторы Looker |
|---|---|---|
| Сайты | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| История позиций | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Ключевые слова | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| Функции SERP | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Обратные ссылки | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` означает сохранённое наблюдение поставщика, а не оценку. JSON остаётся текстом, а похожие на формулы значения остаются обезвреженными.

## Ошибки и безопасность

`401` — ключ отсутствует или отозван, `402` — план не Agency, `404` — чужой сайт, `429` — исчерпан лимит, `503` — экспорт выключен. Используйте HTTPS, немедленно отзывайте раскрытые ключи и создавайте отдельный источник Looker для каждого сайта или набора.

Артефакт следует руководствам Google по [созданию](https://developers.google.com/looker-studio/connector/build), [аутентификации](https://developers.google.com/looker-studio/connector/auth), [API](https://developers.google.com/looker-studio/connector/reference) и [манифесту](https://developers.google.com/looker-studio/connector/manifest), проверенным 2026-08-04. Публикация в галерее не входит в комплект.

[Назад к документации](./index.ru.md)
