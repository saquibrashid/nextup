/**
 * TASK-145, second half — **serial image processing and the buffers it
 * releases** (`REQ-079`, `RSK-016`, `specs/testing.md` §26.2b).
 *
 * The guard's decision table, the `NEXTUP_MAX_DECODE_PIXELS` read and the
 * header readers are owned by `pixelGuard.spec.ts` (`T-IMG-017`/`022`/`025`)
 * and are deliberately NOT restated here. What was still unclaimed is the other
 * half of REQ-079: that a batch is processed **one image at a time** and that
 * each image's bytes are **released before the next is loaded**. That half was
 * blocked on there being an extraction worker at all; `runExtraction.ts` now
 * exists and is wired, so it is buildable and is asserted below.
 *
 * ⚠ THE PRIMARY CLAIM IS *OVERLAP*, NOT MEGABYTES — AND THAT IS DELIBERATE.
 * The obvious test ("run a batch, assert `rss` stays under N MB") is a GC race
 * wearing an assertion's clothes. Node frees a buffer's backing store when the
 * collector gets round to it, not when the last reference dies, so a perfectly
 * serial run can drift upward for reasons that are nobody's fault. Measured on
 * this worker's actual shape, serial peak growth varied between **65 MiB and
 * 160 MiB across otherwise identical runs**. A test tuned to the low end fails
 * on somebody else's pull request; the fix everyone reaches for is to raise the
 * ceiling until it stops complaining, at which point it asserts nothing. This
 * repository has already shipped one gate that passed identically with its
 * predicate deleted.
 *
 * So the property is asserted where it is DETERMINISTIC — **at most one image's
 * bytes are live at any instant** — and the megabyte ceiling that TASK-145 asks
 * for is kept as a deliberately coarse cross-check, sized against measurement
 * rather than against a round number. See `T-IMG-026g`.
 */

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import {
  EXTRACTION_IMAGE_CONCURRENCY,
  runExtraction,
  type ExtractionImageRef,
  type RunExtractionPorts,
} from '../../src/jobs/runExtraction.js';
import type { TitleExtractor } from '@nextup/domain';

const BATCH = 'b-serial';

function imageRefs(count: number): ExtractionImageRef[] {
  return Array.from({ length: count }, (_, i) => ({
    imageId: `i-${String(i)}`,
    fileName: `IMG_${String(i)}.png`,
    format: 'png' as const,
    blobPath: `owner/${BATCH}/i-${String(i)}.png`,
  }));
}

function stubExtractor(): TitleExtractor {
  return {
    name: 'stub',
    async extract() {
      // Yield to the event loop. Without a real suspension point the whole run
      // completes in a single synchronous turn and NO interleaving is possible,
      // so the overlap assertion would pass against a parallel implementation
      // too - the vacuity `T-IMG-026c` exists to rule out.
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { items: [], crossCheck: 'ok' as const, providerMeta: {} };
    },
  } as unknown as TitleExtractor;
}

interface Tracker {
  readonly ports: RunExtractionPorts;
  /** The greatest number of image buffers ever live at once. */
  peakLive: () => number;
  readonly order: string[];
}

/**
 * Ports that track the LIFETIME of each image's bytes: live from entry to
 * `loadImageBytes` until the worker has finished with that image.
 *
 * ⚠ THE RELEASE POINT IS `reportProgress`, NOT `recordItems`, and getting this
 * wrong is easy: `recordItems` is skipped entirely when an image fails in a
 * contained way, so an instrument that decrements there leaks one count per
 * failed image and reports an overlap of 2 against a perfectly serial worker.
 * `reportProgress` is the one call the loop makes on BOTH the success and the
 * contained-failure path, exactly once per image. It clamps at zero so that a
 * pre-loop progress report cannot drive the counter negative.
 *
 * `fill` exists because of a second trap, found while calibrating
 * `T-IMG-026g`: an allocated-but-never-written `Uint8Array` is not resident, so
 * RSS does not move for it at all. An RSS test over unwritten buffers reports
 * ~0 MiB for the serial AND the parallel case, and passes against both.
 */
function tracking(bytesPerImage = 1024, fill = false): Tracker {
  let live = 0;
  let peak = 0;
  const order: string[] = [];

  const ports: RunExtractionPorts = {
    async loadImageBytes(image) {
      live += 1;
      peak = Math.max(peak, live);
      order.push(`load:${image.imageId}`);
      await Promise.resolve();
      const bytes = new Uint8Array(bytesPerImage);
      if (fill) bytes.fill(1);
      return bytes;
    },
    async recordItems(image) {
      order.push(`record:${image.imageId}`);
      await Promise.resolve();
    },
    reportProgress() {
      live = Math.max(0, live - 1);
    },
    now: () => Date.now(),
  };

  return { ports, peakLive: () => peak, order };
}

