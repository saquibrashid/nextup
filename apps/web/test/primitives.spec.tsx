import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Field';
import { Input } from '../src/components/ui/Input';
import { Select } from '../src/components/ui/Select';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { Chip } from '../src/components/ui/Chip';
import { Dialog } from '../src/components/ui/Dialog';
import { EmptyState } from '../src/components/ui/EmptyState';
import { Skeleton } from '../src/components/ui/Skeleton';
import { SegmentedControl } from '../src/components/ui/SegmentedControl';
import { ListIcon } from '../src/components/icons/ListIcon';

const root = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web', 'src')
  : join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('T-UI-031 shared control primitives', () => {
  it('T-UI-031a: native form controls occur only inside primitives', () => {
    const offenders: string[] = [];
    for (const file of walk(root).filter((path) => !path.includes(`${sep}ui${sep}`))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node): void {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          if (
            ['button', 'fieldset', 'input', 'select', 'textarea'].includes(
              node.tagName.getText(source),
            )
          ) {
            offenders.push(`${file}: ${node.tagName.getText(source)}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it('T-UI-031b: Button forwards focus, events, disabled state and submit semantics', () => {
    const ref = createRef<HTMLButtonElement>();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const click = vi.fn();
    const { rerender } = render(
      <form onSubmit={submit}>
        <Button ref={ref} onClick={click}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    ref.current?.focus();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(click).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledOnce();
    rerender(
      <Button disabled onClick={click}>
        Cancel
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(click).toHaveBeenCalledOnce();
  });

  it('T-UI-031c: Field associates label, description and error with its control', () => {
    render(
      <Field label="Title" description="Enter a film or series" error="A title is required">
        {(props) => <Input {...props} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveAccessibleDescription('Enter a film or series A title is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('A title is required');
  });

  it('T-UI-031d: Field preserves fieldset semantics and omits absent help/error', () => {
    const { rerender } = render(
      <Field legend="Service">
        <Input type="checkbox" aria-label="Max" />
      </Field>,
    );
    expect(screen.getByRole('group', { name: 'Service' }).tagName).toBe('FIELDSET');
    rerender(<Field label="Search">{(props) => <Input {...props} />}</Field>);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('T-UI-031e: segmented choices remain native radios with no implicit selection', () => {
    function Choices() {
      const [value, setValue] = useState('');
      return (
        <SegmentedControl legend="Mode">
          {['Add only', 'Full update'].map((label) => (
            <label key={label}>
              <Input
                type="radio"
                name="mode"
                checked={value === label}
                onChange={() => setValue(label)}
              />
              {label}
            </label>
          ))}
        </SegmentedControl>
      );
    }
    render(<Choices />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Full update' }));
    expect(screen.getByRole('radio', { name: 'Full update' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Add only' })).not.toBeChecked();
  });

  it('T-UI-031f: Dialog traps focus, dismisses on Escape and restores the trigger', () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open</Button>
          {open && (
            <Dialog aria-labelledby="heading" onDismiss={() => setOpen(false)}>
              <h2 id="heading">Confirm</h2>
              <Button>First</Button>
              <Button>Last</Button>
            </Dialog>
          )}
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('T-UI-031g: presentational primitives retain content, labels and actions', () => {
    const action = vi.fn();
    render(
      <Card data-testid="card">
        <Badge>Netflix</Badge>
        <Chip>Adventure</Chip>
        <EmptyState
          icon={<ListIcon />}
          title="Nothing here"
          body="Add screenshots"
          action={<Button onClick={action}>Upload</Button>}
        />
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('card');
    expect(screen.getByText('Netflix')).toHaveClass('badge');
    expect(screen.getByText('Adventure')).toHaveClass('chip');
    expect(screen.getByText('Nothing here')).toBeVisible();
    expect(screen.getByText('Add screenshots')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('T-UI-031h: Select and Input forward their refs and native change events', () => {
    const input = createRef<HTMLInputElement>();
    const select = createRef<HTMLSelectElement>();
    const changed = vi.fn();
    render(
      <>
        <Input ref={input} aria-label="Search" onChange={changed} />
        <Select ref={select} aria-label="Sort" onChange={changed}>
          <option value="year">Year</option>
        </Select>
        <Input
          type="file"
          aria-label="Choose files"
          accept="image/png,image/jpeg,image/heic"
          multiple
        />
      </>,
    );
    input.current?.focus();
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } });
    select.current?.focus();
    expect(screen.getByRole('combobox')).toHaveFocus();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'year' } });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Choose files')).toHaveAttribute('multiple');
  });
});

describe('T-UI-032 primitive variants', () => {
  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'T-UI-032m: %s Button has its static variant and target floor',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(screen.getByRole('button')).toHaveClass('btn', `btn--${variant}`, 'tap-target');
    },
  );

  it.each(['line', 'card', 'poster'] as const)(
    'T-UI-032n: %s Skeleton is shaped decoration',
    (shape) => {
      render(<Skeleton shape={shape} data-testid="skeleton" />);
      expect(screen.getByTestId('skeleton')).toHaveClass('skeleton', `skeleton--${shape}`);
      expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
    },
  );
});
