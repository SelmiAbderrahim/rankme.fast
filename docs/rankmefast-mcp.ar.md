---
title: 'RankMeFast MCP'
description: 'اربط RankMeFast بوكلاء البرمجة وبيئات التطوير المتكاملة وأدوات سطر الأوامر الجاهزة لـ MCP.'
locale: ar
slug: rankmefast-mcp
section: developers
order: 2
---

# اربط RankMeFast بأدوات الذكاء الاصطناعي لديك

يوفّر RankMeFast نقطة نهاية بعيدة لبروتوكول [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). وهي تتيح لوكيل برمجة أو بيئة تطوير متكاملة أو أداة سطر أوامر متوافقة قراءة بيانات SEO وبدء عمليات التدقيق من دون مغادرة سير عملك الحالي.

## الإعداد خلال خمس دقائق

1. افتح [الإعدادات ← مفاتيح API](/profile?tab=api-keys)، واختر **إنشاء مفتاح**، ثم انسخ المفتاح عند ظهوره. يعرض RankMeFast المفتاح الكامل مرة واحدة فقط.
2. استخدم نقطة نهاية MCP الخاصة بـ RankMeFast:

   ```text
   https://rankme.fast/api/mcp
   ```

3. في العملاء الذين يدعمون متغيرات البيئة، عيّن المفتاح قبل تشغيل العميل:

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   في PowerShell:

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. اختر عميلك أدناه، والصق تهيئته، ثم أعد تشغيل العميل أو تحميله.
5. تحقّق من الاتصال باستخدام: **«استخدم RankMeFast لعرض مواقعي.»**

> تعامل مع المفتاح كما تتعامل مع كلمة المرور: احفظه في متغير بيئة أو مطالبة بكلمة مرور أو تهيئة على مستوى المستخدم، ولا ترفعه إلى أي مستودع. يمكنك تضييق نطاقات كل مفتاح (انظر أدناه). وتذكّر أن `start_audit` تستهلك حصتك الشهرية من عمليات التدقيق.

يتوفر الوصول إلى MCP ضمن خطط Starter وPro وAgency. كما تعمل مفاتيح Agency مع واجهة REST API العامة للقراءة فقط.

## التحكم في الصلاحيات ونطاقات المفاتيح

افتح [الإعدادات ← MCP](/profile?tab=mcp) لإدارة إعدادات الحساب الافتراضية المشتركة بين MCP ومساعد الذكاء الاصطناعي في الجلسة المسجّلة:

1. شغّل كل أداة من أدوات RankMeFast أو أوقفها.
2. اترك **المواقع المسموح بها** على جميع المواقع، أو اختر المواقع التي تستطيع الأدوات استخدامها.
3. أوقف **السماح بإجراءات الإنفاق** إذا كان يجب ألا تعمل `start_audit` مطلقًا.
4. احفظ الإعدادات. تعرض بطاقة البدء السريع في التبويب نفسه نقطة النهاية واختصار مفاتيح API وتهيئة عميل قابلة للنسخ.

تكون إعدادات الحساب الافتراضية متساهلة بالكامل إلى أن تغيّرها، لذلك تستمر المفاتيح الحالية في العمل. يستخدم المساعد هذه الإعدادات مباشرة لأنه يعمل عبر جلستك المسجّلة.

يمكنك إضافة نطاقات أضيق عند إنشاء مفتاح ضمن [الإعدادات ← مفاتيح API](/profile?tab=api-keys)، أو تعديل مفتاح حالي لاحقًا. لا تستطيع نطاقات المفتاح إلا تضييق الوصول. يكون وصول MCP الفعلي دائمًا هو التقاطع:

- لا تتوفر الأداة إلا إذا سمح بها الحساب والمفتاح معًا.
- عندما يحدد الحساب والمفتاح مواقع، لا تتوفر إلا المواقع الموجودة في القائمتين.
- تتطلب `start_audit` السماح بالأداة وبإجراءات الإنفاق في المستويين.

