import { Button, TextField } from '@bcgov/design-system-react-components';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  GripVerticalIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/common/icons';
import { cn } from '@/lib/utils';

export interface Attribute {
  id: string;
  name: string;
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface AttributesStepProps {
  attributes: Attribute[];
  onChange: (attributes: Attribute[]) => void;
}

export function AttributesStep({
  attributes,
  onChange: setAttributes,
}: AttributesStepProps) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const [nextId, setNextId] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const addAttribute = () => {
    setAttributes([...attributes, { id: `${idPrefix}-${nextId}`, name: '' }]);
    setNextId(nextId + 1);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    setAttributes(move(attributes, index, target));
  };

  return (
    <section className="flex flex-col gap-4 px-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-h5 font-bold">
          {t('credentialDefinitions.attributes.title')}
        </h2>
        <Button variant="secondary" onPress={addAttribute}>
          <PlusIcon className="size-5" />
          {t('credentialDefinitions.attributes.add')}
        </Button>
      </div>
      <p className="text-small-body text-(--typography-color-secondary)">
        {t('credentialDefinitions.attributes.subtitle')}
      </p>
      {attributes.length === 0 ? (
        <p className="text-small-body text-(--typography-color-secondary)">
          {t('credentialDefinitions.attributes.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attributes.map((attribute, index) => (
            <li
              key={attribute.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) {
                  setAttributes(move(attributes, dragIndex, index));
                }
                endDrag();
              }}
              onDragEnd={endDrag}
              className={cn(
                'flex items-center gap-2 rounded-lg border p-3 transition-colors',
                attribute.name.trim()
                  ? 'border-(--surface-color-border-active) bg-(--surface-color-background-light-blue)'
                  : 'border-(--surface-color-border-default) bg-(--surface-color-background-white)',
                dragIndex === index && 'opacity-50',
                overIndex === index &&
                  dragIndex !== null &&
                  dragIndex !== index &&
                  'border-(--surface-color-border-active)',
              )}
            >
              <button
                type="button"
                aria-label={t('credentialDefinitions.attributes.reorder', {
                  index: index + 1,
                })}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="cursor-grab rounded p-1 text-(--typography-color-secondary) hover:text-(--typography-color-primary) active:cursor-grabbing"
              >
                <GripVerticalIcon className="size-5" />
              </button>
              <TextField
                className="min-w-0 flex-1"
                aria-label={t('credentialDefinitions.attributes.name', {
                  index: index + 1,
                })}
                value={attribute.name}
                {...{
                  placeholder: t(
                    'credentialDefinitions.attributes.namePlaceholder',
                  ),
                }}
                onChange={(value) =>
                  setAttributes(
                    attributes.map((item) =>
                      item.id === attribute.id
                        ? { ...item, name: value }
                        : item,
                    ),
                  )
                }
              />
              <Button
                variant="tertiary"
                isIconButton
                danger
                aria-label={t('credentialDefinitions.attributes.delete', {
                  index: index + 1,
                })}
                onPress={() =>
                  setAttributes(
                    attributes.filter((item) => item.id !== attribute.id),
                  )
                }
              >
                <TrashIcon className="size-5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
