---
title: 'Vorschläge zur internen Verlinkung'
description: 'Wie RankMeFast verwaiste und schwach verlinkte Seiten in Ihrem gespeicherten Content-Inventar findet und Ankertexte entwirft, die ihre Belege zitieren.'
locale: de
slug: internal-linking
section: product
order: 7
---

# Vorschläge zur internen Verlinkung

Die interne Verlinkung nutzt zwei Dinge, die RankMeFast bereits hat: Ihr abgeschlossenes Content-Inventar und die für Ihre Site gespeicherten Search-Console-Suchanfragen. Sie crawlt selbst nichts.

<!-- docs-truth: metric=internal_link_runs; unit=one-run-over-stored-inventory; cache-hits=count; refund=ai-failure-keeps-deterministic-output; cadence=on-demand; estimates=first-party-inventory -->

## Wie Kandidaten gefunden werden

RankMeFast sucht im Inventar nach verwaisten und schwach verlinkten Seiten.

Zu jeder davon sucht es passende Quellseiten: Seiten, die gespeicherte Search-Console-Anfragen mit ihr teilen oder deren Überschriften sich überschneiden.

Jeder Vorschlag zeigt diesen Beleg, sodass Sie die Begründung prüfen können, bevor Sie einen Link setzen.

## Ankertexte

Die KI-Laufzeit entwirft Ankertexte und ordnet sie über der regelbasierten Kandidatenliste ein. Jeder KI-Anker ist als KI-Interpretation gekennzeichnet, und der Vorschlag darunter trägt auch ohne ihn.

Scheitert der KI-Schritt, bekommen Sie trotzdem die regelbasierten Vorschläge mit Ersatzankern. Ein Lauf endet nie wegen des Modells ohne Ergebnis.

Vorschläge lassen sich als CSV exportieren.

## Ihr Inventar muss aktuell sein

Vorschläge stammen nur aus einem abgeschlossenen Content-Inventar, das höchstens sieben Tage alt ist. Fehlt Ihres oder ist es älter, bittet RankMeFast Sie um eine Aktualisierung, statt selbst zu crawlen.

Jede Quelle und jedes Ziel ist eine Seite aus diesem Inventar, und mit `noindex` markierte Seiten werden nie als Ziel vorgeschlagen.

## Grenzen

- Die Konfidenz spiegelt die Belege wider (wie viele Anfragen geteilt werden, wie stark sich Überschriften überschneiden), nicht erwarteten Traffic oder Rankinggewinne.
- Auf Ihre Site wird nichts geschrieben. Sie erhalten eine Liste und setzen die Links selbst in Ihrem CMS.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
