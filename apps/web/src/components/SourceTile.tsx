import { useState, type JSX } from 'react';
import type { ReviewTileCrop } from '@nextup/domain';

export function SourceTile({ crop, src }: { crop: ReviewTileCrop; src: string }): JSX.Element {
  const [aspect, setAspect] = useState(1);
  return (
    <span
      className="candidate-card__thumb candidate-card__thumb--cropped"
      data-testid="candidate-thumb-crop"
      style={{ aspectRatio: aspect }}
    >
      <img
        data-testid="candidate-thumb"
        src={src}
        alt="Original screenshot tile"
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setAspect((image.naturalWidth * crop.w) / (image.naturalHeight * crop.h));
          }
        }}
        style={{
          width: `${(100 / crop.w).toFixed(4)}%`,
          height: `${(100 / crop.h).toFixed(4)}%`,
          left: `${(-(crop.x * 100) / crop.w).toFixed(4)}%`,
          top: `${(-(crop.y * 100) / crop.h).toFixed(4)}%`,
        }}
      />
    </span>
  );
}
