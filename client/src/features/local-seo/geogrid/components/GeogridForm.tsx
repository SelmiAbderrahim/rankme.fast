/**
 * Grid definition form.
 *
 * The centre comes from `GeogridCenterPicker`: the site's stored Local SEO
 * business location, a place search through the existing Local SEO business
 * lookup, or typed coordinates as the advanced option. The product ships no
 * map-tile vendor, so nothing implies a map.
 *
 * data-testid contract:
 *   - geogrid-form                 form root
 *   - geogrid-keyword              keyword picker
 *   - geogrid-keyword-empty        no tracked keyword yet (+ link to track one)
 *   - geogrid-center…              centre picker (see GeogridCenterPicker)
 *   - geogrid-lat / geogrid-lng    coordinate inputs (coordinate mode)
 *   - geogrid-spacing              spacing radio group (presets + custom)
 *   - geogrid-spacing-custom       custom spacing in km (custom option only)
 *   - geogrid-size                 grid-size radio group
 *   - geogrid-zoom                 zoom input
 *   - geogrid-preview-submit       preview button
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { NativeSelect } from '@shared/ui/native-select';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { FieldFeedback, fieldDescribedBy } from '@shared/components/FieldFeedback';
import { FormActions } from '@shared/components/FormActions';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import type { GeogridKeywordOption } from '../api';
import { GeogridCenterPicker, type GeogridCenter } from './GeogridCenterPicker';
import type { GeogridFieldError } from '../validation';
import {
  GEOGRID_DEFAULT_ZOOM,
  GEOGRID_MAX_SPACING_METERS,
  GEOGRID_MAX_ZOOM,
  GEOGRID_MIN_SPACING_METERS,
  GEOGRID_MIN_ZOOM,
  GEOGRID_SIZES,
  GEOGRID_SPACING_PRESETS,
  GEOGRID_SPACING_STEP_METERS,
  type GeogridFormState,
  type GeogridSize,
} from '../types';

const CUSTOM_SPACING = 'custom';

function isSpacingPreset(value: number): boolean {
  return (GEOGRID_SPACING_PRESETS as readonly number[]).includes(value);
}

/** Metres → the km string shown in the custom field (`1500` → `"1.5"`). */
export function metresToKm(value: number): string {
  return String(value / 1000);
}

/**
 * The custom field is typed in km (same unit as the presets); the wire stays
 * integer metres. Blank or non-numeric input maps to 0 so the zod mirror
 * reports the bound instead of silently keeping the previous value.
 */
export function kmToMetres(raw: string): number {
  const value = Number(raw.trim());
  return raw.trim() === '' || !Number.isFinite(value) ? 0 : Math.round(value * 1000);
}

export type { GeogridCenter };

interface Props {
  siteId: string;
  form: GeogridFormState;
  keywords: GeogridKeywordOption[];
  /** `ready` with zero options shows the "track a keyword first" guidance. */
  keywordsStatus: 'loading' | 'ready' | 'error';
  /** Centre of the most recent scan, or null when there is none. */
  lastCenter: GeogridCenter | null;
  onCenterChange: (center: GeogridCenter) => void;
  errors: GeogridFieldError[];
  disabled: boolean;
  previewing: boolean;
  onKeywordChange: (value: string) => void;
  onCoordinateChange: (field: 'centerLat' | 'centerLng', value: string) => void;
  onSpacingChange: (value: number) => void;
  onSizeChange: (value: GeogridSize) => void;
  onZoomChange: (value: number) => void;
  onPreview: () => void;
}

