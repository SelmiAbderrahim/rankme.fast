import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@shared/lib/utils';

export interface PageHeaderProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /**
   * Page-level headers carry the quiet icon tile. Headers of panels that sit
   * inside an already-iconed workspace (a site tab) omit it and keep every
   * other part of the layout.
   */
  icon?: LucideIcon;
  /**
   * `1` for a page, `2` for a panel inside a page that already owns the h1.
   * Unset, it follows the nearest `PageHeadingLevelProvider` (default `1`).
   */
  headingLevel?: 1 | 2;
  title: ReactNode;
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  titleProps?: Omit<ComponentPropsWithoutRef<'h1'>, 'children' | 'id'>;
  description?: ReactNode;
  descriptionClassName?: string;
  /** The single "Learn more" / guide link, rendered under the description. */
  helpLink?: ReactNode;
  supportingContent?: ReactNode;
  actions?: ReactNode;
}

const PageHeadingLevelContext = createContext<1 | 2>(1);

/**
 * Sets the default heading level of every `PageHeader` and `PageHeading` below
 * it. The site workspace owns the page h1 (the site name) and wraps its tab
 * panel in level `2`, so no tab can render a second h1.
 */
export const PageHeadingLevelProvider = ({
  level,
  children,
}: {
  level: 1 | 2;
  children: ReactNode;
}) => <PageHeadingLevelContext.Provider value={level}>{children}</PageHeadingLevelContext.Provider>;

/**
 * A page title that follows the surrounding heading level: an h1 on its own
 * page, an h2 inside a workspace that already owns the h1.
 */
export const PageHeading = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<'h1'> & { headingLevel?: 1 | 2 }
>(({ headingLevel, ...props }, ref) => {
  const inheritedLevel = useContext(PageHeadingLevelContext);
  const Heading = (headingLevel ?? inheritedLevel) === 1 ? 'h1' : 'h2';
  return <Heading ref={ref} {...props} />;
});
PageHeading.displayName = 'PageHeading';

/**
 * Shared app-page identity: a quiet icon tile, an accessible h1, optional
 * context, and a responsive action slot. The icon is intentionally decorative
 * because the localized heading remains the source of the page name.
 */
export const PageHeader = ({
  icon: Icon,
  headingLevel,
  title,
  titleId,
  titleRef,
  titleProps,
  description,
  descriptionClassName,
  helpLink,
  supportingContent,
  actions,
  className,
  ...headerProps
}: PageHeaderProps) => {
  const { className: titleClassName, ...restTitleProps } = titleProps ?? {};

  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...headerProps}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground"
            data-slot="page-header-icon"
          >
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <PageHeading
            ref={titleRef}
            id={titleId}
            headingLevel={headingLevel}
            className={cn('text-2xl font-semibold tracking-tight', titleClassName)}
            {...restTitleProps}
          >
            {title}
          </PageHeading>
          {description ? (
            <p className={cn('mt-1 text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </p>
          ) : null}
          {helpLink ? (
            <div className="mt-1" data-slot="page-header-help">
              {helpLink}
            </div>
          ) : null}
          {supportingContent ? <div className="mt-2">{supportingContent}</div> : null}
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
};

