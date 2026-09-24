---
title: 'Générateur de balisage Schema'
description: 'Comment RankMeFast construit du JSON-LD à partir de faits de page stockés, ce que signifie la conformité ici, et pourquoi une propriété manquante est omise plutôt qu''inventée.'
locale: fr
slug: schema-markup
section: product
order: 10
---

# Générateur de balisage Schema

Le générateur écrit du JSON-LD pour une page à partir de faits que RankMeFast détient déjà : une page auditée, une page d'inventaire ou une URL que vous collez. Vous copiez ou téléchargez le résultat.

<!-- docs-truth: metric=schema_generations; unit=one-generation-one-page-one-type; cache-hits=count; refund=missing-evidence-omitted-with-reason; cadence=on-demand; estimates=first-party-facts -->

## Types et sources

Sept types sont pris en charge : `WebPage`, `WebSite`, `Organization`, `Article`, `BreadcrumbList`, `FAQPage` et `HowTo`. Vous choisissez le type, RankMeFast rassemble les éléments.

Chaque propriété de la sortie est rattachée au fait stocké dont elle provient, pour que vous puissiez retrouver la page d'origine de chaque valeur avant de publier quoi que ce soit.

## Le rapport de conformité

La vérification de conformité classe ce qu'elle trouve en deux groupes :

- **Manques obligatoires** : les propriétés dont le type a besoin.
- **Suggestions** : les propriétés qui renforceraient le balisage.

Être conforme signifie que la sortie respecte les exigences schema.org du type choisi. Ce n'est jamais une garantie que Google affichera un résultat enrichi.

## Pourquoi des propriétés manquent

S'il n'existe aucun fait stocké pour une propriété, elle est omise et le rapport explique pourquoi. Notes, prix, avis, auteurs et dates ne sont jamais inventés.

C'est pour cela que `Article` signale souvent un manque de `datePublished`. Quand la page n'expose pas de date de publication que RankMeFast peut lire, le générateur vous le dit au lieu d'en deviner une.

## Comment les valeurs sont contrôlées

Un modèle d'IA choisit les propriétés à remplir. Une vérification compare ensuite chaque valeur à son fait stocké, et tout ce qui n'est pas une copie littérale est rejeté avant que vous ne le voyiez.

C'est vous qui ajoutez le balisage à votre site. RankMeFast ne l'injecte pas dans votre site, votre thème ou un gestionnaire de balises, et ne détient aucun identifiant qui le permettrait.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