describe('T-IMG-026 - one image in flight at a time (REQ-079)', () => {
  it('T-IMG-026a - the image concurrency constant is one', () => {
    // Stated separately so that changing it fails here with an obvious message
    // rather than as a puzzling overlap failure three cases down.
    expect(EXTRACTION_IMAGE_CONCURRENCY).toBe(1);
  });

  it("T-IMG-026b - never holds two images' bytes at once across a batch", async () => {
    const tracker = tracking();

    const result = await runExtraction({
      batchId: BATCH,
      images: imageRefs(6),
      extractor: stubExtractor(),
      ports: tracker.ports,
    });

    expect(result.status).toBe('in-review');
    expect(tracker.peakLive()).toBe(EXTRACTION_IMAGE_CONCURRENCY);
  });

  it('T-IMG-026c - the tracker can actually observe an overlap', async () => {
    // NON-VACUITY. A tracker that could never see a second buffer would report
    // a peak of 1 against a fully parallel worker too, and this whole suite
    // would be decoration. Driving the same ports in parallel by hand must
    // show the overlap the real loop is required not to produce.
    const tracker = tracking();

    await Promise.all(
      imageRefs(4).map(async (image) => {
        await tracker.ports.loadImageBytes(image);
        await tracker.ports.recordItems(image, []);
        await tracker.ports.reportProgress({} as never);
      }),
    );

    expect(tracker.peakLive()).toBeGreaterThan(1);
  });

  it('T-IMG-026d - finishes each image before starting the next', async () => {
    // The ordering half of the same property, and the one that reads as an
    // obvious failure if the loop ever becomes `Promise.all`: every `load` is
    // immediately followed by its OWN `record`.
    const tracker = tracking();

    await runExtraction({
      batchId: BATCH,
      images: imageRefs(4),
      extractor: stubExtractor(),
      ports: tracker.ports,
    });

    expect(tracker.order).toEqual([
      'load:i-0',
      'record:i-0',
      'load:i-1',
      'record:i-1',
      'load:i-2',
      'record:i-2',
      'load:i-3',
      'record:i-3',
    ]);
  });

  it('T-IMG-026e - emits a matched decode begin/end per image, never interleaved', async () => {
    // `A43-M5`. A `begin` with no matching `end` is the ONLY signal that names
    // which image killed the container, because a kernel OOM kill raises no
    // error to catch. Interleaved sentinels would make that signal unreadable
    // in exactly the incident it exists for.
    const tracker = tracking();
    const events: string[] = [];

    await runExtraction({
      batchId: BATCH,
      images: imageRefs(3),
      extractor: stubExtractor(),
      ports: {
        ...tracker.ports,
        log(event, fields) {
          if (event.startsWith('image.decode.')) {
            events.push(`${event}:${String(fields['imageId'])}`);
          }
        },
      },
    });

    expect(events).toEqual([
      'image.decode.begin:i-0',
      'image.decode.end:i-0',
      'image.decode.begin:i-1',
      'image.decode.end:i-1',
      'image.decode.begin:i-2',
      'image.decode.end:i-2',
    ]);
  });

  it('T-IMG-026f - one refused image does not break the serial discipline', async () => {
    // REQ-080/081. The containment rule and the memory rule have to hold at
    // the same time: a failure path that left the loop body early could leak
    // the live counter, and that would not show up in the pass-only cases
    // above.
    //
    // ⚠ The failure is raised from `extract`, NOT from `loadImageBytes`, and
    // that placement is the contract rather than convenience. Containment in
    // `runExtraction` is scoped to the decode/read step; a `loadImageBytes`
    // error other than `IMAGES_PURGED` is deliberately batch-fatal, because a
    // blob that cannot be fetched leaves an image UNREAD, and in full-update
    // mode an unread image is indistinguishable from a shelf of titles the
    // owner deleted. The pixel guard also runs at ingest, so by extraction
    // time the stored bytes have already been vetted.
    const tracker = tracking();
    const extract = vi.fn(async (bytes: Uint8Array, mime: string) => {
      void bytes;
      void mime;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (extract.mock.calls.length === 2) {
        throw new AppError('IMAGE_DECODE_OOM', 503, 'ran out of memory');
      }
      return { items: [], crossCheck: 'ok' as const, providerMeta: {} };
    });

    const result = await runExtraction({
      batchId: BATCH,
      images: imageRefs(3),
      extractor: { name: 'stub', extract } as unknown as TitleExtractor,
      ports: tracker.ports,
    });

    expect(result.status).toBe('in-review');
    expect(extract).toHaveBeenCalledTimes(3);
    expect(tracker.peakLive()).toBe(1);
    expect(result).toMatchObject({
      imageFailures: [{ imageId: 'i-1', code: 'IMAGE_DECODE_OOM' }],
    });
  });
});

describe('T-IMG-026 - peak RSS across a batch of max-size images', () => {
  /**
   * 32 MiB per image is roughly a decoded 8 MP screenshot at RGBA, which is the
   * shape the 0.25 vCPU / 0.5 GiB container actually sees.
   */
  const IMAGE_BYTES = 32 * 1024 * 1024;
  const IMAGES = 24;

  /**
   * ⚠ SIZED FROM MEASUREMENT, NOT FROM A ROUND NUMBER. Serial peak growth
   * **plateaus at ~160 MiB and stays there as `IMAGES` rises** - that plateau
   * is V8's collection threshold, not the batch size. Parallel growth instead
   * scales linearly with `IMAGES`, reaching ~770 MiB here. 384 MiB sits 2.4x
   * above the serial plateau and 2x below the parallel figure, so it tolerates
   * a slow runner without tolerating a `Promise.all`.
   *
   * If this ever fails, the first thing to check is whether the worker started
   * holding every image's bytes - NOT whether the ceiling needs raising.
   */
  const CEILING_BYTES = 384 * 1024 * 1024;

  it('T-IMG-026g - peak RSS stays under the ceiling for a full batch', async () => {
    const tracker = tracking(IMAGE_BYTES, true);
    const baseline = process.memoryUsage().rss;
    let peak = 0;

    const result = await runExtraction({
      batchId: BATCH,
      images: imageRefs(IMAGES),
      extractor: stubExtractor(),
      ports: {
        ...tracker.ports,
        async recordItems(image, items) {
          peak = Math.max(peak, process.memoryUsage().rss - baseline);
          await tracker.ports.recordItems(image, items);
        },
      },
    });

    expect(result.status).toBe('in-review');
    expect(tracker.peakLive()).toBe(1);
    expect(peak).toBeLessThan(CEILING_BYTES);
  });
});
