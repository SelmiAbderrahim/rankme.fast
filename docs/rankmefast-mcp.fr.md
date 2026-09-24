---
title: 'RankMeFast MCP'
description: 'Connectez RankMeFast aux agents de programmation, aux IDE et aux outils CLI compatibles MCP.'
locale: fr
slug: rankmefast-mcp
section: developers
order: 2
---

# Connectez RankMeFast à vos outils d’IA

RankMeFast fournit un endpoint distant [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Un agent de programmation, un IDE ou un outil CLI compatible peut ainsi lire vos données SEO et lancer des audits sans quitter votre environnement de travail.

## Configuration en cinq minutes

1. Ouvrez [Paramètres → Clés API](/profile?tab=api-keys), sélectionnez **Créer une clé**, puis copiez la clé dès son affichage. RankMeFast ne montre la clé complète qu’une seule fois.
2. Utilisez l’endpoint MCP de RankMeFast :

   ```text
   https://rankme.fast/api/mcp
   ```

3. Pour les clients compatibles avec les variables d’environnement, définissez la clé avant de démarrer le client :

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   Dans PowerShell :

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. Choisissez votre client ci-dessous, collez sa configuration, puis redémarrez-le ou rechargez-le.
5. Vérifiez la connexion avec : **« Utilise RankMeFast pour répertorier mes sites. »**

> Traitez la clé comme un mot de passe : gardez-la dans une variable d’environnement, une saisie protégée ou une configuration utilisateur, et ne la versionnez jamais dans un dépôt. Vous pouvez restreindre les portées de chaque clé (voir plus bas). Notez que `start_audit` consomme votre quota mensuel d’audits.

L’accès MCP est inclus dans les plans Starter, Pro et Agency. Les clés Agency fonctionnent également avec l’API REST publique en lecture seule.

## Contrôler les autorisations et les portées de clés

Ouvrez [Paramètres → MCP](/profile?tab=mcp) pour gérer les valeurs par défaut du compte partagées par MCP et l’Assistant IA connecté :

1. Activez ou désactivez chaque outil RankMeFast.
2. Laissez **Sites autorisés** sur tous les sites ou sélectionnez ceux que les outils peuvent utiliser.
3. Désactivez **Autoriser les actions payantes** si `start_audit` ne doit jamais être lancé.
4. Enregistrez. La carte de démarrage rapide du même onglet affiche l’endpoint, un raccourci vers les clés API et une configuration client à copier.

Les valeurs du compte sont entièrement permissives tant que vous ne les modifiez pas ; les clés existantes continuent donc de fonctionner. L’Assistant les utilise directement via votre session connectée.

Vous pouvez ajouter des portées plus étroites lors de la création d’une clé dans [Paramètres → Clés API](/profile?tab=api-keys), puis les modifier ultérieurement. Les portées ne peuvent que restreindre l’accès. L’accès MCP effectif est toujours l’intersection :

- Un outil n’est disponible que si le compte et la clé l’autorisent.
- Si le compte et la clé sélectionnent des sites, seuls ceux présents dans les deux listes sont disponibles.
- `start_audit` exige que l’outil et les actions payantes soient autorisés aux deux niveaux.

Une portée sans restriction reprend simplement la valeur du compte. Un outil non autorisé n’apparaît pas dans le client, et un site bloqué renvoie le même résultat introuvable qu’un site qui ne vous appartient pas.

## Langue et contrat JSON-RPC

Pour `tools/list` et tout appel sans argument `locale`, MCP choisit la langue avec `x-lang`, puis `Accept-Language`, et à défaut `en`. Un tag régional comme `fr-CA` devient `fr`. Le point d’accès bearer ignore les cookies du navigateur, la langue du compte et les préférences de l’espace de travail.

Chaque outil accepte aussi un argument `locale` facultatif, qui doit valoir exactement `en`, `ar`, `fr`, `de`, `es`, `ru` ou `zh`. Il remplace les en-têtes pour cet appel : textes d’erreur et de réussite, champ `locale` du résultat structuré et en-tête HTTP `Content-Language`. Toute autre valeur est refusée comme paramètre invalide (`-32602`), dans la langue des en-têtes ; contrairement à un en-tête, elle n’est pas ramenée depuis un tag régional. Les réponses ajoutent `x-lang, Accept-Language` à `Vary` en conservant les valeurs existantes.

Seuls les descriptions d’outil, les résumés lisibles et les messages d’erreur sûrs sont traduits. Les données lisibles par machine sont identiques dans toutes les langues : noms et schémas d’outil, `jsonrpc`, `code` et `id` JSON-RPC, noms de propriétés, valeurs d’énumération et d’état, booléens, totaux, identifiants, domaines, URL, mots-clés, horodatages, curseurs, preuves et textes enregistrés de l’utilisateur ou du fournisseur. Les résultats structurés gagnent un champ `locale` sans rien perdre.

Les erreurs de protocole gardent leur code numérique : `-32700` erreur d’analyse, `-32600` requête invalide, `-32601` méthode inconnue, `-32602` paramètres ou outil invalides et `-32603` erreur interne. Le message est traduit à partir du code, et les diagnostics bruts du SDK, de la validation ou du fournisseur ne sont jamais renvoyés. MCP ne renvoie pas de CSV ; le [guide de l’API publique](./public-api.fr.md) décrit le format CSV stable octet par octet.

## Choisissez votre client

| Client ou interface | Configuration directe | Configuration |
| --- | --- | --- |
| Claude Code et son onglet Code sur ordinateur | Oui | Serveur HTTP avec en-tête Bearer |
| Cursor IDE et Cursor Agent CLI | Oui | Fichier MCP JSON utilisateur ou projet |
| VS Code avec GitHub Copilot | Oui | Fichier `mcp.json` utilisateur ou espace de travail |
| GitHub Copilot CLI | Oui | Commande CLI ou JSON utilisateur |
| Windsurf / Cascade | Oui | Fichier MCP JSON utilisateur |
| Codex CLI, extension IDE et Codex dans ChatGPT pour ordinateur | Oui | Fichier TOML Codex partagé |
| Gemini CLI | Oui | Commande CLI ou JSON utilisateur |
| OpenCode | Oui | Fichier MCP JSON distant |
| JetBrains AI Assistant et Junie | Oui | Paramètres MCP de l’IDE |
| Zed | Oui | Serveur de contexte distant |
| Cline | Oui | Serveur Streamable HTTP |
| Roo Code | Oui | Serveur Streamable HTTP |
| Kiro IDE et CLI | Oui | Fichier MCP JSON utilisateur ou projet |
| Copilot dans Visual Studio, JetBrains, Xcode et Eclipse | Oui | Fichier Copilot MCP JSON |
| Connecteur de chat Claude.ai / Claude Desktop | Pas directement | Le connecteur exige OAuth ; RankMeFast utilise actuellement des clés Bearer |
| ChatGPT web | Pas directement | Il ne lit pas la configuration MCP locale de Codex |

Tout autre client peut se connecter s’il prend en charge **Streamable HTTP** à distance et un en-tête `Authorization` personnalisé. RankMeFast ne propose ni serveur stdio local ni ancien serveur SSE.

## Claude Code

Ajoutez un serveur au niveau utilisateur. Les apostrophes simples préservent la référence à la variable d’environnement :

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

Vérifiez la connexion avec :

```bash
claude mcp get rankmefast
```

Vous pouvez aussi exécuter `/mcp` dans Claude Code. L’interface Claude Code de l’application pour ordinateur utilise la même configuration. Consultez le [guide MCP officiel de Claude Code](https://code.claude.com/docs/en/mcp).

Le **connecteur de chat** de Claude.ai et Claude Desktop est différent : son processus de connexion à distance documente OAuth, pas un en-tête Bearer statique arbitraire. Il ne peut pas se connecter directement tant que RankMeFast ne propose pas OAuth ; utilisez plutôt Claude Code. Consultez les [connecteurs personnalisés Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE et Cursor Agent CLI

Créez `~/.cursor/mcp.json` pour une configuration utilisateur. Remplacez les deux valeurs temporaires et gardez ce fichier privé :

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Cursor IDE et Cursor Agent CLI lisent la même configuration. Vérifiez-la avec :

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

Pour une configuration d’équipe, utilisez `.cursor/mcp.json`, mais ne placez pas de clé en clair dans ce fichier versionné. Consultez le [guide MCP officiel de Cursor](https://docs.cursor.com/context/model-context-protocol).

## VS Code et GitHub Copilot

Exécutez **MCP: Open User Configuration** depuis la palette de commandes, puis utilisez une saisie de mot de passe afin que le secret ne soit pas écrit dans le fichier :

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "rankmefast-key",
      "description": "RankMeFast API key",
      "password": true
    }
  ],
  "servers": {
    "rankmefast": {
      "type": "http",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${input:rankmefast-key}"
      }
    }
  }
}
```

Exécutez **MCP: List Servers** pour démarrer ou inspecter le serveur. La configuration de l’espace de travail peut être enregistrée dans `.vscode/mcp.json` ; le formulaire avec saisie protégée peut être partagé sans risque. Consultez la [référence officielle de configuration MCP de VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

Une fois `RANKMEFAST_API_KEY` défini dans votre shell :

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

Le shell développe la clé avant que Copilot enregistre la configuration utilisateur ; protégez donc `~/.copilot/mcp-config.json`. Consultez [Ajouter des serveurs MCP à Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

Ajoutez ceci à `~/.codeium/windsurf/mcp_config.json` :

```json
{
  "mcpServers": {
    "rankmefast": {
      "serverUrl": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

Rechargez-le depuis **Windsurf Settings → Cascade → MCP Servers**. Consultez le [guide MCP officiel de Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI, extension IDE et ChatGPT pour ordinateur

Codex CLI, l’extension Codex pour IDE et l’interface Codex de ChatGPT pour ordinateur partagent `~/.codex/config.toml` sur la même machine :

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

Redémarrez l’IDE ou l’application après avoir défini la variable d’environnement. Dans la CLI, vérifiez la connexion avec :

```bash
codex mcp list
```

Vous pouvez aussi exécuter `/mcp` dans une session Codex. Consultez le [guide MCP officiel de Codex](https://learn.chatgpt.com/docs/extend/mcp).

ChatGPT web ne lit pas la configuration locale de Codex. Cette procédure s’applique donc uniquement aux interfaces Codex de la machine configurée.

## Gemini CLI

Une fois `RANKMEFAST_API_KEY` défini dans votre shell :

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

Vérifiez la connexion avec `gemini mcp list` ou `/mcp` dans Gemini CLI. La commande enregistre l’en-tête développé dans `~/.gemini/settings.json` ; gardez donc ce fichier privé. En JSON, utilisez `httpUrl` : Gemini réserve `url` à l’ancien protocole SSE. Consultez le [guide MCP officiel de Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

Ajoutez ceci au fichier global `~/.config/opencode/opencode.json` :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rankmefast": {
      "type": "remote",
      "url": "https://rankme.fast/api/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

`oauth: false` empêche la découverte OAuth, car RankMeFast utilise une clé Bearer. Vérifiez la configuration avec :

```bash
opencode mcp list
opencode mcp debug rankmefast
```

Consultez le [guide MCP officiel d’OpenCode](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant et Junie

Ouvrez **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, ajoutez un serveur HTTP, puis collez :

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Conservez cette configuration dans les paramètres de l’IDE plutôt que dans un fichier du projet. Activez **Pass custom MCP servers** lorsque vous souhaitez transmettre les outils à Junie ou à un autre agent intégré. Consultez le [guide MCP officiel de JetBrains](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

Ouvrez **Settings → AI → MCP Servers → Add Remote Server**, ou ajoutez ceci à vos paramètres utilisateur :

```json
{
  "context_servers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Placez la clé en clair dans les paramètres utilisateur, pas dans ceux du projet. Un indicateur vert à côté du serveur confirme la connexion. Consultez le [guide MCP officiel de Zed](https://zed.dev/docs/ai/mcp).

## Cline

Ouvrez les paramètres MCP de Cline et ajoutez un serveur Streamable HTTP :

```json
{
  "mcpServers": {
    "rankmefast": {
      "type": "streamableHttp",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Laissez `autoApprove` vide afin que le lancement d’un audit exige votre approbation. Consultez le [guide MCP officiel de Cline](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

Utilisez les paramètres MCP globaux ou `.roo/mcp.json` :

```json
{
  "mcpServers": {
    "rankmefast": {
      "type": "streamable-http",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

Laissez `alwaysAllow` vide afin que les actions payantes exigent votre approbation. Consultez le [guide MCP officiel de Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE et CLI

Utilisez `~/.kiro/settings/mcp.json` pour une configuration globale ou `.kiro/settings/mcp.json` pour un projet :

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

Kiro développe les variables d’environnement dans les en-têtes. Consultez la [configuration MCP officielle de Kiro](https://kiro.dev/docs/mcp/configuration/).

## Copilot dans les autres IDE

GitHub Copilot dans Visual Studio, les IDE JetBrains, Xcode et Eclipse utilise une structure différente de VS Code :

```json
{
  "servers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "requestInit": {
        "headers": {
          "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
        }
      }
    }
  }
}
```

Enregistrez cette configuration au niveau utilisateur et ne versionnez pas la clé. Suivez le [guide de configuration MCP pour les extensions Copilot dans les IDE](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) pour connaître l’emplacement du fichier de configuration dans votre IDE.

## Outils RankMeFast disponibles

| Outil | Fonction | Consomme le quota du plan ? |
| --- | --- | --- |
| `list_sites` | Répertorie les sites appartenant à votre compte | Non |
| `get_latest_audit_report` | Renvoie le dernier audit terminé d’un site | Non |
| `list_keywords` | Répertorie les mots-clés suivis pour un site | Non |
| `get_rank_history` | Renvoie l’historique de classement d’un mot-clé pour un site | Non |
| `list_content_analyses` | Répertorie les analyses Content Intelligence | Non |
| `get_content_analysis` | Renvoie une analyse Content Intelligence | Non |
| `start_audit` | Lance un audit de site dans la limite de pages du plan | **Oui, un audit** |
| `get_audit_status` | Vérifie l’exécution d’un audit | Non |
| `list_actions` | Liste les actions à venir, par priorité, pour un site | Non |
| `set_action_state` | Marque une action prévue, écartée, terminée ou ouverte | Non |

Tout est limité au compte propriétaire de la clé : un identifiant de site, d’analyse ou d’exécution d’un autre compte renvoie introuvable. S’il vous manque un outil, vérifiez les autorisations avant de soupçonner la connexion.

## Résolution des problèmes

- **Le client ne trouve pas les outils :** vérifiez que l’URL se termine par `/api/mcp`, choisissez Streamable HTTP plutôt que SSE ou stdio, puis redémarrez le client.
- **Un outil attendu manque :** vérifiez son interrupteur dans **Paramètres → MCP** et les portées de la clé dans **Paramètres → Clés API**.
- **Un site est introuvable :** vérifiez que le compte et les portées de la clé l’autorisent. Un site bloqué et un site non détenu utilisent volontairement la même réponse.
- **Les actions payantes sont refusées :** autorisez `start_audit` et les actions payantes aux deux niveaux, ou laissez-les désactivées pour un client en lecture seule.
- **401 Unauthorized :** utilisez exactement l’en-tête `Authorization: Bearer rmf_…`. La clé est peut-être mal saisie, révoquée ou liée à un compte inactif.
- **402 Upgrade required :** MCP nécessite Starter, Pro ou Agency. Consultez [Plans, limites et crédits](./plans-limits-credits.fr.md).
- **405 Method not allowed dans un navigateur :** ce comportement est normal, car l’endpoint accepte les requêtes MCP `POST`, pas les requêtes `GET` ordinaires d’un navigateur.
- **429 Too many requests :** attendez la fin de la fenêtre de limitation indiquée dans les en-têtes de réponse, puis réessayez.
- **503 Unavailable :** MCP est désactivé ou temporairement indisponible sur cette installation RankMeFast ; contactez son opérateur.
- **Fonctionne en local, mais pas derrière un proxy :** vérifiez que le proxy transmet les en-têtes `Authorization`, `Content-Type` et `Accept` à `/api/mcp`.

Pour remplacer une clé, créez-en une nouvelle, mettez à jour et vérifiez chaque client, puis révoquez l’ancienne depuis [Paramètres → Clés API](/profile?tab=api-keys). La révocation est immédiate.

## Compatibilité

Cette version contient les dix outils listés ci-dessus. Huit sont en lecture seule, `set_action_state` écrit sans rien coûter, et `start_audit` est le seul qui consomme un quota du forfait. Le Radar de marque, l’Intelligence des avis, l’Intelligence des liens, l’Analyse du trafic et les Tendances de mots-clés n’ont pas d’outil MCP. Les évolutions sont additives : les noms d’outils et la forme de leurs arguments restent les mêmes, et de nouveaux outils peuvent apparaître au fil des livraisons.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## Guides associés

- [Assistant IA](./ai-assistant.fr.md) : utilisez les mêmes outils autorisés dans le chat RankMeFast.
- [API publique](./public-api.fr.md) : l’API en lecture réservée au plan Agency.
- [Content Intelligence](./content-intelligence.fr.md) : comprenez les données d’analyse renvoyées par MCP.
- [Sécurité du compte](./settings-security.fr.md) : protégez votre compte et vos clés.
