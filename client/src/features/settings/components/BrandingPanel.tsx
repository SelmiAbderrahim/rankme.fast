import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageMinus, Palette } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { clearBrandingMessages } from '../store/brandingSlice';
import { loadBranding, saveBranding } from '../store/brandingThunks';
import {
  selectBranding,
  selectBrandingLoadError,
  selectBrandingLoaded,
  selectBrandingLoading,
  selectBrandingSaveError,
  selectBrandingSaved,
  selectBrandingSaving,
} from '../store/brandingSelectors';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const LOGO_MAX_BYTES = 256 * 1024;

/**
 * `/profile?tab=branding` — white-label PDF branding (workstream B).
 * Company name + accent color rendered into every downloaded report PDF.
 * Reads are open; the save is owner-only.
 */
export const BrandingPanel = () => {
  const { t } = useTranslation(['settings', 'common']);
  const dispatch = useAppDispatch();
  const branding = useAppSelector(selectBranding);
  const loading = useAppSelector(selectBrandingLoading);
  const loaded = useAppSelector(selectBrandingLoaded);
  const loadError = useAppSelector(selectBrandingLoadError);
  const saving = useAppSelector(selectBrandingSaving);
  const saveError = useAppSelector(selectBrandingSaveError);
  const saved = useAppSelector(selectBrandingSaved);

  const [companyName, setCompanyName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');
  const [colorError, setColorError] = useState(false);

  useEffect(() => {
    if (!loaded && !loading) {
      void dispatch(loadBranding());
    }
  }, [dispatch, loaded, loading]);

  // Hydrate the form once the stored values arrive.
  useEffect(() => {
    setCompanyName(branding.companyName);
    setAccentColor(branding.accentColor);
    setLogoDataUrl(branding.logoDataUrl);
  }, [branding]);

  const accentValid = accentColor === '' || HEX_COLOR.test(accentColor);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accentValid) {
      setColorError(true);
      return;
    }
    setColorError(false);
    dispatch(clearBrandingMessages());
    void dispatch(saveBranding({
      companyName: companyName.trim(),
      accentColor,
      logoDataUrl,
    }));
  };

  const handleLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.type !== 'image/png') {
      setLogoError(t('settings:branding.logo.invalidType'));
      event.currentTarget.value = '';
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(t('settings:branding.logo.tooLarge'));
      event.currentTarget.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
        setLogoError('');
      }
    });
    reader.addEventListener('error', () => {
      setLogoError(t('settings:branding.logo.readFailed'));
    });
    reader.readAsDataURL(file);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Palette aria-hidden="true" className="size-5" />
            {t('settings:branding.title')}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('settings:branding.description')}
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        {saved ? (
          <Alert role="status">
            <AlertDescription>{t('settings:branding.saved')}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !loaded ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <Skeleton className="h-8 w-full" data-testid="branding-skeleton" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="branding-company-name">
                {t('settings:branding.companyName')}
              </Label>
              <Input
                id="branding-company-name"
                value={companyName}
                maxLength={80}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="branding-accent-color">
                {t('settings:branding.accentColor')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="branding-accent-color"
                  value={accentColor}
                  placeholder="#b5321e"
                  maxLength={7}
                  className="max-w-40"
                  onChange={(event) => setAccentColor(event.target.value)}
                  aria-invalid={colorError || undefined}
                  aria-describedby={colorError ? 'branding-accent-error' : undefined}
                />
                <span
                  aria-hidden="true"
                  data-testid="branding-swatch"
                  className="border-border size-6 shrink-0 rounded-md border"
                  style={
                    HEX_COLOR.test(accentColor)
                      ? // User-picked color — necessarily dynamic, not a theme token.
                        { backgroundColor: accentColor }
                      : undefined
                  }
                />
              </div>
              {colorError ? (
                <p
                  id="branding-accent-error"
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {t('settings:branding.invalidColor')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="branding-logo">{t('settings:branding.logo.label')}</Label>
              <p id="branding-logo-help" className="text-muted-foreground text-sm">
                {t('settings:branding.logo.help')}
              </p>
              <Input
                id="branding-logo"
                type="file"
                accept="image/png"
                onChange={handleLogo}
                aria-describedby={`branding-logo-help${logoError ? ' branding-logo-error' : ''}`}
                aria-invalid={logoError ? true : undefined}
              />
              {logoError ? (
                <p id="branding-logo-error" role="alert" className="text-destructive text-sm">
                  {logoError}
                </p>
              ) : null}
              {logoDataUrl ? (
                <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <img
                    src={logoDataUrl}
                    alt={t('settings:branding.logo.previewAlt')}
                    className="max-h-20 max-w-48 object-contain"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setLogoDataUrl(null);
                      setLogoError('');
                    }}
                  >
                    <ImageMinus aria-hidden="true" />
                    {t('settings:branding.logo.remove')}
                  </Button>
                </div>
              ) : null}
            </div>
            <div>
              <Button type="submit" loading={saving}>
                {t('settings:branding.save')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
};
