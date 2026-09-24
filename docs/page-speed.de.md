---
title: 'Seitentempo'
description: 'Core Web Vitals einfach erklärt: echte Besucher vs. Laborschätzung.'
locale: de
slug: page-speed
section: audits
order: 1
---

# Seitentempo

Google bewertet Seiten über **Core Web Vitals**. RankMeFast trennt Feld- und Labormessungen und zeigt nur Nachweise, die der konfigurierte Anbieter tatsächlich liefert.

## Reale Nutzerdaten
Der Chrome UX Report aggregiert echte Besuche:
- **LCP**: größtes sichtbares Element. < 2,5 s.
- **INP**: Reaktion auf Klick/Tap. < 200 ms.
- **CLS**: Layout-Sprünge. < 0,1.

Felddaten erscheinen nur, wenn Google CrUX konfiguriert ist und für URL oder Origin genügend Traffic vorliegt. Der produktive DataForSEO-Lighthouse-Anbieter liefert nur Labordaten; die Feldzeile bleibt deshalb leer, statt echte Besucher aus einem synthetischen Lauf abzuleiten.

## Laborschätzung (Lighthouse)
RankMeFast führt einen synthetischen Lighthouse-Test in einer kontrollierten Umgebung aus; in Produktion liefert DataForSEO Lighthouse Live dieses Laborsignal. Es bleibt ein Hinweis, und ein Lauf schwankt um etwa 10 Punkte.

## Mobil
Wird separat gemessen. Fehlt viewport oder sind Tap-Targets zu klein, landet der Punkt in **Jetzt beheben**.

[Zurück zum Doku-Index](./index.de.md)
