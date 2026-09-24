import { useTranslation } from 'react-i18next';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import type { SchemaTypeProjection, SupportedSchemaType } from '../types';

interface TypePickerProps {
  types: SchemaTypeProjection[];
  value: SupportedSchemaType;
  /** Types the inventory says this page already declares. */
  alreadyDeclared: string[];
  onChange: (next: SupportedSchemaType) => void;
}

/**
 * Radio cards built from `GET /types` — the server registry is the authority
 * for which properties are required and which are recommended, so the counts
 * shown here can never drift from the conformance verdict.
 */
export const TypePicker = ({
  types,
  value,
  alreadyDeclared,
  onChange,
}: TypePickerProps) => {
  const { t } = useTranslation('schemaGenerator');
  return (
    <fieldset data-testid="schema-type-picker">
      <legend className="mb-2 text-sm font-medium">{t('type.legend')}</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as SupportedSchemaType)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {types.map((entry) => (
          <div
            key={entry.type}
            className="flex items-start gap-2 rounded-xl border p-3 has-data-[state=checked]:border-primary"
            data-testid={`schema-type-${entry.type}`}
          >
            <RadioGroupItem
              value={entry.type}
              id={`schema-type-option-${entry.type}`}
              className="mt-1"
            />
            <Label
              htmlFor={`schema-type-option-${entry.type}`}
              className="flex flex-col items-start gap-0.5 font-normal"
            >
              <span className="font-medium">{entry.type}</span>
              <span className="text-muted-foreground text-xs">
                {t('type.required', { n: entry.required.length })} ·{' '}
                {t('type.recommended', { n: entry.recommended.length })}
              </span>
              {alreadyDeclared.includes(entry.type) ? (
                <span
                  className="text-muted-foreground text-xs"
                  data-testid={`schema-type-declared-${entry.type}`}
                >
                  {t('type.alreadyDeclared')}
                </span>
              ) : null}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
};
