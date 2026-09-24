import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { exportMyDataRequest } from '../api';
import { accountErrorMessage } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

/** Serialize + download a JSON blob without leaving the page. */
const downloadJson = (data: unknown, filename: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * Data & privacy — GDPR export. Downloads a JSON copy of the account. Usage is
 * unmetered (auth only), so no capacity gate is involved.
 */
export const ExportData = () => {
  const { t } = useTranslation('account');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const onExport = async () => {
    setErrorMessage('');
    setBusy(true);
    try {
      const data = await exportMyDataRequest();
      downloadJson(data, 'rankmefast-data.json');
      toast.success(t('privacy.export.success'));
    } catch (err) {
      setErrorMessage(accountErrorMessage(err, 'account:privacy.export.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('privacy.export.title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('privacy.export.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorMessage ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          variant="outline"
          className="w-fit"
          loading={busy}
          loadingLabel={t('privacy.export.exporting')}
          onClick={onExport}
        >
          {t('privacy.export.button')}
        </Button>
      </CardContent>
    </Card>
  );
};
