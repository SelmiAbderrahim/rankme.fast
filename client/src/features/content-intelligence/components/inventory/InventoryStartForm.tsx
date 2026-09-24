import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearInventorySubmitError } from '../../store/slice';
import { startInventoryThunk } from '../../store/thunks';
import {
  selectInventorySubmitError,
  selectInventorySubmitting,
} from '../../store/selectors';
import {
  INVENTORY_MAX_PAGES,
  INVENTORY_MAX_PATHS,
  INVENTORY_MAX_SEEDS,
  inventoryBlocksForPages,
} from '../../types';

interface InventoryStartFormProps {
  siteId: string;
  /** True when an in-flight run blocks starting a new one. */
  disabled?: boolean | undefined;
  onStarted?: ((runId: string) => void) | undefined;
}

const PATH_RE = /^\/[\w./*-]*$/;

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function makeClientKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `inv-${Date.now().toString(36)}-${rand}`;
}

/**
 * Start a paid inventory run. Page limit drives a LIVE block calc (four pages
 * per reserved block) shown before submit. Allow/exclude paths + sitemap seeds
 * are validated client-side against the same ceilings the server enforces;
 * the server re-validates and owns the reservation.
 */
export function InventoryStartForm({ siteId, disabled, onStarted }: InventoryStartFormProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const submitting = useAppSelector(selectInventorySubmitting);
  const submitError = useAppSelector(selectInventorySubmitError);

  const [pageLimit, setPageLimit] = useState('20');
  const [allowedPaths, setAllowedPaths] = useState('');
  const [excludedPaths, setExcludedPaths] = useState('');
  const [sitemapSeeds, setSitemapSeeds] = useState('');
  const [inlineErrorKey, setInlineErrorKey] = useState<string | null>(null);

  const pageLimitId = useId();
  const allowedId = useId();
  const excludedId = useId();
  const seedsId = useId();

  const pageLimitNum = Number.parseInt(pageLimit, 10);
  const validPageLimit =
    Number.isInteger(pageLimitNum) && pageLimitNum >= 1 && pageLimitNum <= INVENTORY_MAX_PAGES;
  const blocks = useMemo(
    () => (validPageLimit ? inventoryBlocksForPages(pageLimitNum) : 0),
    [validPageLimit, pageLimitNum],
  );

  const onField = useCallback(() => {
    setInlineErrorKey(null);
    if (submitError) dispatch(clearInventorySubmitError());
  }, [dispatch, submitError]);

  const validate = useCallback((): string | null => {
    if (!validPageLimit) return 'inventory.start.errors.pageLimitRange';
    const allowed = parseLines(allowedPaths);
    const excluded = parseLines(excludedPaths);
    const seeds = parseLines(sitemapSeeds);
    if (allowed.length > INVENTORY_MAX_PATHS || excluded.length > INVENTORY_MAX_PATHS) {
      return 'inventory.start.errors.tooManyPaths';
    }
    for (const path of [...allowed, ...excluded]) {
      if (path.length > 256 || !PATH_RE.test(path)) {
        return 'inventory.start.errors.invalidPath';
      }
    }
    if (seeds.length > INVENTORY_MAX_SEEDS) return 'inventory.start.errors.tooManySeeds';
    for (const seed of seeds) {
      if (seed.length > 2_048) return 'inventory.start.errors.invalidSeed';
    }
    return null;
  }, [validPageLimit, allowedPaths, excludedPaths, sitemapSeeds]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || disabled) return;
      const error = validate();
      if (error) {
        setInlineErrorKey(error);
        return;
      }
      const result = await dispatch(
        startInventoryThunk({
          siteId,
          pageLimit: pageLimitNum,
          allowedPaths: parseLines(allowedPaths),
          excludedPaths: parseLines(excludedPaths),
          sitemapSeeds: parseLines(sitemapSeeds),
          locale: i18n.language.split('-')[0]!,
          clientKey: makeClientKey(),
        }),
      );
      if (startInventoryThunk.fulfilled.match(result)) {
        onStarted?.(result.payload.runId);
      }
    },
    [
      allowedPaths,
      disabled,
      dispatch,
      excludedPaths,
      i18n.language,
      onStarted,
      pageLimitNum,
      siteId,
      sitemapSeeds,
      submitting,
      validate,
    ],
  );

  return (
    <Card data-testid="inventory-start-form">
      <CardHeader>
        <CardTitle>{t('inventory.start.title')}</CardTitle>
        <CardDescription>{t('inventory.start.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor={pageLimitId}>{t('inventory.start.pageLimit')}</Label>
            <Input
              id={pageLimitId}
              type="number"
              min={1}
              max={INVENTORY_MAX_PAGES}
              inputMode="numeric"
              value={pageLimit}
              onChange={(e) => {
                setPageLimit(e.target.value);
                onField();
              }}
              data-testid="inventory-form-pagelimit"
            />
            <p className="text-muted-foreground text-xs">
              {t('inventory.start.pageLimitHint', { max: INVENTORY_MAX_PAGES })}
            </p>
          </div>

          <div
            className="border-border rounded-md border p-3"
            data-testid="inventory-form-blocks"
            aria-live="polite"
          >
            <p className="text-sm font-medium">{t('inventory.start.blocksTitle')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {validPageLimit
                ? t('inventory.start.blocks', { blocks, pages: pageLimitNum })
                : t('inventory.start.blocksInvalid')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={allowedId}>{t('inventory.start.allowedPaths')}</Label>
            <Textarea
              id={allowedId}
              rows={2}
              value={allowedPaths}
              placeholder={'/blog\n/guides/*'}
              onChange={(e) => {
                setAllowedPaths(e.target.value);
                onField();
              }}
              data-testid="inventory-form-allowed"
            />
            <p className="text-muted-foreground text-xs">
              {t('inventory.start.pathsHint', { max: INVENTORY_MAX_PATHS })}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={excludedId}>{t('inventory.start.excludedPaths')}</Label>
            <Textarea
              id={excludedId}
              rows={2}
              value={excludedPaths}
              placeholder={'/tag\n/author/*'}
              onChange={(e) => {
                setExcludedPaths(e.target.value);
                onField();
              }}
              data-testid="inventory-form-excluded"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={seedsId}>{t('inventory.start.sitemapSeeds')}</Label>
            <Textarea
              id={seedsId}
              rows={2}
              value={sitemapSeeds}
              placeholder={'https://example.com/sitemap.xml'}
              onChange={(e) => {
                setSitemapSeeds(e.target.value);
                onField();
              }}
              data-testid="inventory-form-seeds"
            />
            <p className="text-muted-foreground text-xs">
              {t('inventory.start.seedsHint', { max: INVENTORY_MAX_SEEDS })}
            </p>
          </div>

          {inlineErrorKey ? (
            <p
              className="text-destructive text-sm"
              role="alert"
              data-testid="inventory-form-inline-error"
            >
              {t(inlineErrorKey)}
            </p>
          ) : null}

          {submitError ? (
            <Alert variant="destructive" data-testid="inventory-form-server-error">
              <AlertTitle>{t('inventory.errors.startFailed')}</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {disabled ? (
            <p className="text-muted-foreground text-xs" data-testid="inventory-form-in-flight">
              {t('inventory.start.inFlight')}
            </p>
          ) : null}

          <div>
            <Button
              type="submit"
              loading={submitting}
              loadingLabel={t('inventory.start.submitting')}
              disabled={disabled || !validPageLimit}
              data-testid="inventory-form-submit"
            >
              {t('inventory.start.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
