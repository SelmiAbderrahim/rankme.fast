---
title: 'Assistant IA'
description: 'Interrogez vos preuves SEO, recevez les réponses en continu et lancez les outils RankMeFast autorisés.'
locale: fr
slug: ai-assistant
section: developers
order: 3
---

# Travailler avec l’Assistant IA

L’Assistant IA, sur [/assistant](/assistant), réunit vos conversations RankMeFast dans un seul espace. Il diffuse les réponses au fil de leur production et peut utiliser les outils RankMeFast autorisés pour lire les preuves SEO enregistrées ou lancer un audit.

## Démarrer une conversation

1. Ouvrez **Assistant IA** dans la barre latérale.
2. Choisissez éventuellement un site avant le premier message. Le site apporte du contexte ; l’accès aux outils suit toujours les autorisations du compte.
3. Saisissez une question et appuyez sur **Entrée**. Utilisez **Maj+Entrée** pour ajouter une ligne.
4. Suivez la réponse en direct. Dépliez une carte d’outil pour examiner ses arguments et son résultat structuré.
5. Sélectionnez **Arrêter** pour interrompre une réponse. La partie déjà produite reste dans la conversation.

Les conversations sont enregistrées automatiquement et restent disponibles après rechargement. Créez-en une nouvelle pour travailler sans site ou avec un autre site.

Quand un site est choisi, les questions suggérées portent sur ce site. Avec **Aucun site — conseils généraux**, elles couvrent à la place votre compte et des questions SEO générales. Chaque conversation porte le nom de votre premier message, auquel s’ajoute le domaine du site quand cela distingue des conversations semblables. Pour en supprimer une, sélectionnez l’icône de corbeille à côté et confirmez ; **Annuler** la conserve. Si une réponse est interrompue avant la fin, la partie reçue reste dans la conversation avec un message et un bouton **Réessayer**.

## Outils disponibles

L’Assistant utilise le même registre d’outils que RankMeFast MCP. Selon vos autorisations, il peut lancer :

- `list_sites`, `get_latest_audit_report`, `list_keywords` et `get_rank_history` pour les preuves de site et de classement enregistrées.
- `list_content_analyses` et `get_content_analysis` pour les travaux Content Intelligence enregistrés.
- `start_audit` pour lancer un audit et `get_audit_status` pour suivre son avancement.

Les outils de lecture utilisent des données déjà enregistrées dans RankMeFast, sans appeler de fournisseur de données. Les cartes d’outils indiquent l’outil exécuté, et [RankMeFast MCP](./rankmefast-mcp.fr.md) les liste tous. `start_audit` est le seul outil qui dépense : il lance un audit et consomme le crédit de votre propre compte fournisseur. Considérez les réponses de l’Assistant comme des indications et vérifiez les changements importants avec les preuves affichées.

## Autorisations

Ouvrez [Paramètres → MCP](/settings/profile?tab=mcp) pour définir les valeurs par défaut du compte utilisées par l’Assistant et les clients MCP. Vous pouvez activer ou désactiver chaque outil, limiter l’accès à certains sites et bloquer les actions payantes. Les réglages initiaux sont permissifs afin que les comptes existants continuent de fonctionner tant que vous ne les restreignez pas.

L’Assistant passe par votre session connectée : seules ces valeurs du compte s’appliquent à lui. Un outil désactivé n’est pas proposé au modèle, un site bloqué apparaît comme introuvable et `start_audit` exige aussi **Autoriser les actions payantes**. Les portées de clé API ne concernent que les clients MCP externes, où une clé peut restreindre les valeurs du compte sans jamais les élargir. Les détails sont dans [RankMeFast MCP](./rankmefast-mcp.fr.md).

## Messages et limites

Chaque message envoyé ouvre une réponse IA diffusée, c’est pourquoi l’Assistant est limité en débit par compte : si vous envoyez beaucoup de messages en peu de temps, patientez un instant puis réessayez. Arrêter une réponse conserve ce qui était déjà écrit. Lancer un audit depuis le chat consomme les mêmes crédits fournisseur que de le lancer vous-même. L’opérateur de votre installation peut désactiver l’Assistant avec `CHAT_ENABLED` et borne la longueur de chaque réponse.

## Résolution des problèmes

- **Un outil manque :** vérifiez son interrupteur dans **Paramètres → MCP**. Les portées des clés MCP ne changent pas l’accès de l’Assistant en session.
- **Un site est indisponible :** vérifiez que la conversation est liée au bon site et que ce site est autorisé dans les valeurs par défaut du compte.
- **Un audit ne démarre pas :** activez l’outil et les actions de dépense, et vérifiez qu’aucun audit n’est déjà en cours pour le site.
- **Trop de requêtes :** patientez un instant puis réessayez.
- **Assistant indisponible :** l’installation a désactivé `CHAT_ENABLED` ou le service est momentanément indisponible. Réessayez plus tard ou contactez l’opérateur.
- **Le flux s’arrête de façon inattendue :** utilisez **Réessayer** sur le message. La réponse partielle reste dans la conversation.

## Guides associés

- [RankMeFast MCP](./rankmefast-mcp.fr.md) : connectez un client IA externe et limitez sa clé.
- [Retour à l’index de la documentation](./index.fr.md)
