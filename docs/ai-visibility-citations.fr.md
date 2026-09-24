---
title: 'Citations IA & lacunes de sources'
description: 'Vérifications par échantillon de prompts : quelles sources les réponses IA citent, et où vous manquez.'
locale: fr
slug: ai-visibility-citations
section: audits
order: 10
---

# Citations IA & lacunes de sources

La Visibilité IA vérifie ce que les assistants IA répondent aux prompts que vous suivez, et quelles sources ces réponses citent.

## Un échantillon, jamais une couverture totale

Vous suivez un petit ensemble de prompts par site (jusqu'à dix). Une vérification pose ces prompts sur les moteurs couverts par votre offre : le résultat est un échantillon de ce que les gens peuvent voir (taille d'échantillon = prompts × cohorte). Il ne couvre pas tout ce qui est demandé à une IA.

## Moteurs pris en charge

Les vérifications de mentions lisent l'index de mentions du fournisseur pour les résultats Google et ChatGPT. Les vérifications de réponses couvrent ChatGPT, Gemini et Claude ; Perplexity ne prend en charge que les réponses en direct. Si le fournisseur signale un nouveau produit IA, il apparaît sous le nom que lui donne le fournisseur.

## Citations

Une citation est une URL plus l'identité de la source que la réponse a désignée. Nous enregistrons l'URL citée dès que le moteur la rapporte, et si une réponse vous a cité, vous ou un concurrent suivi.

## Lacunes de sources

Une lacune de source signifie que les réponses de votre thématique citent d'autres sources, mais jamais les vôtres. Les lacunes apparaissent comme éléments dans [Prochaines actions](./next-actions.fr.md), chacune pointant vers les sources que les moteurs ont préférées.

## États

- **Résultats partiels** : certains moteurs ont renvoyé des données, d'autres non. Nous montrons ce qui est arrivé et nommons ce qui manque.
- **Non pris en charge pour ce moteur / marché** : le moteur ne peut pas exécuter cette vérification là où vous êtes. Il est écarté plutôt qu'affiché comme zéro.
- **Indisponible (pas zéro)** : aucune donnée n'est revenue. `unavailable ≠ 0` : cela veut dire que nous ne savons pas, pas que vous n'avez jamais été cité.

## Pas une part de marché IA

La part de voix compare la fréquence à laquelle les réponses vous nomment face aux concurrents que vous suivez, uniquement dans vos prompts échantillonnés. Ce n'est pas une mesure de part de marché.

## Ce que coûte une vérification

Une vérification consomme une unité `ai_mentions_checks` par prompt suivi. Lire les résultats, citations et lacunes stockés est gratuit.

[Retour à l'index de la documentation](./index.fr.md)
