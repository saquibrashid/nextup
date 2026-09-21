import { Link } from 'react-router-dom';
import { SERVICE_LABELS } from '@nextup/domain';
import { apiClient, type ApiClient } from '../lib/apiClient';
import { resumeAction, useUploadCheckpoint } from '../lib/useUploadCheckpoint';
import { useOnline } from '../lib/useOnline';

export function CaptureResume({ client = apiClient }: { readonly client?: ApiClient }) {
  const online = useOnline();
  const { state } = useUploadCheckpoint(client, online, true);
  if (state.kind === 'ready' || state.kind === 'refused') return null;
  const action = state.kind === 'open' ? resumeAction(state.batch.status) : null;
  return (
    <aside className="capture-resume" aria-label="Unfinished capture">
      {state.kind === 'open' && action !== null ? (
        <>
          <span>
            <strong>{SERVICE_LABELS[state.batch.service] ?? 'Discovery'}</strong>
            {' / '}
            {action.state}
          </span>
          <Link to={`/batches/${state.batch.batchId}`} className="tap-target">
            {action.label}
          </Link>
        </>
      ) : (
        <div role={state.kind === 'failed' ? 'alert' : 'status'}>
          <span>
            {!online
              ? 'Reconnect to check unfinished captures.'
              : state.kind === 'failed'
                ? state.message
                : 'Checking unfinished captures...'}
          </span>
          <Link to="/upload" className="tap-target">
            Check uploads
          </Link>
        </div>
      )}
    </aside>
  );
}
