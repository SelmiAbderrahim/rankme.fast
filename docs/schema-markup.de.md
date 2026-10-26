---
title: 'Schema-Markup-Generator'
description: 'Wie RankMeFast JSON-LD aus gespeicherten Seitenfakten baut, was Konformität hier bedeutet und warum eine fehlende Eigenschaft weggelassen statt erfunden wird.'
locale: de
slug: schema-markup
section: product
order: 10
---

# Schema-Markup-Generator

Der Generator schreibt JSON-LD für eine Seite aus Fakten, die RankMeFast bereits hat: aus einer geprüften Seite, einer Inventarseite oder einer URL, die Sie einfügen. Das Ergebnis kopieren Sie oder laden es herunter.

<!-- docs-truth: metric=schema_generations; unit=one-generation-one-page-one-type; cache-hits=count; refund=missing-evidence-omitted-with-reason; cadence=on-demand; estimates=first-party-facts -->

## Typen und Belege

Sieben Typen werden unterstützt: `WebPage`, `WebSite`, `Organization`, `Article`, `BreadcrumbList`, `FAQPage` und `HowTo`. Sie wählen den Typ, RankMeFast trägt die Belege zusammen.

Jede Eigenschaft in der Ausgabe ist mit dem gespeicherten Fakt verknüpft, aus dem sie stammt. So können Sie jeden Wert bis zu seiner Seite zurückverfolgen, bevor Sie etwas veröffentlichen. `FAQPage` und `HowTo` stehen am Ende der Liste, jeweils mit einem kurzen Hinweis. Google zeigt FAQ-Antworten in den Suchergebnissen nur noch für bekannte Behörden- und Gesundheitsseiten und zeigt HowTo-Schritte gar nicht mehr an. Beide Typen erzeugen weiterhin gültiges schema.org-Markup.

## Der Konformitätsbericht

Die Konformitätsprüfung sortiert ihre Funde in zwei Gruppen:

- **Erforderliche Lücken**: Eigenschaften, die der Typ braucht.
- **Vorschläge**: Eigenschaften, die das Markup stärker machen würden.

Bestanden heißt, dass die Ausgabe die schema.org-Anforderungen des gewählten Typs erfüllt. Das ist nie eine Garantie, dass Google ein Rich Result anzeigt.

## Warum Eigenschaften fehlen

Gibt es für eine Eigenschaft keinen gespeicherten Beleg, wird sie weggelassen und der Bericht nennt den Grund. Bewertungen, Preise, Rezensionen, Autoren und Daten werden nie erfunden. Deshalb zeigt `Article` oft eine `datePublished`-Lücke. Legt die Seite kein Veröffentlichungsdatum offen, das RankMeFast lesen kann, sagt der Generator das, statt eines zu raten.

## Namen und Angaben, die Sie ergänzen

Bei `WebSite` und `Organization` stammt der Name aus der ersten Quelle, die die Seite bietet: ihrem `og:site_name`-Tag, dann einem Namen, den `Organization`- oder `WebSite`-Markup auf der Seite bereits angibt, dann dem Markenteil des Seitentitels (Trennzeichen und Wörter wie „Willkommen“ entfallen), dann dem Namen, den Sie der Website gegeben haben, und erst dann der Domain. Die Belegliste zeigt, welche Quelle verwendet wurde. Unter **Was wir weggelassen haben** können Sie einen Wert für Eigenschaften wie Beschreibung, Sprache, Datumsangaben oder Bildadressen eintragen. Der Generator übernimmt ihn exakt wie geschrieben und kennzeichnet ihn mit **Von Ihnen angegeben**. Mit **Mit meinen Angaben neu aufbauen** wenden Sie sie an. Der Neuaufbau nutzt die Fakten, die die ursprüngliche Generierung schon gefunden hat, führt keinen neuen KI-Aufruf aus und verbraucht keine Generierung. Das Original bleibt unverändert, und der Neuaufbau wird als neue Generierung gespeichert.

## Wie Werte geprüft werden

Ein KI-Modell wählt aus, welche Eigenschaften befüllt werden. Eine Nachprüfung vergleicht danach jeden Wert mit seinem gespeicherten Fakt, und alles, was keine wortgetreue Kopie ist, wird verworfen, bevor Sie es sehen.

Das Markup bauen Sie selbst in Ihre Site ein. RankMeFast fügt es nicht in Ihre Site, Ihr Theme oder einen Tag-Manager ein und besitzt keine Zugangsdaten, mit denen es das könnte.

[Zurück zum Doku-Index](./index.de.md)
