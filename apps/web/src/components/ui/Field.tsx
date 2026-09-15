import { useId, type ReactNode } from 'react';

interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

type FieldProps = {
  testId?: string | undefined;
  description?: string;
  error?: string;
} & (
  | { legend: string; legendId?: string | undefined; children: ReactNode }
  | { label: string; children: (props: FieldControlProps) => ReactNode }
);

export function Field(props: FieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [props.description ? descriptionId : '', props.error ? errorId : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const messages = (
    <>
      {props.description && (
        <p className="field__description" id={descriptionId}>
          {props.description}
        </p>
      )}
      {props.error && (
        <p className="field__error" id={errorId} role="alert">
          {props.error}
        </p>
      )}
    </>
  );

  if ('legend' in props) {
    return (
      <fieldset className="field" data-testid={props.testId} aria-describedby={describedBy}>
        <legend className="field__legend" id={props.legendId}>
          {props.legend}
        </legend>
        {props.children}
        {messages}
      </fieldset>
    );
  }
  return (
    <div className="field" data-testid={props.testId}>
      <label className="field__legend" htmlFor={id}>
        {props.label}
      </label>
      {props.children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': props.error ? true : undefined,
      })}
      {messages}
    </div>
  );
}
