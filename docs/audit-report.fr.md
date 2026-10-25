---
title: 'Lire votre rapport d’audit'
description: 'À corriger, À surveiller, Réussis : ce que signifie chaque onglet et chaque règle.'
locale: fr
slug: audit-report
section: start
order: 2
---

# Lire votre rapport d’audit

Après chaque audit, vous arrivez sur un rapport à trois onglets avec un bouton **Relancer**.

## Les trois onglets
- **À corriger** : les problèmes auxquels Google réagit le plus vite.
- **À surveiller** : des points moins urgents, ou des données insuffisantes.
- **Réussis** : les vérifications passées.

## Ce qu’affiche chaque problème
- **Titre** : le nom du problème, en clair.
- **Pourquoi c'est important** : une phrase sur l’impact.
- **URL concernées** : les pages où le problème a été trouvé.
- **Comment corriger** : la modification à faire, avec un bouton pour la copier.

## Relancer et badges d’évolution
Après une correction, cliquez sur **Relancer**. Deux badges peuvent apparaître :
- **Corrigé** : la règle passe désormais.
- **Régression** : la règle échoue alors qu’elle passait.

## Fichier `llms.txt`
Une convention récente qui indique aux assistants IA les pages que vous préférez voir citées. Chez nous, cette règle est **indicative**.

## Chaque règle en clair
- **Bloqué de Google** : Une règle `robots.txt` empêche Google d’y accéder.
- **Sitemap manquant ou faible** : Ajoutez `sitemap.xml` et référencez-le dans `robots.txt`.
- **Titres de page manquants ou faibles** : Titre unique de 30 à 60 caractères par page.
- **Meta descriptions manquantes ou dupliquées** : Une description unique par page.
- **Titres H1/H2 mal utilisés** : Un seul `<h1>` par page.
- **Canonical manquant ou cassé** : Ajoutez un `<link rel="canonical">` valide.
- **Données structurées manquantes** : Ajoutez le JSON-LD adapté.
- **Liens internes cassés** : Corrigez ou supprimez les liens en erreur.
- **Contenu trop léger** : Pages avec très peu de texte propre, jugées selon un seuil adapté à la langue de la page : environ 200 mots pour la plupart des langues, et l’équivalent en caractères pour le chinois, le japonais, le coréen et le thaï. Chaque page signalée indique la longueur mesurée.
- **Aucun signal FAQ** : Ajoutez une section FAQ quand pertinent.
- **Fichier llms.txt absent (informatif)** : Convention récente destinée aux robots d’IA.
- **HTTPS non appliqué** : Redirigez http vers https.
- **Performances visiteurs réelles faibles** : Données Chrome UX indiquant une expérience lente.
- **Estimation labo faible** : Un seul passage Lighthouse varie beaucoup d’une fois à l’autre.
- **Non adapté au mobile** : Vérifiez viewport et taille des cibles.
- **Non indexé** : Google n’a pas ajouté la page à l’index.
- **Problèmes de résultats enrichis** : Erreurs dans les données structurées.
- **Indexé avec avertissements** : Signal de canonisation/doublon détecté.
- **Pages qui répondent par une erreur** : Adresses explorées qui renvoient une erreur (4xx ou 5xx). Remettez la page en ligne ou redirigez l’adresse. Un refus (401, 403 ou 429) peut venir d’une protection anti-robots : vérifiez d’abord dans un navigateur.
- **Chaînes et boucles de redirection** : Adresses qui passent par deux redirections ou plus, ou n’aboutissent jamais. Faites pointer la première directement vers la page finale.
- **Liens qui pointent vers des redirections** : Liens internes dont la cible redirige. Pointez plutôt vers l’adresse finale.
- **Pages qui redirigent avec une balise refresh** : Une balise `<meta http-equiv="refresh">` renvoie les visiteurs ailleurs. Utilisez plutôt une redirection serveur permanente (301).
- **Balises canonical qui pointent au mauvais endroit** : Canonical vers une page cassée, une redirection, une autre canonical, ou en aller-retour entre deux pages. Pointez vers une page fonctionnelle qui se désigne elle-même.
- **Pages vers lesquelles aucune autre page ne renvoie** : Pages de votre sitemap qu’aucun lien interne n’atteint. Liez-les depuis une page connexe ou un menu.
- **Pages enfouies dans l’arborescence** : Pages à plus de trois clics de l’accueil. Rapprochez les plus importantes.
- **Pages qui partagent le même titre** : Deux pages ou plus avec le même `<title>`. Donnez à chacune le sien.
- **Pages qui semblent copiées les unes sur les autres** : Pages jugées quasi identiques, avec un score de similarité sur dix. Fusionnez-les ou différenciez-les.
- **Texte de remplissage sur des pages en ligne** : Faux texte « Lorem ipsum » sur une page publiée. Remplacez-le par le vrai contenu.
- **Pages sécurisées qui renvoient vers des adresses non sécurisées** : Pages HTTPS avec des liens vers des adresses `http://`. Passez-les en `https://`.
- **Images sans texte alternatif** : Images sans attribut `alt`. Décrivez les images utiles et laissez un `alt` vide sur les images décoratives.
- **Pages lentes à démarrer** : Plus de 1,5 seconde pour le premier octet, ou plus de trois secondes pour la page. Une seule mesure en laboratoire, pas l’expérience de chaque visiteur.
- **Pages très lourdes** : HTML de plus de 1 Mo. Au-delà de 3 Mo, le constat passe dans À corriger.
- **Pages envoyées sans compression** : HTML envoyé sans compression gzip ni Brotli. Activez-la sur le serveur.
- **Scripts et styles qui retardent le premier affichage** : Fichiers qui bloquent le premier affichage, avec leur nombre. Chargez les scripts en `async` ou `defer`.
- **Pages sans les déclarations HTML de base** : Pas de ligne `<!DOCTYPE html>` ou pas de déclaration de jeu de caractères.
- **HTML obsolète sur vos pages** : Balises supprimées, Flash ou cadres. Un cadre comme une vidéo intégrée peut être légitime : vérifiez-le plutôt que de le supprimer.
- **Adresses difficiles à lire** : Adresses avec des caractères inhabituels, des paramètres de requête ou plus de 120 caractères.
- **Pages sans balises de partage social** : Pas de balises Open Graph : un lien partagé peut afficher le mauvais titre, texte ou image.
- **Pas de favicon** : Aucune petite icône pour les onglets du navigateur et les résultats de recherche.
- **Images, scripts ou styles cassés** : Fichiers nécessaires à la page qui renvoient une erreur. Vérification effectuée seulement pour un audit lancé avec l’analyse des ressources ; sinon, le rapport la classe dans Non évalué.
- **Images plus grandes que nécessaire** : Images de plus de 500 Ko. Vérification liée à l’analyse complète des ressources, comme la précédente.
- **Fichiers exclus du cache des navigateurs** : Images, scripts et feuilles de style envoyés avec des en-têtes qui empêchent leur mise en cache. Vérification liée à l’analyse complète des ressources.

