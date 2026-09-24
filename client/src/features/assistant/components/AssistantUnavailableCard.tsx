import { CircleOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';

interface AssistantUnavailableCardProps {
  onRetry: () => void;
}

/** Honest feature-flag / outage state for the Assistant surface. */
export function AssistantUnavailableCard({ onRetry }: AssistantUnavailableCardProps) {
  const { t } = useTranslation(['assistant', 'common']);

  return (
    <Card data-testid="assistant-state-unavailable">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
          <CircleOff aria-hidden="true" />
        </div>
        <CardTitle>{t('assistant:states.unavailable.title')}</CardTitle>
        <CardDescription>{t('assistant:states.unavailable.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRetry}>
          {t('common:retry')}
        </Button>
      </CardContent>
    </Card>
  );
}
