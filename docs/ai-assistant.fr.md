---
title: 'Assistant IA'
description: 'Interrogez vos preuves SEO, recevez les réponses en continu et lancez les outils RankMeFast autorisés.'
locale: fr
slug: ai-assistant
section: developers
order: 3
---

# Travailler avec l’Assistant IA

L’Assistant IA disponible sur [/assistant](/assistant) réunit vos conversations RankMeFast dans un même espace. Il affiche les réponses au fil de leur génération et peut utiliser les outils RankMeFast autorisés pour lire les preuves SEO enregistrées ou lancer un audit. Il est inclus dans Starter, Pro et Agency ; les comptes sans offre payante voient un écran de mise à niveau.

## Démarrer une conversation

1. Ouvrez **Assistant IA** dans la barre latérale.
2. Choisissez éventuellement un site avant le premier message. Le site apporte du contexte ; l’accès aux outils suit toujours les autorisations du compte.
3. Saisissez une question et appuyez sur **Entrée**. Utilisez **Maj+Entrée** pour ajouter une ligne.
4. Suivez la réponse en direct. Dépliez une carte d’outil pour examiner ses arguments et son résultat structuré.
5. Sélectionnez **Arrêter** pour interrompre une réponse. La partie déjà produite reste dans la conversation.

Les conversations sont enregistrées automatiquement et restent disponibles après rechargement. Créez-en une nouvelle pour travailler sans site ou avec un autre site.

## Outils disponibles

L’Assistant utilise le même registre d’outils que RankMeFast MCP. Selon vos autorisations, il peut lancer :

- `list_sites`, `get_latest_audit_report`, `list_keywords` et `get_rank_history` pour les preuves de site et de classement enregistrées.
- `list_content_analyses` et `get_content_analysis` pour les travaux Content Intelligence enregistrés.
- `start_audit` pour lancer un audit et `get_audit_status` pour suivre son avancement.

Les outils de lecture consultent des données déjà stockées dans RankMeFast. `start_audit` est le seul outil payant : il consomme aussi un audit de votre forfait. Considérez les réponses comme des conseils et vérifiez les changements importants à partir des preuves affichées.

## Autorisations

Ouvrez [Paramètres → MCP](/profile?tab=mcp) pour définir les valeurs par défaut du compte utilisées par l’Assistant et les clients MCP. Vous pouvez activer ou désactiver chaque outil, limiter l’accès à certains sites et bloquer les actions payantes. Les réglages initiaux sont permissifs afin que les comptes existants continuent de fonctionner tant que vous ne les restreignez pas.

L’Assistant passe par votre session connectée : seules ces valeurs du compte s’appliquent à lui. Un outil désactivé n’est pas proposé au modèle, un site bloqué apparaît comme introuvable et `start_audit` exige aussi **Autoriser les actions payantes**. Les portées de clé API ne concernent que les clients MCP externes, où une clé peut restreindre les valeurs du compte sans jamais les élargir. Les détails sont dans [RankMeFast MCP](./rankmefast-mcp.fr.md).

## Messages, limites et crédits

Chaque message accepté que vous envoyez utilise une unité `ai_chat_messages`. Les quotas mensuels sont de 100 pour Starter, 200 pour Pro et 400 pour Agency. Arrêter une réponse compte tout de même, car le travail a déjà commencé. Un audit lancé depuis le chat consomme séparément un audit.

Lorsque le quota est épuisé, la zone de saisie propose une mise à niveau ou des crédits avant tout nouvel appel à l’IA. Un pack ponctuel **Chat IA** ajoute 100 messages pour 19 $ depuis **Facturation → Crédits**. Consultez [Plans, limites et crédits](./plans-limits-credits.fr.md) pour les quotas actuels.

## Résolution des problèmes

- **L’Assistant est verrouillé :** le compte n’a pas d’offre payante. Passez à Starter ou au-dessus.
- **Limite de messages atteinte :** attendez la remise à zéro mensuelle, changez de forfait ou ajoutez un pack Chat IA.
- **Un outil manque :** vérifiez son interrupteur dans **Paramètres → MCP**. Les portées des clés MCP ne modifient pas l’accès de l’Assistant connecté.
- **Un site est indisponible :** vérifiez le site lié à la conversation et son autorisation dans les réglages du compte.
- **Un audit ne démarre pas :** activez l’outil et les actions payantes, puis vérifiez votre quota d’audits.
- **Assistant indisponible :** l’installation a désactivé `CHAT_ENABLED` ou le service est momentanément indisponible. Réessayez ou contactez l’opérateur.
- **Le flux s’interrompt :** renvoyez le message. Une réponse partielle peut rester dans la conversation.

## Guides associés

- [RankMeFast MCP](./rankmefast-mcp.fr.md) : connectez un client IA externe et limitez sa clé.
- [Plans, limites et crédits](./plans-limits-credits.fr.md) : comparez les quotas de messages et d’audits.
- [Retour à l’index de la documentation](./index.fr.md)
