import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { CountryCombobox, useMarketCatalog } from '@shared/markets';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearBrandRadarPreview } from '../store/slice';
import {
  selectBrandRadarCreateError,
  selectBrandRadarCreateStatus,
  selectBrandRadarPreview,
  selectBrandRadarPreviewError,
  selectBrandRadarPreviewStatus,
} from '../store/selectors';
import {
  createBrandRadarScanThunk,
  previewBrandRadarScanThunk,
} from '../store/thunks';
import {
  BRAND_RADAR_QUERY_MAX_LENGTH,
  brandRadarScanFormSchema,
  type BrandRadarScanInput,
} from '../types';
import { SpendPreviewCard } from './SpendPreviewCard';

type FieldName = 'brandQuery' | 'language' | 'countryCode';
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELDS: readonly FieldName[] = ['brandQuery', 'language', 'countryCode'];

interface NewScanFormProps {
  /**
   * Owning site, from the workspace route. Deliberately NOT a form field —
   * the workspace already chose the site, so the visible form is unchanged.
   */
  siteId: string;
  /** Server refused the paid path — inputs stay readable, submit refuses. */
  locked: boolean;
  /** Called after a 202 so the host can switch back to the scan list. */
  onSubmitted: () => void;
}

export const NewScanForm = ({ siteId, locked, onSubmitted }: NewScanFormProps) => {
  const { t } = useTranslation('brandRadar');
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectBrandRadarPreview);
  const previewStatus = useAppSelector(selectBrandRadarPreviewStatus);
  const previewError = useAppSelector(selectBrandRadarPreviewError);
  const createStatus = useAppSelector(selectBrandRadarCreateStatus);
  const createError = useAppSelector(selectBrandRadarCreateError);
  const catalog = useMarketCatalog('brand-radar');

  const [brandQuery, setBrandQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  /**
   * Set ONLY by a successful preview, so the confirm button cannot exist
   * before the server accepted the exact input that will be scanned.
   */
  const [confirmed, setConfirmed] = useState<BrandRadarScanInput | null>(null);

  const resetPreview = () => {
    setConfirmed(null);
    dispatch(clearBrandRadarPreview());
  };

  const parse = (): BrandRadarScanInput | null => {
    const candidate = {
      brandQuery,
      ...(language.trim() ? { language } : {}),
      ...(countryCode ? { countryCode } : {}),
    };
    const parsed = brandRadarScanFormSchema.safeParse(candidate);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const next: FieldErrors = {};
    for (const field of FIELDS) {
      const message = fieldErrors[field]?.[0];
      if (message) {
        next[field] = t(message, { max: BRAND_RADAR_QUERY_MAX_LENGTH });
      }
    }
    setErrors(next);
    return null;
  };

  const handlePreview = (event: FormEvent) => {
    event.preventDefault();
    const input = parse();
    if (!input) return;
    void dispatch(previewBrandRadarScanThunk({ siteId, input })).then((action) => {
      if (previewBrandRadarScanThunk.fulfilled.match(action)) {
        setConfirmed(input);
      }
    });
  };

  const handleConfirm = (input: BrandRadarScanInput) => {
    void dispatch(createBrandRadarScanThunk({ siteId, input })).then((action) => {
      if (createBrandRadarScanThunk.fulfilled.match(action)) {
        setConfirmed(null);
        onSubmitted();
      }
    });
  };

  const onFieldChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setErrors({});
    resetPreview();
  };

  return (
    <section className="flex flex-col gap-4" aria-disabled={locked || undefined}>
      <Card>
        <CardHeader>
          <CardTitle>{t('form.title')}</CardTitle>
          <CardDescription>{t('form.description')}</CardDescription>
        </CardHeader>
        <form onSubmit={handlePreview}>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.brandQuery)}>
                <FieldLabel htmlFor="brand-radar-query">
                  {t('form.queryLabel')}
                </FieldLabel>
                <Input
                  id="brand-radar-query"
                  name="brandQuery"
                  value={brandQuery}
                  placeholder={t('form.queryPlaceholder')}
                  disabled={locked}
                  aria-invalid={Boolean(errors.brandQuery)}
                  aria-describedby={
                    errors.brandQuery
                      ? 'brand-radar-query-error'
                      : 'brand-radar-query-help'
                  }
                  onChange={(event) => onFieldChange(setBrandQuery)(event.target.value)}
                />
                <FieldDescription id="brand-radar-query-help">
                  {t('form.queryHelp', { max: BRAND_RADAR_QUERY_MAX_LENGTH })}
                </FieldDescription>
                <FieldError id="brand-radar-query-error">{errors.brandQuery}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.language)}>
                <FieldLabel htmlFor="brand-radar-language">
                  {t('form.languageLabel')}
                </FieldLabel>
                <Input
                  id="brand-radar-language"
                  name="language"
                  value={language}
                  placeholder={t('form.languagePlaceholder')}
                  disabled={locked}
                  aria-invalid={Boolean(errors.language)}
                  aria-describedby={
                    errors.language
                      ? 'brand-radar-language-error'
                      : 'brand-radar-language-help'
                  }
                  onChange={(event) => onFieldChange(setLanguage)(event.target.value)}
                />
                <FieldDescription id="brand-radar-language-help">
                  {t('form.languageHelp')}
                </FieldDescription>
                <FieldError id="brand-radar-language-error">{errors.language}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.countryCode) || catalog.error}>
                <FieldLabel htmlFor="brand-radar-location">
                  {t('form.locationLabel')}
                </FieldLabel>
                <CountryCombobox
                  id="brand-radar-location"
                  value={countryCode}
                  markets={catalog.markets}
                  allowAll
                  loading={catalog.loading}
                  disabled={locked || catalog.error}
                  invalid={Boolean(errors.countryCode) || catalog.error}
                  describedBy={errors.countryCode || catalog.error
                    ? 'brand-radar-location-error'
                    : 'brand-radar-location-help'}
                  onValueChange={(next) => {
                    setCountryCode(next);
                    setErrors({});
                    resetPreview();
                  }}
                />
                <FieldDescription id="brand-radar-location-help">
                  {t('form.locationHelp')}
                </FieldDescription>
                <FieldError id="brand-radar-location-error">
                  {catalog.error ? t('form.locationCatalogError') : errors.countryCode}
                </FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex-col items-start gap-2">
            <Button
              type="submit"
              variant="outline"
              data-testid="brand-radar-preview-submit"
              loading={previewStatus === 'loading'}
              loadingLabel={t('form.previewing')}
              disabled={locked}
            >
              {t('form.preview')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('form.needsPreview')}</p>
          </CardFooter>
        </form>
      </Card>

      {previewError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t('errors.previewTitle')}</AlertTitle>
          <AlertDescription>{previewError}</AlertDescription>
        </Alert>
      ) : null}

      <SpendPreviewCard preview={preview} loading={previewStatus === 'loading'} />

      {confirmed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            data-testid="brand-radar-confirm"
            loading={createStatus === 'loading'}
            loadingLabel={t('form.confirming')}
            onClick={() => handleConfirm(confirmed)}
          >
            {t('form.confirm')}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="brand-radar-cancel"
            disabled={createStatus === 'loading'}
            onClick={resetPreview}
          >
            {t('form.cancel')}
          </Button>
        </div>
      ) : null}

      {createError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{createError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
};
