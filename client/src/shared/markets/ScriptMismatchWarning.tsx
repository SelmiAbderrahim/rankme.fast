import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { isolateText } from '@shared/lib/bidi';
import { languageName } from './format';
import { scriptMismatch } from './keywordScript';

export interface ScriptMismatchWarningProps {
  text: string;
  languageCode: string;
  languages: readonly string[];
  onSwitch: (languageCode: string) => void;
}

export function ScriptMismatchWarning({ text, languageCode, languages, onSwitch }: ScriptMismatchWarningProps) {
  const { t, i18n } = useTranslation('common');
  const mismatch = scriptMismatch(text, languageCode, languages);
  if (!mismatch) return null;
  const name = (code: string) => isolateText(languageName(code, i18n.language) ?? t('market.unknownLanguage'));
  const values = { script: t(`market.script.${mismatch.script}`), language: name(languageCode), suggested: name(mismatch.suggested) };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-warning" role="status" data-testid="script-mismatch-warning">
      <Languages aria-hidden="true" className="size-4 shrink-0" />
      <span>{t(mismatch.offered ? 'market.mismatch.body' : 'market.mismatch.unavailable', values)}</span>
      {mismatch.offered ? <Button type="button" variant="outline" size="sm" onClick={() => onSwitch(mismatch.suggested)} data-testid="script-mismatch-switch">{t('market.mismatch.switch', values)}</Button> : null}
    </div>
  );
}
