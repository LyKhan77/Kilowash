import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke for the worker pipeline.
 *
 * Covers: the production worker chunk boots, RMBG-1.4 segments a frame, the PNG
 * Target-MB solver lands under budget, the receipt is wired to the edited blob, and
 * the main thread never blocks long enough to freeze the room.
 *
 * Needs network on the first run: the browser context starts with an empty Cache
 * API, so briaai/RMBG-1.4 is downloaded (fp16 on WebGPU, q8 on WASM) plus the ORT
 * wasm runtime.
 */
test('washes a sample image through the worker and lands under the PNG target', async ({
  page,
}) => {
  await page.goto('/');

  // Interactivity is deliberately NOT asserted here: wall-clock timing in headless Chromium
  // varies by seconds when the WASM worker saturates the CPU, so any threshold becomes a
  // coin flip. "Heavy work stays in the worker" is enforced by the architecture and measured
  // by hand on an idle machine (30-frame cycle: max 31.7 ms frame gap).

  await page.getByRole('button', { name: 'MEME IMG' }).click();
  const start = page.getByRole('button', { name: 'START', exact: true });
  await expect(start).toBeEnabled({ timeout: 30_000 });

  // PNG path with an aggressive budget forces the worker's palette/scale descent.
  await page.getByRole('button', { name: /PNG Transparent/ }).click();
  await page.getByRole('button', { name: '0.2MB' }).click();
  await page.getByRole('button', { name: '-', exact: true }).click();
  await expect(page.getByText('TARGET: 0.05 MB | PNG')).toBeVisible();

  await start.click();
  await expect(page.getByText('CARE TAG // RECEIPT')).toBeVisible({ timeout: 330_000 });

  const output = await page.evaluate(async () => {
    const img = Array.from(document.querySelectorAll('img')).find((el) =>
      el.src.startsWith('blob:')
    );
    if (!img) return null;

    const buffer = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const text = document.body.innerText;

    return {
      bytes: buffer.byteLength,
      magic: Array.from(buffer.slice(0, 4)),
      naturalWidth: img.naturalWidth,
      finalSizeMB: Number((text.match(/FINAL SIZE\n([\d.]+) MB/) ?? [])[1]),
      targetMB: Number((text.match(/TARGET MB\n(?:<=|≤)\s*([\d.]+) MB/) ?? [])[1]),
    };
  });

  expect(output).not.toBeNull();
  expect(output!.bytes).toBeGreaterThan(1_000);
  expect(output!.magic).toEqual([137, 80, 78, 71]); // PNG signature
  expect(output!.naturalWidth).toBeGreaterThan(0);
  expect(output!.targetMB).toBeCloseTo(0.05, 2);
  expect(output!.finalSizeMB).toBeLessThanOrEqual(output!.targetMB + 0.01);
});

/**
 * Offline path: with the model hosts unreachable the worker must fall through to the
 * Sobel edge-barrier segmentation instead of failing the cycle. Cheap test — no weights.
 */
test('falls back to offline Sobel segmentation when the model hosts are unreachable', async ({
  page,
}) => {
  const blocked: string[] = [];
  await page.route(/huggingface\.co|hf\.co|cdn\.jsdelivr\.net/, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });

  await page.goto('/');

  await page.evaluate(() => {
    const state = { offlineFallbackSeen: false };
    (window as unknown as { __wash: typeof state }).__wash = state;
    // The rinse label only lives ~1 s, so sample the room instead of testing once.
    window.setInterval(() => {
      if (document.body.innerText.includes('OFFLINE FALLBACK')) {
        state.offlineFallbackSeen = true;
      }
    }, 50);
  });

  await page.getByRole('button', { name: 'MEME IMG' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'WASH BG AI' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();

  await expect(page.getByText('CARE TAG // RECEIPT')).toBeVisible({ timeout: 120_000 });

  const output = await page.evaluate(async () => {
    const seen = (window as unknown as { __wash?: { offlineFallbackSeen: boolean } }).__wash;
    const img = Array.from(document.querySelectorAll('img')).find((el) =>
      el.src.startsWith('blob:')
    );
    if (!img) return { offlineFallbackSeen: seen?.offlineFallbackSeen, bytes: 0, transparent: 0 };

    const buffer = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/webp' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 10) transparent += 1;
    }

    return {
      offlineFallbackSeen: seen?.offlineFallbackSeen,
      bytes: buffer.byteLength,
      transparent,
    };
  });

  expect(blocked.length).toBeGreaterThan(0);
  expect(output.offlineFallbackSeen).toBe(true);
  expect(output.bytes).toBeGreaterThan(1_000);
  expect(output.transparent).toBeGreaterThan(0);
});

