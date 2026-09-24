import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Site } from '@features/sites';
import { Label } from '@shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import type { ChatConversation } from '../types';

export const NO_ASSISTANT_SITE = '__no_site__';

interface AssistantSiteSelectorProps {
  sites: Site[];
  activeConversation?: ChatConversation;
  selectedSiteId: string | null;
  loading?: boolean;
  disabled?: boolean;
  sitesUnavailable?: boolean;
  onChange: (siteId: string | null) => void;
}

/** Site linkage is selectable before creation and immutable after the first message. */
export function AssistantSiteSelector({
  sites,
  activeConversation,
  selectedSiteId,
  loading = false,
  disabled = false,
  sitesUnavailable = false,
  onChange,
}: AssistantSiteSelectorProps) {
  const { t } = useTranslation('assistant');
  const linkedSiteId = activeConversation?.siteId ?? null;
  const value = activeConversation ? linkedSiteId : selectedSiteId;
  const linkedSiteMissing = Boolean(
    linkedSiteId && !sites.some((site) => site.id === linkedSiteId),
  );
  const helpKey = activeConversation
    ? 'context.linkedHelp'
    : sitesUnavailable
      ? 'context.unavailable'
      : 'context.newHelp';

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor="assistant-site" className="flex items-center gap-2">
        <Link2 aria-hidden="true" className="size-4" />
        {t('context.label')}
      </Label>
      <Select
        value={value ?? NO_ASSISTANT_SITE}
        disabled={Boolean(activeConversation) || loading || disabled}
        onValueChange={(next) => onChange(next === NO_ASSISTANT_SITE ? null : next)}
      >
        <SelectTrigger
          id="assistant-site"
          className="w-full sm:w-72"
          aria-describedby="assistant-site-help"
        >
          <SelectValue placeholder={t('context.none')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ASSISTANT_SITE}>{t('context.none')}</SelectItem>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.displayName || site.domain}
            </SelectItem>
          ))}
          {linkedSiteMissing && linkedSiteId ? (
            <SelectItem value={linkedSiteId}>{t('context.missing')}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <p id="assistant-site-help" className="text-xs text-muted-foreground">
        {loading ? t('context.loading') : t(helpKey)}
      </p>
    </div>
  );
}
