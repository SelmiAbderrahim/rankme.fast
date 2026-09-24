import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { selectAppSeoRegistration } from '../store/selectors';
import { registerAppProfile } from '../store/thunks';
import { buildAppProfileSchema, type AppProfileFormValues } from '../validation';

export interface AppProfileFormProps {
  siteId: string;
}

export const AppProfileForm = ({ siteId }: AppProfileFormProps) => {
  const { t } = useTranslation('appSeo');
  const dispatch = useAppDispatch();
  const registration = useAppSelector(selectAppSeoRegistration);
  const schema = useMemo(() => buildAppProfileSchema(t), [t]);
  const form = useForm<AppProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { playPackageId: '', appStoreId: '', paired: false },
  });
  const loading = registration.status === 'loading';

  const submit = form.handleSubmit(async (values) => {
    try {
      await dispatch(
        registerAppProfile({
          siteId,
          input: {
            ...(values.playPackageId ? { playPackageId: values.playPackageId.trim() } : {}),
            ...(values.appStoreId ? { appStoreId: values.appStoreId.trim() } : {}),
            paired: values.paired,
          },
        }),
      ).unwrap();
      form.reset();
    } catch {
      // The rejected thunk stores the localized refusal for the alert below.
    }
  });

  return (
    <Card data-testid="app-profile-registration">
      <CardHeader>
        <CardTitle>{t('registration.title')}</CardTitle>
        <CardDescription>{t('registration.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.playPackageId)}>
              <FieldLabel htmlFor="app-seo-play-package">{t('registration.playLabel')}</FieldLabel>
              <Input
                id="app-seo-play-package"
                autoComplete="off"
                placeholder={t('registration.playPlaceholder')}
                aria-invalid={Boolean(form.formState.errors.playPackageId)}
                disabled={loading}
                {...form.register('playPackageId')}
              />
              <FieldDescription>{t('registration.playHelp')}</FieldDescription>
              <FieldError errors={[form.formState.errors.playPackageId]} />
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.appStoreId)}>
              <FieldLabel htmlFor="app-seo-store-id">{t('registration.appleLabel')}</FieldLabel>
              <Input
                id="app-seo-store-id"
                inputMode="numeric"
                autoComplete="off"
                placeholder={t('registration.applePlaceholder')}
                aria-invalid={Boolean(form.formState.errors.appStoreId)}
                disabled={loading}
                {...form.register('appStoreId')}
              />
              <FieldDescription>{t('registration.appleHelp')}</FieldDescription>
              <FieldError errors={[form.formState.errors.appStoreId]} />
            </Field>
            <Controller
              control={form.control}
              name="paired"
              render={({ field, fieldState }) => (
                <Field orientation="horizontal" data-invalid={Boolean(fieldState.error)}>
                  <Checkbox
                    id="app-seo-paired"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    aria-invalid={Boolean(fieldState.error)}
                    disabled={loading}
                  />
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor="app-seo-paired">
                      {t('registration.pairedLabel')}
                    </FieldLabel>
                    <FieldDescription>{t('registration.pairedHelp')}</FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </div>
                </Field>
              )}
            />
          </FieldGroup>

          {registration.status === 'unavailable' || registration.status === 'failed' ? (
            <Alert variant="destructive" data-testid="app-profile-error">
              <AlertTitle>{t('states.errorTitle')}</AlertTitle>
              <AlertDescription>
                {registration.message || t('errors.requestFailed')}
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            loading={loading}
            loadingLabel={t('registration.registering')}
            className="self-start"
          >
            <Plus aria-hidden="true" />
            {t('registration.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
