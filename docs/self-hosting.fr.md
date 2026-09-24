---
title: "Héberger RankMeFast"
description: "Exécutez RankMeFast sur votre serveur avec Docker Compose."
locale: fr
slug: self-hosting
section: start
order: 5
---

# Héberger RankMeFast

## Avant de commencer

Installez Docker avec Compose et récupérez le code du projet. Lancez les commandes depuis le répertoire du projet. Le logiciel est gratuit ; le serveur et l’usage des API fournisseurs restent à votre charge. Gardez le fichier d’environnement privé.

## Configurer l’installation

Copiez le modèle, puis modifiez le fichier `.env` à la racine :

```bash
cp .env.example .env
```

Définissez `CLIENT_URL` et `SERVER_URL`. `BETTER_AUTH_SECRET` et `MASTER_ENCRYPTION_KEY` ont chacun besoin de leur propre valeur aléatoire : lancez `openssl rand -hex 32` une fois pour chacun. Configurez ensuite les fournisseurs réels, leurs identifiants et le transport des e-mails décrits dans `.env.example`. Sur votre propre installation, vous pouvez conserver `PAYMENT_PROVIDER=none`.

Pour une installation sur une seule origine, donnez à `APP_URL` et `VITE_SITE_URL` la même valeur que `CLIENT_URL`.

Ne démarrez pas avec des identifiants fictifs. La production refuse par défaut les fournisseurs simulés, et les options de démonstration ne doivent jamais être activées sur un déploiement public.

## Démarrer et vérifier

Une fois la configuration faite, démarrez la plateforme et vérifiez que tous les services sont en bonne santé :

```bash
docker compose up -d --build
docker compose ps
```

Ouvrez ensuite l’adresse définie dans `CLIENT_URL`, créez un compte et ajoutez votre premier site.

## Assurer le fonctionnement

La sécurité du serveur, HTTPS, les mises à jour et les sauvegardes des bases et du fichier d’environnement sont à votre charge. Sauvegardez avant chaque mise à jour. En cas d’échec au démarrage, consultez les journaux des services, sans jamais partager ceux qui contiennent des identifiants.
