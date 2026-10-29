import { GripVertical, Plus } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import { TrashIcon } from '@/components/common/icons';
import { Input } from '@/components/common/input';
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
        <h2 className="text-lg font-semibold">
          {t('credentialDefinitions.attributes.title')}
        </h2>
        <Button type="button" variant="outline" onClick={addAttribute}>
          <Plus aria-hidden="true" />
          {t('credentialDefinitions.attributes.add')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('credentialDefinitions.attributes.subtitle')}
      </p>
      {attributes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
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
                  ? 'border-primary bg-primary/20'
                  : 'border-border bg-background',
                dragIndex === index && 'opacity-50',
                overIndex === index &&
                  dragIndex !== null &&
                  dragIndex !== index &&
                  'border-primary',
              )}
            >
              <button
                type="button"
                aria-label={t('credentialDefinitions.attributes.reorder', {
                  index: index + 1,
                })}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="cursor-grab rounded p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-5" aria-hidden="true" />
              </button>
              <Input
                aria-label={t('credentialDefinitions.attributes.name', {
                  index: index + 1,
                })}
                value={attribute.name}
                placeholder={t(
                  'credentialDefinitions.attributes.namePlaceholder',
                )}
                onChange={(event) =>
                  setAttributes(
                    attributes.map((item) =>
                      item.id === attribute.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('credentialDefinitions.attributes.delete', {
                  index: index + 1,
                })}
                title={t('credentialDefinitions.attributes.delete', {
                  index: index + 1,
                })}
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  setAttributes(
                    attributes.filter((item) => item.id !== attribute.id),
                  )
                }
              >
                <TrashIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
