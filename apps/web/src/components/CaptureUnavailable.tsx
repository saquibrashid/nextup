import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export function CaptureUnavailable() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="capture-status">
      <h1 ref={heading} tabIndex={-1}>
        Capture unavailable
      </h1>
      <p>This capture could not be found for your account. No changes were made by opening it.</p>
      <div className="upload-checkpoint__actions">
        <Link to="/batches" className="tap-target">
          Capture history
        </Link>
        <Link to="/upload" className="tap-target">
          Check uploads
        </Link>
      </div>
    </section>
  );
}
