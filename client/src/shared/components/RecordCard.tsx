import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@shared/lib/utils';
import { Bdi } from '@shared/components/Bdi';

export interface RecordCardListProps extends ComponentProps<'ul'> {
  hideAt?: 'md' | '4xl';
}
/** Render beside a desktop table; container breakpoints keep wide tables usable. */
export const RecordCardList = ({ className, hideAt = 'md', ...props }: RecordCardListProps) => (
  <ul
    data-slot="record-card-list"
    className={cn(
      'flex min-w-0 flex-col gap-3',
      hideAt === '4xl' ? '@4xl:hidden' : 'md:hidden',
      className,
    )}
    {...props}
  />
);
export interface RecordCardField {
  label: ReactNode;
  value: ReactNode;
  stacked?: boolean;
}
export interface RecordCardProps extends Omit<ComponentProps<'li'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  badges?: ReactNode;
  fields?: ReadonlyArray<RecordCardField | null | false>;
}
export const RecordCard = ({
  title,
  description,
  leading,
  actions,
  badges,
  fields = [],
  children,
  className,
  ...props
}: RecordCardProps) => {
  const shown = fields.filter((field): field is RecordCardField => Boolean(field));
  return (
    <li
      data-slot="record-card"
      className={cn(
        'bg-card text-card-foreground flex min-w-0 flex-col gap-3 rounded-xl border p-4',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading ? <div className="flex shrink-0 items-center pt-0.5">{leading}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="min-w-0 font-medium break-words">
            <Bdi className="block text-balance">{title}</Bdi>
          </div>
          {description ? (
            <div className="text-muted-foreground min-w-0 text-sm break-words">
              <Bdi className="block">{description}</Bdi>
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
      {shown.length ? (
        <dl className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {shown.map((field, index) => (
            <Fragment key={index}>
              <dt className={field.stacked ? 'col-span-2' : undefined}>
                <Bdi>{field.label}</Bdi>
              </dt>
              <dd
                className={cn(
                  'text-foreground min-w-0 break-words',
                  field.stacked && 'col-span-2 mb-1',
                )}
              >
                {field.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {children}
    </li>
  );
};
