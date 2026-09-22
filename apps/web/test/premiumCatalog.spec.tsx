import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaptureProgress } from '../src/components/CaptureProgress';
import { ReviewPage } from '../src/pages/ReviewPage';

describe('T-POL-001 capture orientation', () => {
  it.each(['prepare', 'read', 'review'] as const)(
    'T-POL-001a: %s has one current stage without implying completion or navigation',
    (stage) => {
      render(<CaptureProgress stage={stage} />);
      const progress = screen.getByRole('list', { name: 'Capture progress' });
      const steps = within(progress).getAllByRole('listitem');
      expect(steps.map((step) => step.textContent)).toEqual([
        'Prepare',
        'Read screenshots',
        'Review',
      ]);
      expect(steps.filter((step) => step.getAttribute('aria-current') === 'step')).toHaveLength(1);
      expect(steps[['prepare', 'read', 'review'].indexOf(stage)]).toHaveAttribute(
        'aria-current',
        'step',
      );
      expect(within(progress).queryByRole('button')).not.toBeInTheDocument();
      expect(within(progress).queryByRole('link')).not.toBeInTheDocument();
      expect(within(progress).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(progress).not.toHaveTextContent(/complete|success|\d+%/i);
    },
  );

  it('T-POL-001b: review loading and read failures retain orientation and honest feedback', () => {
    const { rerender } = render(<ReviewPage />);
    expect(screen.getByRole('list', { name: 'Capture progress' })).toHaveTextContent('Review');
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<ReviewPage loadFailed />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Capture progress' }).querySelector('[aria-current]'),
    ).toHaveTextContent('Review');
  });
});
