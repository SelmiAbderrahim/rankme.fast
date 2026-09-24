import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
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
    formState: { errors },
  } = useForm<AddSiteFormValues>({
    resolver: zodResolver(buildAddSiteSchema(t)),
    defaultValues: { url: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
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
          {addError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{addError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="site-url">{t('urlLabel')}</Label>
            <Input
              id="site-url"
              type="url"
              inputMode="url"
              placeholder={t('urlPlaceholder')}
              autoComplete="url"
              aria-invalid={!!errors.url}
              aria-describedby={errors.url ? 'site-url-error' : undefined}
              {...register('url')}
            />
            {errors.url ? (
              <p id="site-url-error" role="alert" className="text-destructive text-sm">
                {errors.url.message}
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
