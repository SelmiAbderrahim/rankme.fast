---
title: 'Sécurité du compte'
description: 'Changer votre mot de passe et gérer vos identifiants.'
locale: fr
slug: settings-security
section: account
order: 3
---

# Sécurité du compte

Gérez les identifiants qui protègent votre compte RankMeFast depuis **Paramètres → Sécurité** (URL : `/settings/security`).

## Changer votre mot de passe

1. Connectez-vous et ouvrez **Paramètres → Sécurité**.
2. Renseignez votre **mot de passe actuel**, choisissez un **nouveau mot de passe** et confirmez-le. Le nouveau mot de passe doit contenir au moins huit caractères et être différent de l'actuel.
3. Cliquez sur **Mettre à jour**.

Nous utilisons scrypt pour stocker les empreintes de mot de passe : nous ne voyons jamais votre mot de passe en clair. Lorsque le changement réussit :

- Toutes les **autres** sessions actives de votre compte sont déconnectées. L'appareil sur lequel vous avez effectué le changement reste connecté.
- Un e-mail de confirmation est envoyé à l'adresse associée à votre compte. Si ce n'est pas vous qui avez changé le mot de passe, cet e-mail est le signal pour réinitialiser immédiatement votre mot de passe via [le flux mot de passe oublié](./getting-started.fr.md).

Si le mot de passe actuel saisi est incorrect, nous vous le disons à côté du champ. Nous ne révélons jamais si un compte existe pour une adresse donnée.

## Changer votre adresse e-mail

1. Connectez-vous et ouvrez **Paramètres → Sécurité**.
2. Saisissez la **nouvelle adresse e-mail** dans la carte *Changer l'adresse e-mail*. Elle doit être différente de votre adresse actuelle.
3. Cliquez sur **Envoyer le lien de vérification**.

Nous envoyons un lien de confirmation à la **nouvelle** adresse. L'adresse de votre compte ne change qu'après avoir cliqué sur ce lien :

- Votre **adresse actuelle reste valide** pour la connexion tant que vous n'avez pas confirmé.
- Si la nouvelle adresse est déjà enregistrée pour un autre compte, nous rejetons le changement avec un message générique *adresse indisponible*, sans dire à qui elle appartient.
- Le lien est à usage unique et expire au bout d'un court délai ; relancez la demande depuis la même page s'il expire.

## Mot de passe actuel oublié ?

Si vous ne vous souvenez pas de votre mot de passe actuel, déconnectez-vous et utilisez **Mot de passe oublié ?** sur l'écran de connexion. Le lien reçu par e-mail vous mène à une page où vous choisissez un nouveau mot de passe sans confirmer l'ancien.


## Authentification à deux facteurs

Ajoutez une seconde étape à la connexion pour qu'un mot de passe volé seul ne suffise pas à accéder à votre compte.

### Activer

1. Connectez-vous et ouvrez **Paramètres → Sécurité**.
2. Dans la carte **Authentification à deux facteurs**, saisissez votre mot de passe actuel et cliquez sur **Activer**.
3. Scannez le code QR avec une application comme 1Password, Authy ou Google Authenticator, ou collez le code manuel dans l'application.
4. Copiez ou téléchargez les **codes de secours**. Chaque code ne fonctionne qu'une fois. C'est le seul moyen de revenir en cas de perte d'appareil.
5. Saisissez le code à six chiffres affiché par votre application et cliquez sur **Vérifier et activer**.

### Désactiver

Ouvrez la même carte, cliquez sur **Désactiver**, puis saisissez votre mot de passe actuel.

### Comptes administrateurs

Si votre compte a le rôle **Admin**, l'authentification à deux facteurs est obligatoire. Vous ne pourrez pas ouvrir le panneau admin tant qu'elle n'est pas activée.

### Appareil perdu

Utilisez un code de secours sur l'écran de vérification : un lien **Utiliser un code de secours** y figure. Si vous n'avez plus de codes, un admin peut réinitialiser le second facteur depuis le panneau admin.

## Vos droits sur les données

Vous pouvez demander un export ou une suppression des données de votre compte. L'export actuel se limite aux jeux de données présents dans le fichier généré et exclut les instantanés Pages ainsi que l'historique chronologique de GSC et du suivi de positions. La suppression est plus large : après le délai de grâce, elle efface les données stockées du compte même lorsqu'elles ne figurent pas dans l'export. Vous pouvez annuler la demande pendant ce délai. Consultez [Performance des pages](./pages-performance.fr.md) pour la règle de conservation des données Pages.