export const GeogridForm = ({
  siteId,
  form,
  keywords,
  keywordsStatus,
  lastCenter,
  onCenterChange,
  errors,
  disabled,
  previewing,
  onKeywordChange,
  onCoordinateChange,
  onSpacingChange,
  onSizeChange,
  onZoomChange,
  onPreview,
}: Props) => {
  const { t } = useTranslation('geogrid');
  const has = (field: GeogridFieldError) => errors.includes(field);
  // "Custom" is a UI mode, not a value: picking it keeps the current spacing
  // and reveals the km field. A non-preset value (e.g. an edited custom one)
  // always shows as custom.
  const [customSpacing, setCustomSpacing] = useState(() => !isSpacingPreset(form.spacingMeters));
  const [customKm, setCustomKm] = useState(() => metresToKm(form.spacingMeters));
  const showCustom = customSpacing || !isSpacingPreset(form.spacingMeters);
  const noKeywords = keywordsStatus === 'ready' && keywords.length === 0;

  return (
    <form
      data-testid="geogrid-form"
      className="flex flex-col gap-4"
      // The zod mirror is the single validation authority: native constraint
      // bubbles are not localized, and interactive validation would swallow
      // the submit before our inline, screen-reader-announced errors render.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onPreview();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="geogrid-keyword">{t('form.keyword')}</Label>
        <NativeSelect
          id="geogrid-keyword"
          data-testid="geogrid-keyword"
          value={form.keywordId}
          disabled={disabled}
          aria-invalid={has('keywordId') || undefined}
          aria-describedby={fieldDescribedBy('geogrid-keyword', { hint: noKeywords, error: has('keywordId') })}
          onChange={(event) => onKeywordChange(event.target.value)}
        >
          <option value="">{t('form.keywordPlaceholder')}</option>
          {keywords.map((keyword) => (
            <option key={keyword.id} value={keyword.id} dir="auto">
              {keyword.phrase}
            </option>
          ))}
        </NativeSelect>
        <FieldFeedback
          id="geogrid-keyword"
          hintTestId="geogrid-keyword-empty"
          hint={
            noKeywords ? (
              <>
                {t('form.keywordEmpty')}{' '}
                <Link
                  to={{ search: '?tab=keywords' }}
                  className="text-foreground font-medium underline underline-offset-4"
                  data-testid="geogrid-keyword-track-link"
                >
                  {t('form.keywordEmptyCta')}
                </Link>
              </>
            ) : null
          }
          error={has('keywordId') ? t('form.errors.keyword') : null}
        />
      </div>

      <GeogridCenterPicker
        siteId={siteId}
        centerLat={form.centerLat}
        centerLng={form.centerLng}
        lastCenter={lastCenter}
        errors={errors}
        disabled={disabled}
        onCenterChange={onCenterChange}
        onCoordinateChange={onCoordinateChange}
      />

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">{t('form.spacing')}</legend>
        <RadioGroup
          name="spacingMeters"
          aria-label={t('form.spacing')}
          data-testid="geogrid-spacing"
          className="flex flex-wrap gap-2"
          value={showCustom ? CUSTOM_SPACING : String(form.spacingMeters)}
          onValueChange={(value) => {
            if (value === CUSTOM_SPACING) {
              setCustomSpacing(true);
              setCustomKm(metresToKm(form.spacingMeters));
              return;
            }
            setCustomSpacing(false);
            onSpacingChange(Number(value));
          }}
        >
          {GEOGRID_SPACING_PRESETS.map((preset) => (
            <Label
              key={preset}
              htmlFor={`geogrid-spacing-${preset}`}
              className="border-border hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <RadioGroupItem id={`geogrid-spacing-${preset}`} value={String(preset)} />
              {t('form.spacingOption', { km: preset / 1000 })}
            </Label>
          ))}
          <Label
            htmlFor="geogrid-spacing-custom-option"
            className="border-border hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <RadioGroupItem id="geogrid-spacing-custom-option" value={CUSTOM_SPACING} />
            {t('form.spacingCustomOption')}
          </Label>
        </RadioGroup>
        {showCustom ? (
          <div className="flex flex-col gap-1.5 sm:max-w-40">
            <Label htmlFor="geogrid-spacing-custom">{t('form.spacingCustom')}</Label>
            <Input
              id="geogrid-spacing-custom"
              data-testid="geogrid-spacing-custom"
              type="number"
              inputMode="decimal"
              step={GEOGRID_SPACING_STEP_METERS / 1000}
              min={GEOGRID_MIN_SPACING_METERS / 1000}
              max={GEOGRID_MAX_SPACING_METERS / 1000}
              value={customKm}
              aria-invalid={has('spacingMeters') || undefined}
              aria-describedby={fieldDescribedBy('geogrid-spacing', { error: has('spacingMeters') })}
              onChange={(event) => {
                setCustomKm(event.target.value);
                onSpacingChange(kmToMetres(event.target.value));
              }}
            />
          </div>
        ) : null}
        <FieldFeedback
          id="geogrid-spacing"
          error={
            has('spacingMeters')
              ? t('form.errors.spacing', {
                  min: GEOGRID_MIN_SPACING_METERS / 1000,
                  max: GEOGRID_MAX_SPACING_METERS / 1000,
                  step: GEOGRID_SPACING_STEP_METERS / 1000,
                })
              : null
          }
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">{t('form.size')}</legend>
        <RadioGroup
          name="gridSize"
          aria-label={t('form.size')}
          data-testid="geogrid-size"
          className="flex flex-wrap gap-2"
          value={String(form.gridSize)}
          onValueChange={(value) => onSizeChange(Number(value) as GeogridSize)}
        >
          {GEOGRID_SIZES.map((size) => (
            <Label
              key={size}
              htmlFor={`geogrid-size-${size}`}
              className="border-border hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <RadioGroupItem id={`geogrid-size-${size}`} value={String(size)} />
              {t('form.sizeOption', { size, cells: size * size })}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="geogrid-zoom">{t('form.zoom')}</Label>
        {/* Only the number field is narrow; its help text spans the form. */}
        <div className="sm:max-w-40">
          <Input
            id="geogrid-zoom"
            data-testid="geogrid-zoom"
            type="number"
            step={1}
            min={GEOGRID_MIN_ZOOM}
            max={GEOGRID_MAX_ZOOM}
            value={form.zoom}
            disabled={disabled}
            aria-invalid={has('zoom') || undefined}
            aria-describedby={fieldDescribedBy('geogrid-zoom', { hint: true, error: has('zoom') })}
            onChange={(event) => onZoomChange(Number(event.target.value))}
          />
        </div>
        <FieldFeedback
          id="geogrid-zoom"
          hint={t('form.zoomHelp', {
            min: GEOGRID_MIN_ZOOM,
            max: GEOGRID_MAX_ZOOM,
            default: GEOGRID_DEFAULT_ZOOM,
          })}
          error={has('zoom') ? t('form.errors.zoom', { min: GEOGRID_MIN_ZOOM, max: GEOGRID_MAX_ZOOM }) : null}
        />
      </div>

      <FormActions>
        <Button
          type="submit"
          data-testid="geogrid-preview-submit"
          loading={previewing}
          loadingLabel={t('form.previewing')}
          disabled={disabled}
        >
          {t('form.preview')}
        </Button>
      </FormActions>
    </form>
  );
};
