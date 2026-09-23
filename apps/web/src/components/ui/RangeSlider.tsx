import { useId, useState, type CSSProperties, type JSX } from 'react';
import { Input } from './Input';

export interface RangeSliderValue {
  readonly min: number;
  readonly max: number;
}

export interface RangeSliderProps {
  readonly legend: string;
  readonly testId?: string;
  /** The last stop index; the first is always 0. */
  readonly last: number;
  readonly value: RangeSliderValue;
  readonly minLabel: string;
  readonly maxLabel: string;
  readonly minName: string;
  readonly maxName: string;
  readonly formatValue: (stop: number) => string;
  readonly speakValue: (stop: number) => string;
  /**
   * Returns the accepted range for a requested handle position and whether it
   * was refused. Handles never swap; the caller decides how far one may go.
   */
  readonly move: (
    handle: 'min' | 'max',
    requested: number,
  ) => { readonly range: RangeSliderValue; readonly clamped: boolean };
  readonly onChange: (range: RangeSliderValue) => void;
  readonly clampMessages: { readonly min: string; readonly max: string };
  readonly description?: string | undefined;
}

/**
 * Two native range inputs on one track (#366). Native inputs supply the
 * keyboard path (arrows, Page Up/Down, Home/End), touch dragging and the
 * `slider` role; each handle has its own name and spoken value.
 */
export function RangeSlider({
  legend,
  testId,
  last,
  value,
  minLabel,
  maxLabel,
  minName,
  maxName,
  formatValue,
  speakValue,
  move,
  onChange,
  clampMessages,
  description,
}: RangeSliderProps): JSX.Element {
  const id = useId();
  const minId = `${id}-min`;
  const maxId = `${id}-max`;
  const descriptionId = `${id}-description`;
  const [notice, setNotice] = useState('');
  const track = {
    '--range-start': String(value.min / last),
    '--range-end': String(value.max / last),
  } as CSSProperties;

  function handle(which: 'min' | 'max', requested: number): void {
    const next = move(which, requested);
    setNotice(next.clamped ? clampMessages[which] : '');
    if (next.range.min !== value.min || next.range.max !== value.max) onChange(next.range);
  }

  return (
    <fieldset
      className="field range-slider"
      data-testid={testId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <legend className="field__legend">{legend}</legend>
      <div className="range-slider__values">
        <div className="range-slider__value">
          <label htmlFor={minId}>{minLabel}</label>
          <output htmlFor={minId} data-testid="range-min-value">
            {formatValue(value.min)}
          </output>
        </div>
        <div className="range-slider__value range-slider__value--end">
          <label htmlFor={maxId}>{maxLabel}</label>
          <output htmlFor={maxId} data-testid="range-max-value">
            {formatValue(value.max)}
          </output>
        </div>
      </div>
      <div className="range-slider__track" style={track}>
        <span className="range-slider__fill" aria-hidden="true" />
        <Input
          id={minId}
          type="range"
          min={0}
          max={last}
          step={1}
          value={value.min}
          aria-label={minName}
          aria-valuetext={speakValue(value.min)}
          data-handle="min"
          onChange={(event) => {
            handle('min', Number(event.target.value));
          }}
        />
        <Input
          id={maxId}
          type="range"
          min={0}
          max={last}
          step={1}
          value={value.max}
          aria-label={maxName}
          aria-valuetext={speakValue(value.max)}
          data-handle="max"
          onChange={(event) => {
            handle('max', Number(event.target.value));
          }}
        />
      </div>
      {description && (
        <p className="field__description" id={descriptionId}>
          {description}
        </p>
      )}
      <p className="range-slider__notice" role="status">
        {notice}
      </p>
    </fieldset>
  );
}
