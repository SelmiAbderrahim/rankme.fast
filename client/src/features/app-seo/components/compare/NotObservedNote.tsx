import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';

export function NotObservedNote({
  title,
  description,
  href,
  linkLabel,
}: {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <Link className="font-medium text-foreground underline underline-offset-4" to={href}>
          {linkLabel}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