## Constats écartés et corrigés

Écartez un constat qui ne vous concerne pas, ou marquez-le comme corrigé, depuis sa carte dans le rapport ou depuis [Prochaines actions](./next-actions.fr.md). L’écartement demande un motif : faux positif, ne sera pas corrigé, corrigé ailleurs ou autre motif. Les constats écartés passent dans une section **Écartés** sous les onglets, et les constats marqués corrigés dans un groupe **Marqué comme corrigé** à l’intérieur de leur onglet. Aucun n’est compté dans les totaux des onglets ni dans la vue d’ensemble. Chaque entrée écartée indique qui l’a écartée, quand et pourquoi, et si le dernier audit la détecte encore. **Restaurer** la remet dans la liste.

Pour un constat de liens cassés, **Revérifier ces URL** interroge à nouveau vos propres pages et note celles qui échouent encore, celles qui fonctionnent désormais et celles qui n’ont pas pu être vérifiées. Cela ne lance pas de nouvel audit, et le rapport d’audit reste tel quel.

Les URL concernées sont des liens. Une longue liste montre d’abord un échantillon, et **Télécharger les URL (CSV)** les enregistre toutes. Quand l’audit le plus récent a plus de 30 jours, un message **Dernier audit il y a N jours** avec **Lancer un nouvel audit** apparaît, car les résultats peuvent ne plus correspondre à votre site.

## Analyser les images, scripts et styles

Les trois dernières vérifications ont besoin de charger chaque image, script et feuille de style de vos pages. L’exploration est alors plus lente et consomme davantage de votre budget d’exploration, c’est donc une option propre à chaque audit.

- **Analyser les images, scripts et styles** est cochée par défaut quand vous lancez un audit. Décochez-la pour ignorer l’analyse pour cette exécution.
- Un audit avec analyse explore 1 000 pages au plus. Décochez l’option pour explorer davantage de pages, sans l’analyse.
- Si l’analyse ne peut pas être lue, l’audit se termine quand même et les trois vérifications apparaissent dans Non évalué, avec la raison.
- Un audit lancé sans l’analyse classe ces vérifications dans Non évalué. Lancez un nouvel audit avec l’option cochée pour les inclure.

[Retour à l’index de la documentation](./index.fr.md)