النطاق غير المقيّد يتبع إعداد الحساب الافتراضي فقط. لا تظهر الأدوات غير المسموح بها في العميل، ويعيد الموقع المحظور نتيجة «غير موجود» نفسها التي يعيدها موقع لا تملكه.

## اللغة وعقد JSON-RPC

بالنسبة إلى `tools/list` وأي استدعاء بلا وسيط `locale`، يختار MCP اللغة من `x-lang` ثم `Accept-Language`، وإلا فيستخدم `en`. تتحول الوسوم الإقليمية مثل `fr-CA` إلى `fr`. تتجاهل نقطة نهاية bearer ملفات تعريف ارتباط المتصفح ولغة الحساب وتفضيلات مساحة العمل.

تقبل كل أداة أيضًا وسيط `locale` اختياريًا، ويجب أن تكون قيمته إحدى القيم `en` أو `ar` أو `fr` أو `de` أو `es` أو `ru` أو `zh` حرفيًا. يتجاوز هذا الوسيط الرؤوس في ذلك الاستدعاء: نصوص الخطأ والنجاح، وحقل `locale` في النتيجة المنظمة، ورأس HTTP‏ `Content-Language`. تُرفض أي قيمة أخرى كمعاملات غير صالحة (`-32602`) بلغة الرؤوس، وعلى خلاف الرؤوس لا تُحوَّل من وسم إقليمي. تضيف الاستجابات `x-lang, Accept-Language` إلى `Vary` مع الإبقاء على القيم الموجودة.

لا يُترجم إلا أوصاف الأدوات وملخصات النتائج المقروءة ورسائل الأخطاء الآمنة. أما البيانات الآلية فهي نفسها بكل اللغات: أسماء الأدوات ومخططاتها، وحقول JSON-RPC‏ `jsonrpc` و`code` و`id`، وأسماء الخصائص، وقيم التعداد والحالة، والقيم المنطقية، والأعداد، والمعرّفات، والنطاقات، وعناوين URL، والكلمات المفتاحية، والطوابع الزمنية، والمؤشرات، والأدلة، ونص المستخدم أو المزود المخزن. تكتسب النتائج المنظمة حقل `locale` ولا تفقد شيئًا.

تحتفظ أخطاء البروتوكول برموزها الرقمية: `-32700` لخطأ التحليل و`-32600` للطلب غير الصالح و`-32601` للطريقة غير المعروفة و`-32602` للمعاملات أو الأداة غير الصالحة و`-32603` للخطأ الداخلي. تُترجم الرسالة بحسب الرمز، ولا تُعاد أبدًا تشخيصات SDK أو التحقق أو المزود الخام. لا يعيد MCP ملفات CSV، ويشرح [دليل API العامة](./public-api.ar.md) صيغة CSV الثابتة على مستوى البايت.

## اختر عميلك

| العميل أو الواجهة | إعداد مباشر | التهيئة |
| --- | --- | --- |
| Claude Code وتبويب Code في تطبيق سطح المكتب | نعم | خادم HTTP مع ترويسة Bearer |
| Cursor IDE وCursor Agent CLI | نعم | ملف MCP JSON للمستخدم أو المشروع |
| VS Code مع GitHub Copilot | نعم | ملف `mcp.json` للمستخدم أو مساحة العمل |
| GitHub Copilot CLI | نعم | أمر CLI أو ملف JSON للمستخدم |
| Windsurf / Cascade | نعم | ملف MCP JSON للمستخدم |
| Codex CLI وإضافة IDE وCodex في تطبيق ChatGPT لسطح المكتب | نعم | ملف TOML مشترك لـ Codex |
| Gemini CLI | نعم | أمر CLI أو ملف JSON للمستخدم |
| OpenCode | نعم | ملف MCP JSON بعيد |
| JetBrains AI Assistant وJunie | نعم | إعدادات MCP في بيئة التطوير |
| Zed | نعم | خادم سياق بعيد |
| Cline | نعم | خادم Streamable HTTP |
| Roo Code | نعم | خادم Streamable HTTP |
| Kiro IDE وCLI | نعم | ملف MCP JSON للمستخدم أو المشروع |
| Copilot في Visual Studio وJetBrains وXcode وEclipse | نعم | ملف Copilot MCP JSON |
| موصّل المحادثة في Claude.ai / Claude Desktop | ليس مباشرة | يتطلب الموصّل OAuth؛ يستخدم RankMeFast حاليًا مفاتيح Bearer |
| ChatGPT على الويب | ليس مباشرة | لا يقرأ تهيئة Codex MCP المحلية |

