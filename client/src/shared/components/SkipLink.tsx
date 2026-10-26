import { useTranslation } from 'react-i18next';

export const SkipLink = ({ targetId }: { targetId: string }) => {
  const { t } = useTranslation('common');
  return (
    <a
      className="sr-only fixed start-4 top-4 z-50 rounded-md bg-primary text-primary-foreground focus:fixed focus:not-sr-only focus:px-4 focus:py-3"
      href={`#${targetId}`}
    >
      {t('nav.skipToContent')}
    </a>
  );
};
