import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DocsLink } from '@shared/docs/DocsLink';
import { absoluteUrl } from '@shared/seo';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';

type CopyTarget = 'endpoint' | 'claude' | 'cursor';

export function buildClaudeCodeConfig(endpoint: string): string {
  const server = JSON.stringify({
    type: 'http',
    url: endpoint,
    headers: { Authorization: 'Bearer ${RANKMEFAST_API_KEY}' },
  });
  return `claude mcp add-json --scope user rankmefast '${server}'`;
}

export function buildCursorConfig(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        rankmefast: {
          url: endpoint,
          headers: {
            Authorization: 'Bearer rmf_REPLACE_WITH_YOUR_KEY',
          },
        },
      },
    },
    null,
    2,
  );
}

/** Copy-ready endpoint and client configuration, derived from the public origin. */
export function McpQuickStart() {
  const { t } = useTranslation('settings');
  const endpoint = absoluteUrl('/api/mcp');
  const snippets: Array<{ target: CopyTarget; label: string; value: string }> = [
    { target: 'claude', label: t('mcp.quickStart.claudeCode'), value: buildClaudeCodeConfig(endpoint) },
    { target: 'cursor', label: t('mcp.quickStart.cursor'), value: buildCursorConfig(endpoint) },
  ];
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState(false);

  const copy = async (target: CopyTarget, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('mcp.quickStart.title')}</h2>
        </CardTitle>
        <CardDescription>{t('mcp.quickStart.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {copyError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('mcp.quickStart.copyError')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('mcp.quickStart.endpoint')}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs">
              {endpoint}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copy('endpoint', endpoint)}
              aria-label={t('mcp.quickStart.copyEndpoint')}
            >
              {copied === 'endpoint' ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied === 'endpoint' ? t('mcp.quickStart.copied') : t('mcp.quickStart.copy')}
            </Button>
          </div>
        </div>

        {snippets.map((snippet) => (
          <section key={snippet.target} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{snippet.label}</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copy(snippet.target, snippet.value)}
                aria-label={t('mcp.quickStart.copyConfig', { client: snippet.label })}
              >
                {copied === snippet.target ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copied === snippet.target ? t('mcp.quickStart.copied') : t('mcp.quickStart.copy')}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs" tabIndex={0}>
              <code>{snippet.value}</code>
            </pre>
          </section>
        ))}

        <div className="flex flex-wrap items-center gap-4">
          <Button asChild variant="outline">
            <Link to="/profile?tab=api-keys">
              <KeyRound data-icon="inline-start" />
              {t('mcp.quickStart.apiKeys')}
            </Link>
          </Button>
          <DocsLink slug="rankmefast-mcp" labelKey="docsLink.openGuide" />
        </div>
      </CardContent>
    </Card>
  );
}
