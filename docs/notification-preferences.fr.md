---
title: 'Préférences de notifications'
description: 'Choisissez les e-mails non liés à la sécurité que vous souhaitez recevoir.'
locale: fr
slug: notification-preferences
section: account
order: 4
---

# Préférences de notifications

Vous choisissez les e-mails hors sécurité que RankMeFast vous envoie. Ouvrez **Paramètres → Notifications** (`/settings/notifications`) et actionnez les interrupteurs de votre choix.

Les interrupteurs d’audit, de position et d’alertes sont **activés** par défaut ; **Actualités produit** est **désactivé** par défaut et n’est envoyé qu’après activation. Un changement prend effet immédiatement : le prochain e-mail correspondant est ignoré (ou envoyé, pour un interrupteur activé).

## Ce que chaque commutateur contrôle

- **Audit terminé** : envoyé lorsqu’un audit se termine pour l’un de vos sites.
- **Chute de position** : envoyé quand un mot-clé suivi a baissé et qu’un second contrôle le confirme.
- **Règles d’alerte** : envoyé quand l’une de vos propres [règles d’alerte](./alerts.fr.md) se déclenche. Cet interrupteur ne concerne que le canal e-mail. Les envois Slack et webhook continuent de fonctionner.
- **Facturation** : reçus de paiement, rappels de paiement échoué et avis de recouvrement. Le désactiver coupe tous les e-mails de facturation ; vous pouvez toujours voir les reçus et les factures passées dans **Facturation → Factures**.
- **Actualités produit** : messages de bienvenue occasionnels, actualités et astuces.

## Chute de position et règles d’alerte sont distinctes

L’e-mail **Chute de position** est intégré. RankMeFast l’envoie quand un mot-clé suivi baisse et qu’un second contrôle confirme la baisse, sans seuil à définir. Les règles d’alerte, vous les construisez vous-même dans **Alertes → Règles** (`/dashboard/alerts?tab=rules`). Vous choisissez le seuil et la destination de l’alerte, y compris Slack ou un webhook signé. Aucune ne remplace l’autre. Désactiver **Chute de position** laisse vos règles d’alerte actives, et supprimer toutes les règles laisse l’e-mail intégré actif.

## Le Pulse hebdomadaire est un opt-in séparé

Le digest [Pulse hebdomadaire](./weekly-pulse.fr.md) n’est pas contrôlé par les commutateurs ci-dessus. Chaque coéquipier l’active par site depuis l’espace AI Visibility du site, et il reste désactivé tant qu’il ne le fait pas.

Si un envoi est relancé, vous ne recevez quand même chaque digest qu’une fois. Si votre adresse ne peut pas recevoir l’e-mail, les autres coéquipiers abonnés reçoivent quand même le leur.

## Les e-mails de sécurité ne peuvent pas être désactivés

Les e-mails suivants sont toujours envoyés, quelle que soit la configuration des commutateurs ci-dessus :

- Lien de réinitialisation du mot de passe.
- Vérification de l’adresse e-mail.
- Confirmation de changement de mot de passe.

Ces e-mails protègent votre compte. Si vous en recevez un que vous n’attendiez pas, vérifiez vos sessions actives et réinitialisez votre mot de passe depuis **Paramètres → Sécurité**.