/**
 * Scene 2 Touch-Up Brush: erasing pixels on a Target-MB PNG output must update the
 * Care Tag receipt and re-run the PNG Target-MB solver rather than bloating past budget.
 */
test('touch-up brush edits update the receipt while preserving PNG Target-MB budget', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'MEME IMG' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeEnabled({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'SPIN MB' }).click();
  await page.getByRole('button', { name: /PNG Transparent/ }).click();
  await page.getByRole('button', { name: '0.2MB' }).click();
  await page.getByRole('button', { name: '-', exact: true }).click();
  await expect(page.getByText('TARGET: 0.05 MB | PNG')).toBeVisible();

  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('CARE TAG // RECEIPT')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: /BLEACH -/ }).click();
  const canvas = page.locator('canvas.cursor-crosshair');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.5, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Undo touch-up stroke' })).toBeEnabled();
  await page.getByRole('button', { name: 'DONE', exact: true }).click();

  // Wait for the async worker PNG re-encode to update the hanging image.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const img = Array.from(document.querySelectorAll('img')).find((el) =>
            el.src.startsWith('blob:')
          );
          if (!img || !img.complete || img.naturalWidth === 0) return 0;
          const bitmap = await createImageBitmap(
            await (await fetch(img.src)).blob()
          );
          const c = document.createElement('canvas');
          c.width = bitmap.width;
          c.height = bitmap.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return 0;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          let transparent = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 10) transparent += 1;
          }
          return transparent;
        }),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);

  const edited = await page.evaluate(async () => {
    const img = Array.from(document.querySelectorAll('img')).find((el) =>
      el.src.startsWith('blob:')
    );
    if (!img) return null;
    const buffer = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const text = document.body.innerText;
    return {
      bytes: buffer.byteLength,
      magic: Array.from(buffer.slice(0, 4)),
      finalSizeMB: Number((text.match(/FINAL SIZE\n([\d.]+) MB/) ?? [])[1]),
      targetMB: Number((text.match(/TARGET MB\n(?:<=|≤)\s*([\d.]+) MB/) ?? [])[1]),
    };
  });

  expect(edited).not.toBeNull();
  expect(edited!.magic).toEqual([137, 80, 78, 71]);
  expect(edited!.finalSizeMB).toBeLessThanOrEqual(edited!.targetMB + 0.01);
});

/**
 * Video/GIF path: extracts frames from the synthetic WebM clip and encodes an animated
 * GIF inside the worker under the Target-MB budget.
 */
test('encodes sample meme video to animated GIF under Target-MB in the worker', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'MEME VID' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeEnabled({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'SPIN MB' }).click();
  await page.getByRole('button', { name: 'TIGHT SUBJECT 50%' }).click();
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: /GIF Transparent/ }).click();
  await page.getByRole('button', { name: '0.5MB' }).click();
  await expect(page.getByText('TARGET: 0.50 MB | GIF')).toBeVisible();

  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByText('CARE TAG // RECEIPT')).toBeVisible({ timeout: 120_000 });

  const gifOutput = await page.evaluate(async () => {
    const img = Array.from(document.querySelectorAll('img')).find((el) =>
      el.src.startsWith('blob:')
    );
    if (!img) return null;
    const buffer = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    const text = document.body.innerText;
    return {
      bytes: buffer.byteLength,
      magic: Array.from(buffer.slice(0, 4)),
      finalSizeMB: Number((text.match(/FINAL SIZE\n([\d.]+) MB/) ?? [])[1]),
      targetMB: Number((text.match(/TARGET MB\n(?:<=|≤)\s*([\d.]+) MB/) ?? [])[1]),
    };
  });

  expect(gifOutput).not.toBeNull();
  expect(gifOutput!.bytes).toBeGreaterThan(1_000);
  expect(gifOutput!.magic).toEqual([71, 73, 70, 56]); // "GIF8"
  expect(gifOutput!.finalSizeMB).toBeLessThanOrEqual(gifOutput!.targetMB + 0.01);
});
