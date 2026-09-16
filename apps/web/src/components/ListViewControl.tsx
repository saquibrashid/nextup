import type { JSX } from 'react';
import { CompactIcon, GridIcon } from './icons';
import { Button } from './ui/Button';

export type ListView = 'grid' | 'compact';

export function ListViewControl({
  view,
  onChange,
}: {
  readonly view: ListView;
  readonly onChange: (view: ListView) => void;
}): JSX.Element {
  return (
    <div className="list-view-control" role="group" aria-label="List layout">
      <Button
        variant="ghost"
        aria-label="Grid view"
        aria-pressed={view === 'grid'}
        onClick={() => onChange('grid')}
      >
        <GridIcon />
        <span>Grid</span>
      </Button>
      <Button
        variant="ghost"
        aria-label="Compact view"
        aria-pressed={view === 'compact'}
        onClick={() => onChange('compact')}
      >
        <CompactIcon />
        <span>Compact</span>
      </Button>
    </div>
  );
}
