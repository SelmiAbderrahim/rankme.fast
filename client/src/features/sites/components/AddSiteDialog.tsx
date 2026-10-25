import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { AddSiteForm } from './AddSiteForm';

export const AddSiteDialog = () => {
  const { t } = useTranslation(['sites', 'common']);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button"><Plus aria-hidden="true" />{t('addSubmit')}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <AddSiteForm variant="dialog" onAdded={() => setOpen(false)} />
        <DialogClose asChild>
          <Button type="button" variant="ghost" className="justify-self-end">{t('common:cancel')}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
};