يمكن لأي عميل آخر الاتصال إذا كان يدعم **Streamable HTTP** البعيد وترويسة `Authorization` مخصصة. لا يوفّر RankMeFast خادم stdio محليًا ولا خادم SSE قديمًا.

## Claude Code

أضف خادمًا على مستوى المستخدم. تحافظ علامتا الاقتباس المفردتان على مرجع متغير البيئة من دون توسيعه:

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

تحقّق من الاتصال باستخدام:

```bash
claude mcp get rankmefast
```

يمكنك أيضًا تشغيل `/mcp` داخل Claude Code. تستخدم واجهة Claude Code في تطبيق سطح المكتب التهيئة نفسها. راجع [دليل MCP الرسمي لـ Claude Code](https://code.claude.com/docs/en/mcp).

يختلف **موصّل المحادثة** في Claude.ai وClaude Desktop: يصف مسار الموصّلات البعيدة فيه OAuth، ولا يدعم ترويسة Bearer ثابتة اعتباطية. لذلك لا يمكنه الاتصال مباشرة إلى أن يوفّر RankMeFast دعم OAuth؛ استخدم Claude Code بدلًا منه. راجع [موصّلات Claude المخصصة](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE وCursor Agent CLI

أنشئ `~/.cursor/mcp.json` للإعداد على مستوى المستخدم. استبدل القيمتين النائبتين وحافظ على خصوصية الملف:

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

يقرأ Cursor IDE وCursor Agent CLI التهيئة نفسها. تحقّق منها باستخدام:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

لتهيئة الفريق، استخدم `.cursor/mcp.json`، لكن لا تضع مفتاحًا حرفيًا في ملف سيُرفع إلى المستودع. راجع [دليل MCP الرسمي لـ Cursor](https://docs.cursor.com/context/model-context-protocol).

## VS Code وGitHub Copilot

شغّل **MCP: Open User Configuration** من لوحة الأوامر، ثم استخدم إدخال كلمة مرور حتى لا يُكتب السر في الملف:

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

شغّل **MCP: List Servers** لبدء الخادم أو فحصه. يمكن حفظ تهيئة مساحة العمل في `.vscode/mcp.json`، ويمكن مشاركة نموذج إدخال كلمة المرور بأمان. راجع [مرجع تهيئة MCP الرسمي لـ VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

بعد تعيين `RANKMEFAST_API_KEY` في الصدفة:

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

توسّع الصدفة قيمة المفتاح قبل أن يحفظ Copilot تهيئة المستخدم، لذا احمِ الملف `~/.copilot/mcp-config.json`. راجع [إضافة خوادم MCP إلى Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

أضف ما يلي إلى `~/.codeium/windsurf/mcp_config.json`:

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

أعد تحميله من **Windsurf Settings → Cascade → MCP Servers**. راجع [دليل MCP الرسمي لـ Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI وإضافة IDE وChatGPT لسطح المكتب

يشترك Codex CLI وإضافة Codex لبيئات التطوير وواجهة Codex في تطبيق ChatGPT لسطح المكتب في الملف `~/.codex/config.toml` على الجهاز نفسه:

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

أعد تشغيل بيئة التطوير أو تطبيق سطح المكتب بعد تعيين متغير البيئة. تحقّق منه في CLI باستخدام:

```bash
codex mcp list
```

يمكنك أيضًا تشغيل `/mcp` داخل جلسة Codex. راجع [دليل MCP الرسمي لـ Codex](https://learn.chatgpt.com/docs/extend/mcp).

لا يقرأ ChatGPT على الويب تهيئة Codex المحلية، لذا ينطبق هذا الإعداد فقط على واجهات Codex في الجهاز الذي هيّأته.

## Gemini CLI

بعد تعيين `RANKMEFAST_API_KEY` في الصدفة:

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

تحقّق منه باستخدام `gemini mcp list` أو `/mcp` داخل Gemini CLI. يحفظ الأمر الترويسة بعد توسيعها في `~/.gemini/settings.json`، لذا حافظ على خصوصية هذا الملف. استخدم `httpUrl` في JSON؛ إذ يخصص Gemini الحقل `url` لبروتوكول SSE القديم. راجع [دليل MCP الرسمي لـ Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

أضف ما يلي إلى الملف العام `~/.config/opencode/opencode.json`:

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

تمنع `oauth: false` اكتشاف OAuth لأن RankMeFast يستخدم مفتاح Bearer. تحقّق من الإعداد باستخدام:

```bash
opencode mcp list
opencode mcp debug rankmefast
```

راجع [دليل MCP الرسمي لـ OpenCode](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant وJunie

افتح **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**، وأضف خادم HTTP، ثم الصق:

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

احفظ هذا في إعدادات بيئة التطوير بدلًا من ملف المشروع. فعّل **Pass custom MCP servers** عندما تريد إتاحة الأدوات لـ Junie أو لوكيل مدمج آخر. راجع [دليل MCP الرسمي لـ JetBrains](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

افتح **Settings → AI → MCP Servers → Add Remote Server**، أو أضف ما يلي إلى إعدادات المستخدم:

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

ضع المفتاح الحرفي في إعدادات المستخدم، لا في إعدادات المشروع. يؤكد المؤشر الأخضر بجانب الخادم نجاح الاتصال. راجع [دليل MCP الرسمي لـ Zed](https://zed.dev/docs/ai/mcp).

## Cline

افتح إعدادات MCP في Cline وأضف خادم Streamable HTTP:

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

اترك `autoApprove` فارغًا حتى يتطلب بدء التدقيق موافقتك. راجع [دليل MCP الرسمي لـ Cline](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

استخدم إعدادات MCP العامة أو `.roo/mcp.json`:

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

اترك `alwaysAllow` فارغًا حتى تتطلب الإجراءات التي تستهلك الرصيد موافقتك. راجع [دليل MCP الرسمي لـ Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE وCLI

استخدم `~/.kiro/settings/mcp.json` للإعداد العام أو `.kiro/settings/mcp.json` للمشروع:

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

يوسّع Kiro متغيرات البيئة في الترويسات. راجع [تهيئة MCP الرسمية لـ Kiro](https://kiro.dev/docs/mcp/configuration/).

## Copilot في بيئات التطوير الأخرى

يستخدم GitHub Copilot في Visual Studio وبيئات JetBrains وXcode وEclipse بنية مختلفة عن VS Code:

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

احفظها كتهيئة على مستوى المستخدم ولا ترفع المفتاح إلى المستودع. اتبع [دليل إعداد MCP لإضافات Copilot في بيئات التطوير](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) لمعرفة موقع ملف التهيئة في بيئتك.

## أدوات RankMeFast المتاحة

| الأداة | وظيفتها | هل تستهلك حصة الخطة؟ |
| --- | --- | --- |
| `list_sites` | تعرض المواقع التي يملكها حسابك | لا |
| `get_latest_audit_report` | تُرجع أحدث تدقيق مكتمل لموقع | لا |
| `list_keywords` | تعرض الكلمات المفتاحية المتتبعة لموقع | لا |
| `get_rank_history` | تُرجع سجل ترتيب كلمة مفتاحية لموقع | لا |
| `list_content_analyses` | تعرض تحليلات Content Intelligence | لا |
| `get_content_analysis` | تُرجع تحليل Content Intelligence واحدًا | لا |
| `start_audit` | تبدأ تدقيقًا للموقع ضمن حد صفحات خطتك | **نعم, عملية تدقيق واحدة** |
| `get_audit_status` | تتحقق من حالة تشغيل التدقيق | لا |
| `list_actions` | تعرض الإجراءات التالية المرتبة للموقع | لا |
| `set_action_state` | تضع الإجراء كمخطط أو مُستبعد أو مكتمل أو مفتوح | لا |

كل شيء مقصور على الحساب الذي يملك المفتاح، لذا يعيد معرّف موقع أو تحليل أو تشغيل من حساب آخر نتيجة «غير موجود». إذا غابت أداة تتوقعها، فراجع الصلاحيات قبل فحص الاتصال.

## استكشاف الأخطاء وإصلاحها

- **يتعذر على العميل اكتشاف الأدوات:** تأكد من أن عنوان URL ينتهي بـ `/api/mcp`، واختر Streamable HTTP بدلًا من SSE أو stdio، ثم أعد تشغيل العميل.
- **أداة متوقعة غير ظاهرة:** تحقق من مفتاح الحساب ضمن **الإعدادات ← MCP** ومن نطاقات ذلك المفتاح ضمن **الإعدادات ← مفاتيح API**.
- **يظهر الموقع على أنه غير موجود:** تأكد من أن إعدادات الحساب ونطاقات المفتاح يسمحان به. تستخدم المواقع المحظورة وغير المملوكة الاستجابة نفسها عمدًا.
- **الإنفاق غير مسموح:** اسمح بـ `start_audit` وإجراءات الإنفاق في المستويين، أو اتركها معطلة لعميل قراءة فقط.
- **401 Unauthorized:** استخدم الترويسة `Authorization: Bearer rmf_…` كما هي. قد يكون المفتاح مكتوبًا خطأ أو مُبطلاً أو مرتبطًا بحساب غير نشط.
- **402 Upgrade required:** يتطلب MCP خطة Starter أو Pro أو Agency. راجع [الخطط والحدود والرصيد](./plans-limits-credits.ar.md).
- **405 Method not allowed في المتصفح:** هذا متوقع لأن نقطة النهاية تقبل طلبات MCP من نوع `POST`، لا طلبات `GET` العادية من المتصفح.
- **429 Too many requests:** انتظر مدة حد المعدل الموضحة في ترويسات الاستجابة، ثم أعد المحاولة.
- **503 Unavailable:** تم تعطيل MCP أو أنه غير متاح مؤقتًا في نسخة RankMeFast هذه؛ تواصل مع مشغّلها.
- **يعمل محليًا لا عبر وكيل:** تأكد من أن الوكيل يمرر ترويسات `Authorization` و`Content-Type` و`Accept` إلى `/api/mcp`.

لاستبدال مفتاح، أنشئ مفتاحًا جديدًا، وحدّثه وتحقق منه في كل عميل، ثم أبطل المفتاح القديم من [الإعدادات ← مفاتيح API](/profile?tab=api-keys). يسري الإبطال فورًا.

## التوافق

يضم هذا الإصدار الأدوات العشر المذكورة أعلاه. ثماني أدوات للقراءة فقط، و`set_action_state` تكتب دون أي تكلفة، و`start_audit` هي الوحيدة التي تستهلك حصة من الخطة. لا تملك ميزات رادار العلامة التجارية أو ذكاء المراجعات أو ذكاء الروابط أو تحليلات الزيارات أو اتجاهات الكلمات المفتاحية أدوات MCP. التغييرات إضافية فقط: تبقى أسماء الأدوات الحالية وأشكال معاملاتها كما هي، وقد تظهر أدوات جديدة مع إطلاق الميزات.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## أدلة ذات صلة

- [مساعد الذكاء الاصطناعي](./ai-assistant.ar.md): استخدم الأدوات المسموح بها نفسها داخل محادثة RankMeFast.
- [واجهة API العامة](./public-api.ar.md): واجهة القراءة المتاحة لخطة Agency فقط.
- [ذكاء المحتوى](./content-intelligence.ar.md): تعرّف على بيانات التحليل التي يعيدها MCP.
- [أمان الحساب](./settings-security.ar.md): حافظ على أمان حسابك ومفاتيحك.
