---
title: 'Alertes'
description: 'Quelles alertes se déclenchent, comment fonctionne la livraison exactement-une-fois, et quand une règle de chute de position livre.'
locale: fr
slug: alerts
section: product
order: 6
---

# Alertes

Les règles d'alerte se configurent par site. Elles peuvent être livrées par e-mail, par webhook entrant Slack ou par un webhook générique signé en HMAC. Les livraisons ne sont pas décomptées.

<!-- docs-truth: metric=none; unit=none-deliveries-not-metered; cache-hits=not-applicable; refund=not-applicable; cadence=on-observed-transition; estimates=provider-observation -->

## Ce qui se déclenche aujourd'hui

Les alertes de domaines référents nouveaux et perdus. Elles se déclenchent après deux revues de liens terminées d'affilée, et chaque alerte contient les éléments avant/après qui l'ont provoquée.

Les règles de chute de position ne se déclenchent qu'une fois la chute confirmée : un contrôle de position planifié repère la chute, puis un second contrôle récent du même mot-clé sur le même marché la montre toujours. Si le mot-clé remonte ou si le second contrôle ne peut pas avoir lieu, la règle n'envoie rien. Voir [Alertes de position confirmées](./confirmed-rank-alerts.fr.md).

## Une alerte par changement

Chaque changement observé est livré une seule fois, sous forme d'une alerte et non d'une alerte par domaine. Si une revue ajoute 300 liens, vous recevez une seule alerte avec un échantillon de 50 domaines au plus et le total complet.

Votre première revue de liens n'a rien à quoi se comparer, elle ne déclenche donc jamais d'alerte. Le journal de livraison consigne chaque tentative comme envoyée, échouée ou supprimée.

Quand un transport échoue, la livraison est consignée comme échouée au lieu d'être réessayée sans fin. Le même changement n'est jamais renvoyé dans une seconde alerte.

## Canaux

L'e-mail, Slack et le webhook générique sont tous disponibles.

Pour Slack, vous collez une URL de webhook entrant. Il n'existe ni application Slack RankMeFast, ni bot.

Les webhooks génériques sont signés, pour que votre récepteur puisse vérifier qu'une charge utile vient bien de RankMeFast.

## Ce que signifie une alerte

Une alerte vous indique qu'un changement a eu lieu entre deux instantanés stockés. Elle ne juge pas la qualité des liens et ne prédit aucun effet sur le classement.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
