import { useState } from 'react';
import type { BatchStatus } from '../lib/apiClient';
import { Button } from './ui/Button';
import { ScreenshotPreview } from './ScreenshotPreview';
import { Fieldset } from './ui/Fieldset';
import { Input } from './ui/Input';
import { RejectionList, mergeRejections } from './RejectionList';

export function CaptureInputIssues({
  batch,
  disabled,
  onResolve,
  onRetryRemoval,
}: {
  readonly batch: BatchStatus;
  readonly disabled: boolean;
  readonly onResolve: (attemptId: string, imageIds: readonly string[]) => void;
  readonly onRetryRemoval: (imageId: string) => void;
}) {
  const [selected, setSelected] = useState<Readonly<Record<string, readonly string[]>>>({});
  const intake = batch.intake;
  if (intake === undefined) {
    return (
      <p role="status">
        Input completeness has not been verified. Check saved status before continuing.
      </p>
    );
  }
  if (intake.complete) {
    return intake.attempts.some((attempt) => attempt.state === 'resolved') ? (
      <p role="status">
        All recorded input issues are resolved. You can extract the saved screenshots.
      </p>
    ) : null;
  }
  const unresolved = intake.attempts.filter((attempt) =>
    intake.unresolvedAttemptIds.includes(attempt.id),
  );
  const removing = new Set(
    unresolved
      .filter((attempt) => attempt.kind === 'image-removal')
      .flatMap((attempt) => attempt.acceptedImageIds),
  );
  const available = batch.images.filter((image) => image.available && !removing.has(image.imageId));
  const chosen = (attemptId: string) =>
    (selected[attemptId] ?? []).filter((id) => available.some((image) => image.imageId === id));
  return (
    <section className="review-unsaved" aria-label="Screenshot input issues">
      <h2>Check incomplete input</h2>
      <p>
        {batch.mode === 'full-update'
          ? 'Nothing will be removed while screenshot input is unresolved. You can still review and apply additions.'
          : 'You can still review additions. These input issues remain saved with the capture.'}
      </p>
      {intake.origin !== 'tracked' && (
        <p>
          This capture has no complete intake record. Its saved screenshots can still add titles,
          but a fresh capture is needed before full-update removals.
        </p>
      )}
      {unresolved.map((attempt) => (
        <Fieldset
          key={attempt.id}
          disabled={disabled}
          legend={
            attempt.kind === 'image-removal'
              ? 'Unfinished screenshot removal'
              : 'Missing or interrupted input'
          }
        >
          {attempt.failures.length === 0 ? (
            <p>An upload has not finished. Its cause is not known.</p>
          ) : (
            <RejectionList
              entries={attempt.failures.flatMap((failure) =>
                failure.code === undefined
                  ? mergeRejections([{ name: failure.name, reason: failure.message }], [])
                  : mergeRejections(
                      [],
                      [{ fileName: failure.name, message: failure.message, code: failure.code }],
                    ),
              )}
            />
          )}
          {attempt.kind === 'image-removal' ? (
            <Button
              variant="secondary"
              onClick={() => {
                const id = attempt.acceptedImageIds[0];
                if (id !== undefined) onRetryRemoval(id);
              }}
            >
              Retry screenshot removal
            </Button>
          ) : (
            <>
              <p>
                Choose saved screenshots that cover all the failed input above. Existing screenshots
                and new uploads are both valid. Nothing is selected automatically.
              </p>
              {available.length === 0 && (
                <p>Upload a replacement screenshot above before choosing coverage.</p>
              )}
              <div className="draft-images">
                {available.map((image, index) => (
                  <label key={image.imageId}>
                    <ScreenshotPreview source={image.href} name={image.fileName} />
                    <Input
                      type="checkbox"
                      aria-label={`Use saved screenshot ${index + 1}: ${image.fileName}`}
                      checked={chosen(attempt.id).includes(image.imageId)}
                      onChange={(event) => {
                        const ids = chosen(attempt.id);
                        const checked = event.target.checked;
                        setSelected((current) => ({
                          ...current,
                          [attempt.id]: checked
                            ? [...ids, image.imageId]
                            : ids.filter((id) => id !== image.imageId),
                        }));
                      }}
                    />
                    {image.fileName}
                  </label>
                ))}
              </div>
              <Button
                variant="secondary"
                disabled={chosen(attempt.id).length === 0}
                onClick={() => onResolve(attempt.id, chosen(attempt.id))}
              >
                Confirm selected screenshots cover this input
              </Button>
            </>
          )}
        </Fieldset>
      ))}
    </section>
  );
}
