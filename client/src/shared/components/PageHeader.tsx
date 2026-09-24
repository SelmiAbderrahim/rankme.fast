import type {
  ComponentPropsWithoutRef,
  ReactNode,
  Ref,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@shared/lib/utils';

export interface PageHeaderProps
  extends Omit<ComponentPropsWithoutRef<'header'>, 'title'> {
  icon: LucideIcon;
  title: ReactNode;
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleProps?: Omit<ComponentPropsWithoutRef<'h1'>, 'children' | 'id'>;
  description?: ReactNode;
  descriptionClassName?: string;
  supportingContent?: ReactNode;
  actions?: ReactNode;
}

/**
 * Shared app-page identity: a quiet icon tile, an accessible h1, optional
 * context, and a responsive action slot. The icon is intentionally decorative
 * because the localized heading remains the source of the page name.
 */
export const PageHeader = ({
  icon: Icon,
  title,
  titleId,
  titleRef,
  titleProps,
  description,
  descriptionClassName,
  supportingContent,
  actions,
  className,
  ...headerProps
}: PageHeaderProps) => {
  const { className: titleClassName, ...restTitleProps } = titleProps ?? {};

  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...headerProps}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground"
          data-slot="page-header-icon"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h1
            ref={titleRef}
            id={titleId}
            className={cn('text-2xl font-semibold tracking-tight', titleClassName)}
            {...restTitleProps}
          >
            {title}
          </h1>
          {description ? (
            <p className={cn('mt-1 text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </p>
          ) : null}
          {supportingContent ? <div className="mt-2">{supportingContent}</div> : null}
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
};

