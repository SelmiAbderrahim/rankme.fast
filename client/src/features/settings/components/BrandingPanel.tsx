import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageMinus, ImageUp, Palette } from 'lucide-react';
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
const DEFAULT_ACCENT = '#b5321e';
const LOGO_MAX_BYTES = 256 * 1024;
/**
 * Accepted logo types. The server checks each file against its declared type,
 * rasterizes SVG, and stores every logo as PNG.
 */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
/** The product name the PDF header shows when no company name is saved. */
const DEFAULT_BRAND_NAME = 'RankMeFast';
/** A printed report page: always white paper and ink, in both themes. */
const PDF_PAGE_COLOR = '#ffffff';
const PDF_INK_COLOR = '#1c1a18';
const PDF_MUTED_COLOR = '#6b6660';

/**
 * How the top of a report PDF will look, drawn from the same three values the
 * renderer reads: the optional logo, the company name (or the product name when
 * blank) and the accent rule, with a sample section heading in the accent.
 * Unsaved edits show immediately. It is a picture of paper, so it keeps paper
 * colors in dark mode too.
 */
const BrandingPreview = ({
  companyName,
  accent,
  logoDataUrl,
}: {
  companyName: string;
  accent: string;
  logoDataUrl: string | null;
}) => {
  const { t } = useTranslation(['settings']);
  const name = companyName.trim() || DEFAULT_BRAND_NAME;
  return (
    <figure className="flex flex-col gap-2" data-testid="branding-preview">
      <figcaption className="text-sm font-medium">{t('settings:branding.preview.title')}</figcaption>
      <div
        className="max-w-md rounded-md border p-4"
        style={{ backgroundColor: PDF_PAGE_COLOR, color: PDF_INK_COLOR }}
        aria-hidden="true"
      >
        <div className="flex min-w-0 items-center gap-3">
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="" className="max-h-10 max-w-24 shrink-0 object-contain" data-testid="branding-preview-logo" />
          ) : null}
          <span className="min-w-0 truncate text-xl font-bold" data-testid="branding-preview-name" dir="auto">
            {name}
          </span>
        </div>
        <div
          className="mt-2 h-[3px] w-full"
          style={{ backgroundColor: accent }}
          data-testid="branding-preview-rule"
        />
        <p className="mt-3 text-sm font-semibold">{t('settings:branding.preview.reportTitle')}</p>
        <p className="mt-2 text-sm font-semibold" style={{ color: accent }} data-testid="branding-preview-heading">
          {t('settings:branding.preview.sectionHeading')}
        </p>
        <p className="mt-1 text-xs" style={{ color: PDF_MUTED_COLOR }}>
          {t('settings:branding.preview.caption')}
        </p>
      </div>
    </figure>
  );
};

/**
 * Workspace PDF branding settings.
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
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [colorError, setColorError] = useState(false);
  const [nameError, setNameError] = useState(false);

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
  const pickerColor = HEX_COLOR.test(accentColor) ? accentColor : DEFAULT_ACCENT;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Both problems are shown together, so one submit explains everything.
    const nameMissing = companyName.trim() === '';
    setNameError(nameMissing);
    setColorError(!accentValid);
    if (nameMissing || !accentValid) return;
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
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
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
        setLogoFileName(file.name);
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
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? 'branding-name-error' : undefined}
                onChange={(event) => {
                  setCompanyName(event.target.value);
                  if (event.target.value.trim() !== '') setNameError(false);
                }}
              />
              {nameError ? (
                <p id="branding-name-error" role="alert" className="text-destructive text-sm">
                  {t('settings:branding.companyNameRequired')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="branding-accent-color">
                {t('settings:branding.accentColor')}
              </Label>
              <div className="flex items-center gap-2">
                <input type="color" data-testid="branding-swatch"
                  aria-label={t('settings:branding.accentPicker')}
                  value={pickerColor}
                  onChange={(event) => { setAccentColor(event.target.value); setColorError(false); }}
                  className="border-input size-9 shrink-0 cursor-pointer rounded-md border p-1 max-md:size-11"
                  style={{ backgroundColor: pickerColor }} />
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
              {/* The raw file input stays in the DOM for the label and the
                  picker dialog, visually hidden behind a styled Button. */}
              <input
                ref={logoInputRef}
                id="branding-logo"
                type="file"
                accept={LOGO_TYPES.join(',')}
                tabIndex={-1}
                className="sr-only"
                onChange={handleLogo}
                aria-describedby={`branding-logo-help${logoError ? ' branding-logo-error' : ''}`}
                aria-invalid={logoError ? true : undefined}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  aria-describedby="branding-logo-help branding-logo-file"
                >
                  <ImageUp aria-hidden="true" />
                  {t('settings:branding.logo.choose')}
                </Button>
                <span
                  id="branding-logo-file"
                  data-testid="branding-logo-file"
                  className="text-muted-foreground min-w-0 truncate text-sm"
                >
                  {logoFileName ??
                    (logoDataUrl
                      ? t('settings:branding.logo.saved')
                      : t('settings:branding.logo.noFile'))}
                </span>
              </div>
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
                      setLogoFileName(null);
                      setLogoError('');
                      // Always mounted alongside this button.
                      logoInputRef.current!.value = '';
                    }}
                  >
                    <ImageMinus aria-hidden="true" />
                    {t('settings:branding.logo.remove')}
                  </Button>
                </div>
              ) : null}
            </div>
            <BrandingPreview
              companyName={companyName}
              accent={accentValid ? pickerColor : DEFAULT_ACCENT}
              logoDataUrl={logoDataUrl}
            />
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
