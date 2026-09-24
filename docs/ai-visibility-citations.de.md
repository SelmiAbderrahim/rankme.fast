---
title: 'KI-Zitierungen & Quellenlücken'
description: 'Stichproben-Prompt-Checks: welche Quellen KI-Antworten zitieren und wo Sie fehlen.'
locale: de
slug: ai-visibility-citations
section: audits
order: 10
---

# KI-Zitierungen & Quellenlücken

AI Visibility prüft, was KI-Assistenten auf Ihre verfolgten Prompts antworten und welche Quellen diese Antworten zitieren.

## Eine Stichprobe, nie volle Abdeckung

Sie verfolgen einen kleinen Satz Prompts pro Site (bis zu zehn). Ein Check stellt diese Prompts über die Engines Ihres Plans, das Ergebnis ist also eine Stichprobe dessen, was Menschen sehen könnten (Stichprobengröße = Prompts × Kohorte). Sie deckt nicht alles ab, was Menschen eine KI fragen.

## Unterstützte Engines

Erwähnungs-Checks lesen den Mentions-Index des Anbieters für Google- und ChatGPT-Ergebnisse. Antwort-Checks decken ChatGPT, Gemini und Claude ab; Perplexity unterstützt nur Live-Antworten. Meldet der Anbieter ein neues KI-Produkt, erscheint es unter dem Namen, den der Anbieter verwendet.

## Zitierungen

Eine Zitierung ist eine URL plus die Identität der Quelle, auf die die Antwort verwiesen hat. Wir speichern die zitierte URL, wann immer die Engine eine meldet, und ob eine Antwort Sie oder einen verfolgten Wettbewerber zitiert hat.

## Quellenlücken

Eine Quellenlücke bedeutet: Antworten in Ihrem Thema zitieren andere Quellen, aber nie Ihre. Quellenlücken erscheinen als Einträge in [Nächste Aktionen](./next-actions.de.md) und zeigen jeweils auf die Quellen, die die Engines bevorzugt haben.

## Status

- **Teilergebnisse**: einige Engines lieferten Daten, andere nicht. Wir zeigen, was ankam, und benennen, was fehlt.
- **Nicht unterstützt für diese Engine / diesen Markt**: Die Engine kann diesen Check dort nicht ausführen. Sie wird weggelassen statt als Null angezeigt.
- **Nicht verfügbar (nicht null)**: Es kamen keine Daten zurück. `unavailable ≠ 0`: Es bedeutet, dass wir es nicht wissen, nicht, dass Sie nie zitiert wurden.

## Kein KI-Marktanteil

Share of Voice vergleicht, wie oft Antworten Sie gegenüber den von Ihnen verfolgten Wettbewerbern nennen, und zwar nur innerhalb Ihrer Stichproben-Prompts. Es ist keine Messung des Marktanteils.

## Was ein Check kostet

Ein Check verbraucht eine `ai_mentions_checks`-Einheit pro verfolgtem Prompt. Gespeicherte Ergebnisse, Zitierungen und Quellenlücken zu lesen ist kostenlos.

[Zurück zum Doku-Index](./index.de.md)
