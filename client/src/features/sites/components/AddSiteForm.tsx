import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { buildAddSiteSchema, type AddSiteFormValues } from '../validation';
import { addSite, loadSites } from '../store/thunks';
import { selectAddSiteError, selectAddingSite } from '../store/selectors';

export const AddSiteForm = () => {
  const { t } = useTranslation('sites');
  const dispatch = useAppDispatch();
  const adding = useAppSelector(selectAddingSite);
  const addError = useAppSelector(selectAddSiteError);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AddSiteFormValues>({
    resolver: zodResolver(buildAddSiteSchema(t)),
    defaultValues: { url: '' },
  });

  // The server's rejection ("already added", ...) belongs to the URL that was
  // submitted: show it in the same spot as the format errors and drop it once
  // the user edits the value.
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const urlValue = watch('url');
  const serverError = addError && submittedUrl === urlValue ? addError : '';
  const urlError = errors.url?.message || serverError;

  const onSubmit = handleSubmit(async (values) => {
    setSubmittedUrl(values.url);
    const result = await dispatch(addSite(values.url));
    if (addSite.fulfilled.match(result)) {
      reset();
      await dispatch(loadSites({ direction: 'initial' }));
    }
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('addTitle')}</CardTitle>
        <CardDescription>{t('addDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="site-url">{t('urlLabel')}</Label>
            <Input
              id="site-url"
              type="url"
              inputMode="url"
              placeholder={t('urlPlaceholder')}
              autoComplete="url"
              aria-invalid={!!urlError}
              aria-describedby={urlError ? 'site-url-error' : undefined}
              {...register('url')}
            />
            {urlError ? (
              <p id="site-url-error" role="alert" className="text-destructive text-sm">
                {urlError}
              </p>
            ) : null}
          </div>
          <div>
            <Button type="submit" disabled={adding}>
              {adding ? t('adding') : t('addSubmit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
