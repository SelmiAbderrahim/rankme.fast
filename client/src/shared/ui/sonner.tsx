import { useEffect, useState, type CSSProperties } from 'react';
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { toast, Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shared/theme/ThemeProvider';

export const TOAST_DURATION_MS = 4000;
export const TOAST_VISIBLE_LIMIT = 3;
export const TOAST_TOP_OFFSET = '4rem';
/** Above sticky headers and below modal layers. */
export const TOAST_Z_INDEX = 45;
export function measureHeaderClearance(doc: Document = document): number | null {
  let bottom: number | null = null;
  doc.querySelectorAll('header').forEach((header) => {
    const rect = header.getBoundingClientRect();
    if (rect.height > 0 && rect.top < 160 && rect.bottom > 0) bottom = Math.max(bottom ?? 0, rect.bottom);
  });
  return bottom === null ? null : Math.ceil(bottom) + 8;
}
function useToastTopOffset(): string {
  const [offset, setOffset] = useState(TOAST_TOP_OFFSET);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const measured = measureHeaderClearance();
        setOffset(measured === null ? TOAST_TOP_OFFSET : `${measured}px`);
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    const timer = window.setInterval(update, 500);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, { capture: true });
      window.clearInterval(timer);
    };
  }, []);
  return offset;
}
// Preserve errors until dismissed, while allowing an explicit caller duration.
const sonnerError = toast.error;
toast.error = ((message, data) => sonnerError(message, { duration: Infinity, ...data })) as typeof toast.error;
export function closeButtonPlacement(dir: ToasterProps['dir']): Record<string, string> {
  return {
    '--toast-close-button-start': dir === 'rtl' ? '0.5rem' : 'auto',
    '--toast-close-button-end': dir === 'rtl' ? 'auto' : '0.5rem',
    '--toast-close-button-transform': 'translateY(0.5rem)',
  };
}
export const Toaster = ({ toastOptions, style, ...props }: ToasterProps) => {
  const { t } = useTranslation('common');
  const { theme = 'system' } = useTheme();
  const [mounted, setMounted] = useState(false);
  const topOffset = useToastTopOffset();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Sonner theme={theme as ToasterProps['theme']} className="toaster group" duration={TOAST_DURATION_MS} visibleToasts={TOAST_VISIBLE_LIMIT} closeButton containerAriaLabel={t('shell.notifications')}
    toastOptions={{ closeButtonAriaLabel: t('toast.close'), ...toastOptions, style: { paddingInlineEnd: '2.25rem', ...closeButtonPlacement(props.dir), ...toastOptions?.style } as CSSProperties }}
    offset={{ top: topOffset }} mobileOffset={{ top: topOffset }}
    icons={{ success: <CircleCheckIcon className="size-4" />, info: <InfoIcon className="size-4" />, warning: <TriangleAlertIcon className="size-4" />, error: <OctagonXIcon className="size-4" />, loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" /> }}
    style={{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)', '--border-radius': 'var(--radius)', zIndex: TOAST_Z_INDEX, ...style } as CSSProperties}
    {...props} />;
};
