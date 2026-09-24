import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { useTheme, type Theme } from '@shared/theme/ThemeProvider';

/**
 * Light / Dark / System theme switcher. The active preference drives the icon;
 * selecting a mode persists it via ThemeProvider (and the no-flash head script
 * reads the same key on next load).
 */
export interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation('common');

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: t('theme.light', 'Light'), icon: Sun },
    { value: 'dark', label: t('theme.dark', 'Dark'), icon: Moon },
    { value: 'system', label: t('theme.system', 'System'), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(className)}
          aria-label={t('theme.toggle', 'Toggle theme')}
        >
          {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          onValueChange={(value) => setTheme(value as Theme)}
          value={theme}
        >
          {options.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
