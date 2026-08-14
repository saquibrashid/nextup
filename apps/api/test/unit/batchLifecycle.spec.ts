/**
 * TASK-054 — the batch state machine, at the layer where it is decidable.
 *
 * `T-BATCH-017` (new, `specs/testing.md` §24.1) is a pure property of the
 * table and belongs in a unit test: it asserts totality, agreement with
 * `TERMINAL_BATCH_STATUSES`, and that the discardable set is exactly what
 * `specs/api.md` §6.23 lists. None of those need a database, and running them
 * against one would make a table typo look like a slow integration failure.
 *
 * `T-BATCH-013` is here too, and its shape is the finding of this task. §9
 * defines it as "changing `service`/`mode` after submit → 409
 * `BATCH_IMMUTABLE`", but **no route in `specs/api.md` §4 accepts a change to
 * either field** — immutability is currently enforced by the absence of an
 * endpoint. A test that only exercised `assertBatchMutable` would prove a
 * guard nothing calls; a test that tried to send the request would have no
 * request to send. So it is asserted in two legs: the guard refuses correctly
 * (so a future endpoint has something to call), and no registered route is
 * capable of accepting the change today. The second leg is the one that fails
 * if someone adds a `PATCH /api/batches/:batchId` without wiring the guard.
 */

import { BATCH_STATUSES, TERMINAL_BATCH_STATUSES, type BatchStatus } from '@nextup/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { createApiRouter } from '../../src/routes/index.js';
import {
  BATCH_TRANSITIONS,
  DISCARDABLE_BATCH_STATUSES,
  MUTABLE_BATCH_STATUSES,
  assertBatchMutable,
  canTransition,
  discardBatch,
  loadOwnedBatch,
  openStatuses,
  statusesWithNoOutgoingTransitions,
  submitBatch,
  transitionBatch,
} from '../../src/services/batchLifecycle.js';
import {
  findUploadBatch,
  listImagesForBatch,
  transitionUploadBatchStatus,
  type OwnerId,
} from '../../src/repository/ownerData.js';

// The repository is stubbed HERE and only here. Everything in this file is a
// branch of the service's own logic — a refusal, a 404, an empty-batch check —
// and none of it needs a database to be decided. The properties that DO depend
// on the store (the conditional write actually being atomic, a discarded batch
// leaving the list byte-identical) stay in
// `apps/api/test/integration/batchLifecycle.spec.ts`, where a stub would be
// agreement rather than evidence.
vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findUploadBatch: vi.fn(),
    listImagesForBatch: vi.fn(),
    transitionUploadBatchStatus: vi.fn(),
  };
});

const OWNER = 'owner-hash' as OwnerId;
const mockFind = vi.mocked(findUploadBatch);
const mockImages = vi.mocked(listImagesForBatch);
const mockTransition = vi.mocked(transitionUploadBatchStatus);

