// Existing route suites model successful intake. Ledger failures and real
// transactions are exercised separately by the capture-intake suites.
export const emptyCaptureRepository = {
  runInTransaction: async <T>(work: (tx: undefined) => Promise<T>): Promise<T> => work(undefined),
  lockDraftUploadBatch: async () => ({ count: 1 }),
  listCaptureAttempts: async () => [],
  listImagesForBatch: async () => [],
  createCaptureAttempt: async (_owner: string, data: { id: string }) => data,
  updateCaptureAttempt: async () => ({ count: 1 }),
};

export function trackedBatch<T extends object>(row: T | null) {
  return row === null ? null : { captureTracking: 'tracked', ...row };
}
