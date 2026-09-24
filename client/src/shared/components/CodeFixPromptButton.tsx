import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  buildCodeFixPrompt,
  type CodeFixPromptCopy,
  type CodeFixPromptInput,
} from '@shared/lib/codeFixPrompt';
import { writeToClipboard } from '@shared/lib/clipboard';
import { Button } from '@shared/ui/button';

export type { CodeFixPromptInput } from '@shared/lib/codeFixPrompt';

export const CodeFixPromptButton = ({ input }: { input: CodeFixPromptInput }) => {
  const { t } = useTranslation('common');
  const [copying, setCopying] = useState(false);

  const copy: CodeFixPromptCopy = {
    goal: t('codeFixPrompt.prompt.goal'),
    untrustedContext: t('codeFixPrompt.prompt.untrustedContext'),
    inspect: t('codeFixPrompt.prompt.inspect'),
    guardrails: t('codeFixPrompt.prompt.guardrails'),
    abstain: t('codeFixPrompt.prompt.abstain'),
    report: t('codeFixPrompt.prompt.report'),
    siteWideScope: t('codeFixPrompt.prompt.scope.siteWide'),
    targetedScope: t('codeFixPrompt.prompt.scope.targeted'),
  };

  const handleCopy = async () => {
    setCopying(true);
    const copied = await writeToClipboard(buildCodeFixPrompt(input, copy));
    setCopying(false);
    if (copied) {
      toast.success(t('codeFixPrompt.success'));
    } else {
      toast.error(t('codeFixPrompt.error'));
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={copying}
      loadingLabel={t('codeFixPrompt.copying')}
      onClick={() => void handleCopy()}
    >
      <Copy data-icon="inline-start" aria-hidden="true" />
      {t('codeFixPrompt.button')}
    </Button>
  );
};
