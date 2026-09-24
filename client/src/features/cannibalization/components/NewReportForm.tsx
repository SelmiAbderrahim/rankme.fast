import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { SpendPreviewCard } from './SpendPreviewCard';
import { StateNotice } from './StateNotice';
import {
  CANNIBALIZATION_WINDOWS,
  type CannibalizationGate,
  type CannibalizationSpendPreview,
  type CannibalizationWindow,
  type RequestStatus,
} from '../types';

interface NewReportFormProps {
  windowDays: CannibalizationWindow;
  onWindowChange: (next: CannibalizationWindow) => void;
  onPreview: () => void;
  onGenerate: () => void;
  preview: CannibalizationSpendPreview | null;
  previewStatus: RequestStatus;
  previewGate: CannibalizationGate | null;
  generateStatus: RequestStatus;
  generateGate: CannibalizationGate | null;
}

/**
 * Window picker → preview → confirm. The confirm button only appears once a
 * preview has disclosed the unit, so a paid action is never one click away
 * from an unlabelled cost.
 */
export const NewReportForm = ({
  windowDays,
  onWindowChange,
  onPreview,
  onGenerate,
  preview,
  previewStatus,
  previewGate,
  generateStatus,
  generateGate,
}: NewReportFormProps) => {
  const { t } = useTranslation('cannibalization');
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('new.title')}</CardTitle>
          <CardDescription>{t('new.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('new.window')}</legend>
            <RadioGroup
              value={String(windowDays)}
              onValueChange={(value) =>
                onWindowChange(Number(value) as CannibalizationWindow)
              }
              className="flex flex-wrap gap-4"
            >
              {CANNIBALIZATION_WINDOWS.map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={String(option)}
                    id={`cannibalization-window-${option}`}
                  />
                  <Label htmlFor={`cannibalization-window-${option}`}>
                    {t('new.windowOption', { days: option })}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPreview}
            loading={previewStatus === 'loading'}
            data-testid="cannibalization-preview-button"
          >
            {t('new.preview')}
          </Button>
          {preview ? (
            <Button
              type="button"
              onClick={onGenerate}
              loading={generateStatus === 'loading'}
              data-testid="cannibalization-generate-button"
            >
              {t('new.generate')}
            </Button>
          ) : null}
        </CardFooter>
      </Card>
      {preview ? <SpendPreviewCard /> : null}
      {previewGate ? (
        <StateNotice kind={previewGate.kind} message={previewGate.message} />
      ) : null}
      {generateGate ? (
        <StateNotice kind={generateGate.kind} message={generateGate.message} />
      ) : null}
    </div>
  );
};
