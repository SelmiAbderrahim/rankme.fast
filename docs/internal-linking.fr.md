---
title: 'Suggestions de maillage interne'
description: 'Comment RankMeFast repère les pages orphelines et faiblement liées de votre inventaire de contenu stocké et rédige des ancres qui citent leurs preuves.'
locale: fr
slug: internal-linking
section: product
order: 7
---

# Suggestions de maillage interne

Le maillage interne s'appuie sur deux choses que RankMeFast possède déjà : votre inventaire de contenu terminé et les requêtes Search Console stockées pour votre site. Il n'explore rien lui-même.

<!-- docs-truth: metric=internal_link_runs; unit=one-run-over-stored-inventory; cache-hits=count; refund=ai-failure-keeps-deterministic-output; cadence=on-demand; estimates=first-party-inventory -->

## Comment les candidats sont trouvés

RankMeFast repère dans l'inventaire les pages orphelines et les pages peu liées.

Pour chacune, il cherche des pages sources probables : des pages qui partagent avec elle des requêtes Search Console stockées, ou dont les titres se recoupent.

Chaque suggestion affiche ces éléments, pour que vous puissiez vérifier le raisonnement avant d'ajouter un lien.

## Texte d'ancre

Le moteur d'IA rédige des textes d'ancre et les classe au-dessus de la liste de candidats établie par règles. Chaque ancre IA est signalée comme interprétation IA, et la suggestion en dessous tient debout sans elle.

Si l'étape IA échoue, vous obtenez quand même les suggestions établies par règles, avec des ancres de repli. Une exécution ne revient jamais vide à cause du modèle.

Les suggestions peuvent être exportées en CSV.

## Votre inventaire doit être récent

Les suggestions viennent uniquement d'un inventaire de contenu terminé datant de sept jours au plus. S'il manque ou s'il est plus ancien, RankMeFast vous demande de le rafraîchir plutôt que d'explorer de lui-même.

Chaque source et chaque cible est une page déjà présente dans cet inventaire, et les pages marquées `noindex` ne sont jamais proposées comme cibles.

## Limites

- La confiance reflète les éléments disponibles (nombre de requêtes partagées, force du recoupement des titres), pas un gain de trafic ou de position attendu.
- Rien n'est écrit sur votre site. Vous obtenez une liste et ajoutez les liens vous-même dans votre CMS.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