/** The subset of an `UploadBatch` these branches read. */
const batchRow = (status: string) =>
  ({ id: 'b-1', status, service: 'netflix', mode: 'append-only' }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

/** Reads the registered routes out of an Express router (see `authChain.spec.ts`). */
function enumerateRoutes(layers: unknown): { method: string; path: string }[] {
  const stack = (layers as { stack?: unknown[] }).stack ?? [];
  const out: { method: string; path: string }[] = [];
  for (const layer of stack) {
    const route = (layer as { route?: { path?: unknown; methods?: Record<string, boolean> } })
      .route;
    if (route === undefined || typeof route.path !== 'string') continue;
    for (const [method, enabled] of Object.entries(route.methods ?? {})) {
      if (enabled !== true || method === 'head') continue;
      out.push({ method: method.toUpperCase(), path: route.path });
    }
  }
  return out;
}

describe('T-BATCH-017 — the transition table (TASK-054)', () => {
  it('T-BATCH-017a: is total over BATCH_STATUSES', () => {
    // Not a tautology despite the `Record` type: a hand-written object literal
    // satisfies the type with every key present, and this is what catches a
    // key added to the enum and to the table under a typo'd name.
    expect(Object.keys(BATCH_TRANSITIONS).sort()).toEqual([...BATCH_STATUSES].sort());
  });

  it('T-BATCH-017b: names only real statuses as targets', () => {
    const targets = new Set(Object.values(BATCH_TRANSITIONS).flat());
    for (const target of targets) {
      expect(BATCH_STATUSES).toContain(target);
    }
  });

  it('T-BATCH-017c: no OPEN status is a dead end', () => {
    // ⚠ This is deliberately NOT "statuses with no outgoing edge are exactly
    // the terminal ones" — that was my first draft and it is false. `applied`
    // is terminal in the `TERMINAL_BATCH_STATUSES` sense (the owner may start
    // another batch) and still transitions, to `undone` (§6.25). The two words
    // mean different things: terminal = "no longer blocks a new batch",
    // dead end = "no transition out at all". What must never happen is an
    // OPEN status with nowhere to go, because that batch can neither be
    // finished nor abandoned and locks out every future capture (§5).
    for (const status of openStatuses()) {
      expect(BATCH_TRANSITIONS[status].length, `${status} is a dead end`).toBeGreaterThan(0);
    }
  });

  it('T-BATCH-017d: a terminal status can never lead back to an open one', () => {
    // The safety property behind the one-open-batch ceiling. If a closed
    // batch could reopen, the owner would have two open batches and two
    // full-update reconciliations could interleave (product invariant 3).
    const open = new Set<string>(openStatuses());
    for (const terminal of TERMINAL_BATCH_STATUSES) {
      for (const target of BATCH_TRANSITIONS[terminal]) {
        expect(open.has(target), `${terminal} → ${target} reopens a closed batch`).toBe(false);
      }
    }
    // Non-vacuity: `applied → undone` means this loop is not empty.
    expect(statusesWithNoOutgoingTransitions().length).toBeLessThan(TERMINAL_BATCH_STATUSES.length);
  });

  it('T-BATCH-017e: every open status can still reach a terminal one', () => {
    // Reachability, not one-step: `draft` reaches `applied` only through
    // `submitted → extracting → in-review`. A status that cannot reach any
    // terminal state is a batch the owner can never finish OR abandon, which
    // permanently blocks every future batch (`specs/api.md` §5).
    const reachable = (from: BatchStatus): Set<BatchStatus> => {
      const seen = new Set<BatchStatus>();
      const queue: BatchStatus[] = [from];
      while (queue.length > 0) {
        const next = queue.shift() as BatchStatus;
        for (const to of BATCH_TRANSITIONS[next]) {
          if (seen.has(to)) continue;
          seen.add(to);
          queue.push(to);
        }
      }
      return seen;
    };

    for (const status of openStatuses()) {
      const ends = [...reachable(status)].filter((s) =>
        (TERMINAL_BATCH_STATUSES as readonly string[]).includes(s),
      );
      expect(ends.length, `${status} cannot reach a terminal status`).toBeGreaterThan(0);
    }
  });

  it('T-BATCH-017f: discard is offered from exactly draft, in-review and extraction-failed', () => {
    // Verbatim from §6.23. `submitted` and `extracting` are deliberately
    // absent — extraction is running against that batch in-process, and a
    // discard mid-flight would leave a runner writing candidates to a batch
    // the owner has been told is gone.
    expect([...DISCARDABLE_BATCH_STATUSES].sort()).toEqual(
      ['draft', 'extraction-failed', 'in-review'].sort(),
    );
  });

  it('T-BATCH-017g: retry re-enters the SAME batch rather than deriving one', () => {
    // §6.16 against §6.24. Collapsing the two would change the batch id the
    // owner is looking at while their screenshots are being re-read.
    expect(canTransition('extraction-failed', 'submitted')).toBe(true);
  });

  it('T-BATCH-017h: rejects transitions the table does not name', () => {
    // The non-vacuity guard for every case above: if `canTransition` returned
    // `true` unconditionally, `017e`, `017f` and `017g` would all still pass.
    expect(canTransition('draft', 'applied')).toBe(false);
    expect(canTransition('applied', 'draft')).toBe(false);
    expect(canTransition('discarded', 'submitted')).toBe(false);
    expect(canTransition('in-review', 'extracting')).toBe(false);
  });
});

describe('T-BATCH-013 — service and mode are immutable after submit (US-003 AC-6)', () => {
  it('T-BATCH-013a: the guard permits a draft', () => {
    expect(() => assertBatchMutable({ id: 'b1', status: 'draft' })).not.toThrow();
  });

  it('T-BATCH-013b: the guard refuses every other status with 409 BATCH_IMMUTABLE', () => {
    const others = BATCH_STATUSES.filter(
      (status) => !(MUTABLE_BATCH_STATUSES as readonly string[]).includes(status),
    );
    // Non-vacuity: if `MUTABLE_BATCH_STATUSES` ever grew to include
    // everything, this loop would iterate nothing and pass.
    expect(others.length).toBe(BATCH_STATUSES.length - 1);

    for (const status of others) {
      let thrown: unknown;
      try {
        assertBatchMutable({ id: 'b1', status });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${status} was allowed to change service/mode`).toBeInstanceOf(AppError);
      const appError = thrown as AppError;
      expect(appError.code).toBe('BATCH_IMMUTABLE');
      expect(appError.httpStatus).toBe(409);
    }
  });

  it('T-BATCH-013c: no registered route can change service or mode on an existing batch', () => {
    // The leg that actually holds today. Immutability is enforced by the
    // ABSENCE of an endpoint, so this fails the moment someone adds a PATCH
    // or PUT on a batch — at which point they must wire `assertBatchMutable`
    // into it and update this list deliberately.
    const mutators = enumerateRoutes(createApiRouter()).filter(
      (route) =>
        (route.method === 'PATCH' || route.method === 'PUT') &&
        /^\/batches\/:batchId\/?$/.test(route.path),
    );
    expect(mutators).toEqual([]);
  });

  it('T-BATCH-013d: the route enumerator can see batch routes at all', () => {
    // `013c`'s non-vacuity guard. An enumerator that returned `[]` — a
    // renamed Express internal, a router built differently — would make the
    // assertion above pass while proving nothing.
    const paths = enumerateRoutes(createApiRouter()).map((route) => route.path);
    expect(paths).toContain('/batches/:batchId/submit');
    expect(paths).toContain('/batches/:batchId/discard');
  });
});

describe('T-BATCH-017 — the refusal branches, without a store', () => {
  it('T-BATCH-017i: an illegal transition is refused before any write is attempted', async () => {
    // Order matters. If the write were attempted first and the refusal derived
    // from its row count, an illegal transition would still touch the database
    // — and on a table with a status CHECK it would fail as a 500 rather than
    // the 409 the SPA knows how to act on.
    await expect(
      transitionBatch(
        OWNER,
        { id: 'b-1', status: 'applied' },
        'submitted',
        'BATCH_NOT_DRAFT',
        'no',
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('T-BATCH-017j: losing the conditional write is refused with the caller code', async () => {
    // A zero row count means another request moved the batch first. It is
    // reported with the SAME code as an outright illegal transition, because
    // to the client they are the same event: the batch is no longer in the
    // state the request assumed.
    mockTransition.mockResolvedValue(0);
    let thrown: unknown;
    try {
      await transitionBatch(
        OWNER,
        { id: 'b-1', status: 'draft' },
        'submitted',
        'BATCH_NOT_DRAFT',
        'no',
      );
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AppError).code).toBe('BATCH_NOT_DRAFT');
    expect((thrown as AppError).httpStatus).toBe(409);
    expect((thrown as AppError).details['expectedOneOf']).toEqual(['draft', 'extraction-failed']);
  });

  it('T-BATCH-017k: a status the enum does not contain is refused, not trusted', async () => {
    // The row comes from the database as a plain string. A value outside the
    // enum — a hand-edited row, a migration mid-flight — must not index into
    // the table and read `undefined`.
    await expect(
      transitionBatch(
        OWNER,
        { id: 'b-1', status: 'nonsense' },
        'submitted',
        'BATCH_NOT_DRAFT',
        'no',
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('T-BATCH-017l: a legal transition does reach the store', async () => {
    // The non-vacuity guard for `017i` and `017k`: a `transitionBatch` that
    // never called the repository at all would satisfy both.
    mockTransition.mockResolvedValue(1);
    await expect(
      transitionBatch(OWNER, { id: 'b-1', status: 'draft' }, 'submitted', 'BATCH_NOT_DRAFT', 'no'),
    ).resolves.toBe('submitted');
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition.mock.calls[0]?.[2]).toBe('draft');
  });

  it('T-BATCH-019e: an unknown batch is 404, never 403', async () => {
    mockFind.mockResolvedValue(null);
    let thrown: unknown;
    try {
      await loadOwnedBatch(OWNER, 'missing');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AppError).code).toBe('NOT_FOUND');
    expect((thrown as AppError).httpStatus).toBe(404);
  });

  it('T-BATCH-019f: NO_IMAGES applies only while the batch is still a draft', async () => {
    // An already-submitted batch with no images must report the 409 the client
    // is waiting for, not change its answer to a 400. Otherwise a double
    // submit of an empty batch tells the SPA to add screenshots to a batch
    // that is already extracting.
    mockFind.mockResolvedValue(batchRow('submitted'));
    mockImages.mockResolvedValue([]);
    mockTransition.mockResolvedValue(0);

    let thrown: unknown;
    try {
      await submitBatch(OWNER, 'b-1');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AppError).code).toBe('BATCH_NOT_DRAFT');
  });

  it('T-BATCH-019g: a draft with no images is NO_IMAGES and is never written', async () => {
    mockFind.mockResolvedValue(batchRow('draft'));
    mockImages.mockResolvedValue([]);

    let thrown: unknown;
    try {
      await submitBatch(OWNER, 'b-1');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AppError).code).toBe('NO_IMAGES');
    expect((thrown as AppError).httpStatus).toBe(400);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('T-BATCH-019h: a successful submit reports the image count and the poll interval', async () => {
    mockFind.mockResolvedValue(batchRow('draft'));
    mockImages.mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }] as never);
    mockTransition.mockResolvedValue(1);

    const at = new Date('2026-08-10T20:04:11.902Z');
    expect(await submitBatch(OWNER, 'b-1', at)).toEqual({
      batchId: 'b-1',
      status: 'submitted',
      imageCount: 2,
      submittedAt: '2026-08-10T20:04:11.902Z',
      pollAfterMs: 2000,
    });
  });

  it('T-BATCH-006g: discard reports that the list did not change', async () => {
    mockFind.mockResolvedValue(batchRow('draft'));
    mockTransition.mockResolvedValue(1);

    expect(await discardBatch(OWNER, 'b-1')).toEqual({
      batchId: 'b-1',
      status: 'discarded',
      listStateChanged: false,
    });
  });
});
