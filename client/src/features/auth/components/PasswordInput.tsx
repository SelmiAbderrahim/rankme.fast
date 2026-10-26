import { forwardRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@shared/ui/input';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'id'> & { id: string };
/** Visibility ends when focus leaves this input and its toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ id, className, disabled, ...props }, ref) => {
    const { t } = useTranslation('auth');
    const [visible, setVisible] = useState(false);
    return (
      <div
        className="relative min-w-0"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setVisible(false);
        }}
      >
        <Input
          {...props}
          id={id}
          ref={ref}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
          className={cn('pe-12', className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="absolute inset-y-0 end-0 h-full w-11"
          aria-label={t(visible ? 'passwordVisibility.hide' : 'passwordVisibility.show')}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </Button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
