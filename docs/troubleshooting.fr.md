---
title: 'Dépannage'
description: 'Problèmes courants et comment les résoudre.'
locale: fr
slug: troubleshooting
section: start
order: 3
---

# Dépannage

## Audit échoué ou indisponible
- Vérifiez pare-feu et Cloudflare.
- Assurez-vous que robots.txt ne bloque pas `RankMeFastBot`.
- Réessayez plus tard.

## Contrôle de position indisponible
Généralement temporaire ; la prochaine exécution réessaie.

## « Reconnexion requise » Search Console
Ouvrez Paramètres et reconnectez.

## Plafond atteint
Voir [Plans, limites & crédits](./plans-limits-credits.fr.md).

## Plafond atteint sur un outil de recherche (402)
Le message nomme l'unité épuisée, par exemple `keyword_lookups` ou `audience_research_runs`. Attendez la réinitialisation mensuelle, achetez un pack de crédits quand il en existe un, ou changez d'offre ; les exécutions de Recherche d'audience n'ont pas de pack.

## Résultats partiels sur un outil de recherche
Certains moteurs ou sources ont répondu, d'autres non. Le résultat est livré avec ce qui est arrivé et étiqueté **résultats partiels**. La partie manquante est nommée, jamais remplie de zéros.

## Non pris en charge pour ce moteur / marché
La vérification ne peut pas s'exécuter pour ce moteur ou ce marché. La partie non prise en charge est exclue du résultat et n'est jamais affichée comme un zéro.

## Indisponible (pas zéro)
Aucune donnée n'est revenue pour la fenêtre. `unavailable ≠ 0` : traitez-le comme un inconnu, pas comme une chute à zéro. Vous le verrez sur la part de voix et sur les cartes IA génératives de Search Console.

## « Reconnexion requise » sur les cartes analytics ou IA générative
Même cause que la reconnexion Search Console ci-dessus : Google a révoqué le jeton. Reconnectez depuis l'espace Google du site ; les cartes se rétablissent à la prochaine lecture.

## E-mail de vérification manquant
Vérifiez le spam ; le lien expire au bout de 24 h.

## Le résumé IA indique « raccourci »
Les audits longs sont tronqués avant envoi ; cliquez **Régénérer**.

## L’écran de rapport boucle en chargement
Rafraîchissement dur (⌘/Ctrl + Maj + R). Sinon, contactez le support.

[Retour à l’index de la documentation](./index.fr.md)
