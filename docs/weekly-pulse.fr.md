---
title: 'Pulse hebdomadaire'
description: 'Un digest hebdomadaire par site, construit à partir de signaux déjà payés.'
locale: fr
slug: weekly-pulse
section: audits
order: 7
---

# Pulse hebdomadaire

Le Pulse hebdomadaire est un e-mail récapitulatif optionnel qui résume ce qui a changé pour votre site pendant la dernière semaine ISO. Il est désactivé par défaut. Chaque membre vérifié de l'équipe l'active pour lui-même. Personne ne peut l'activer à votre place.

## Ce que coûte un pulse

Envoyer un digest pour un site utilise **une unité `ai_mentions_checks`** pour ce site, quel que soit le nombre de coéquipiers abonnés. Consulter l'historique, rouvrir un ancien digest ou exporter des données stockées ne coûte rien et n'appelle aucun fournisseur.

## Ce qu'il contient

Le digest est construit uniquement à partir de signaux déjà stockés :

- Citations nouvelles et perdues sur les moteurs IA couverts par votre plan.
- Baisses de position confirmées sur vos mots-clés suivis.
- Actions terminées ou en recul depuis le pulse compatible précédent.
- Vos trois prochaines actions ouvertes.
- Apparence générative Google Search Console, quand Google renvoie des lignes.

Le pulse ne demande pas de nouvelles réponses aux moteurs IA et ne lance pas de nouvelle requête SERP.

## Quand il s'exécute

Chaque site a un créneau hebdomadaire fixe, calculé à partir de l'identifiant du site et réparti entre lundi et samedi, 09:00–14:00 UTC. Le dimanche est réservé aux opérations. Vous voyez le prochain créneau dans l'espace AI Visibility du site.

## États possibles

- **Terminé** : chaque moteur pris en charge a renvoyé des données et le digest est prêt.
- **Partiel** : certains moteurs ont renvoyé des données partielles. Le digest part quand même avec ce qui est arrivé.
- **Non pris en charge** : aucun moteur de votre plan ne couvre le marché et la cohorte de ce site ; aucune unité n'est consommée.
- **Bloqué** : votre quota `ai_mentions_checks` est épuisé pour le mois ; aucun appel fournisseur.
- **Échoué** : tous les moteurs pris en charge ont échoué pour cette exécution. L'unité est utilisée et n'est pas remboursée.

## Activer ou désactiver

Ouvrez l'espace AI Visibility du site, examinez l'aperçu de dépense, puis basculez **Pulse hebdomadaire**. La désactivation arrête tout de suite les prochains e-mails. La réactivation reprend au prochain créneau.

## Confidentialité

Les e-mails contiennent uniquement de courts résumés : hôte, compteur, texte du mot-clé, position, verbe d'action, nom d'apparence. Les réponses IA brutes, extraits sources, textes concurrents, prompts et identifiants de tâche fournisseur n'apparaissent jamais dans le digest.

[Retour à l'index de la documentation](./index.fr.md)
