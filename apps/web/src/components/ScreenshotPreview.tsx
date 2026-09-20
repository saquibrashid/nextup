import { useEffect, useState } from 'react';

export function ScreenshotPreview({
  source,
  name,
  unsupported = false,
}: {
  source: File | string;
  name: string;
  unsupported?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(typeof source === 'string' ? source : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (unsupported) {
      setUrl(null);
      return;
    }
    if (typeof source === 'string') {
      setUrl(source);
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(source);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source, unsupported]);
  return (
    <div className="capture-preview">
      {url !== null && !failed && !unsupported ? (
        <img
          src={url}
          alt={`Screenshot preview: ${name}`}
          width={80}
          height={80}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{unsupported ? 'HEIC / HEIF' : 'Preview unavailable'}</span>
      )}
    </div>
  );
}
