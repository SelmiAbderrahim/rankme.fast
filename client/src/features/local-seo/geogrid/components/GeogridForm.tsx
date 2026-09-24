/**
 * Grid definition form.
 *
 * Coordinates are TYPED, not picked from a map — the product ships no map-tile
 * vendor, and the helper copy says so rather than implying a missing picker.
 *
 * data-testid contract:
 *   - geogrid-form                 form root
 *   - geogrid-keyword              keyword picker
 *   - geogrid-lat / geogrid-lng    coordinate inputs
 *   - geogrid-spacing              spacing radio group
 *   - geogrid-size                 grid-size radio group
 *   - geogrid-zoom                 zoom input
 *   - geogrid-preview-submit       preview button
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import type { GeogridKeywordOption } from '../api';
import type { GeogridFieldError } from '../validation';
import {
  GEOGRID_MAX_ABS_CENTER_LAT,
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

interface Props {
  form: GeogridFormState;
  keywords: GeogridKeywordOption[];
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
  form,
  keywords,
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
        <select
          id="geogrid-keyword"
          data-testid="geogrid-keyword"
          className="border-input bg-background h-9 cursor-pointer rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          value={form.keywordId}
          disabled={disabled}
          aria-invalid={has('keywordId') || undefined}
          aria-describedby={has('keywordId') ? 'geogrid-keyword-error' : undefined}
          onChange={(event) => onKeywordChange(event.target.value)}
        >
          <option value="">{t('form.keywordPlaceholder')}</option>
          {keywords.map((keyword) => (
            <option key={keyword.id} value={keyword.id}>
              {keyword.phrase}
            </option>
          ))}
        </select>
        {has('keywordId') ? (
          <p id="geogrid-keyword-error" role="alert" className="text-destructive text-xs">
            {t('form.errors.keyword')}
          </p>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">{t('form.coordinateHelp')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="geogrid-lat">{t('form.latitude')}</Label>
          <Input
            id="geogrid-lat"
            data-testid="geogrid-lat"
            inputMode="decimal"
            type="number"
            step="0.0000001"
            min={-GEOGRID_MAX_ABS_CENTER_LAT}
            max={GEOGRID_MAX_ABS_CENTER_LAT}
            value={form.centerLat}
            disabled={disabled}
            aria-invalid={has('centerLat') || undefined}
            aria-describedby={has('centerLat') ? 'geogrid-lat-error' : undefined}
            onChange={(event) => onCoordinateChange('centerLat', event.target.value)}
          />
          {has('centerLat') ? (
            <p id="geogrid-lat-error" role="alert" className="text-destructive text-xs">
              {t('form.errors.latitude', { max: GEOGRID_MAX_ABS_CENTER_LAT })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="geogrid-lng">{t('form.longitude')}</Label>
          <Input
            id="geogrid-lng"
            data-testid="geogrid-lng"
            inputMode="decimal"
            type="number"
            step="0.0000001"
            min={-180}
            max={180}
            value={form.centerLng}
            disabled={disabled}
            aria-invalid={has('centerLng') || undefined}
            aria-describedby={has('centerLng') ? 'geogrid-lng-error' : undefined}
            onChange={(event) => onCoordinateChange('centerLng', event.target.value)}
          />
          {has('centerLng') ? (
            <p id="geogrid-lng-error" role="alert" className="text-destructive text-xs">
              {t('form.errors.longitude')}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">{t('form.spacing')}</legend>
        <RadioGroup
          data-testid="geogrid-spacing"
          className="flex flex-wrap gap-2"
          value={String(form.spacingMeters)}
          onValueChange={(value) => onSpacingChange(Number(value))}
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
        </RadioGroup>
        <Input
          aria-label={t('form.spacingCustom')}
          data-testid="geogrid-spacing-custom"
          type="number"
          step={GEOGRID_SPACING_STEP_METERS}
          min={GEOGRID_MIN_SPACING_METERS}
          max={GEOGRID_MAX_SPACING_METERS}
          value={form.spacingMeters}
          aria-invalid={has('spacingMeters') || undefined}
          onChange={(event) => onSpacingChange(Number(event.target.value))}
        />
        {has('spacingMeters') ? (
          <p role="alert" className="text-destructive text-xs">
            {t('form.errors.spacing', {
              min: GEOGRID_MIN_SPACING_METERS,
              max: GEOGRID_MAX_SPACING_METERS,
              step: GEOGRID_SPACING_STEP_METERS,
            })}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">{t('form.size')}</legend>
        <RadioGroup
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

      <div className="flex flex-col gap-1.5 sm:max-w-40">
        <Label htmlFor="geogrid-zoom">{t('form.zoom')}</Label>
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
          onChange={(event) => onZoomChange(Number(event.target.value))}
        />
        {has('zoom') ? (
          <p role="alert" className="text-destructive text-xs">
            {t('form.errors.zoom', { min: GEOGRID_MIN_ZOOM, max: GEOGRID_MAX_ZOOM })}
          </p>
        ) : null}
      </div>

      <div>
        <Button
          type="submit"
          data-testid="geogrid-preview-submit"
          loading={previewing}
          loadingLabel={t('form.previewing')}
          disabled={disabled}
        >
          {t('form.preview')}
        </Button>
      </div>
    </form>
  );
};
