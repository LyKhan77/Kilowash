/**
 * Draw a busy studio background + centered Meme Cat character at a specific
 * animation phase `t` (0..1) onto a 2D canvas context.
 */
function drawMemeSceneFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number
): void {
  // 1. Busy radial sunburst + retro studio room background (to be removed by WASH)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#FF6B6B');
  bgGrad.addColorStop(0.5, '#6C5CE7');
  bgGrad.addColorStop(1, '#00CEC9');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Diagonal sunburst rays
  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * Math.PI * 0.25);
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-width * 0.12, -width);
      ctx.lineTo(width * 0.12, -width);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Background grid + floating geometric clutter
  ctx.strokeStyle = 'rgba(17, 17, 17, 0.18)';
  ctx.lineWidth = Math.max(2, width * 0.004);
  const step = width / 8;
  for (let p = step; p < width; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(width, p);
    ctx.stroke();
  }

  // Cluttered sticker shapes on corners
  ctx.fillStyle = '#FFE600';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(3, width * 0.007);
  ctx.beginPath();
  ctx.arc(width * 0.15, height * 0.18, width * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FF5416';
  ctx.fillRect(width * 0.77, height * 0.12, width * 0.13, width * 0.13);
  ctx.strokeRect(width * 0.77, height * 0.12, width * 0.13, width * 0.13);

  ctx.fillStyle = '#00E5FF';
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.86);
  ctx.lineTo(width * 0.23, height * 0.72);
  ctx.lineTo(width * 0.28, height * 0.89);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2. Central Salient Subject: Cool Meme Cat
  const bounceY = Math.sin(t * Math.PI * 4) * (height * 0.035);
  const tilt = Math.sin(t * Math.PI * 2) * 0.07;

  ctx.save();
  ctx.translate(cx, cy + height * 0.03 + bounceY);
  ctx.rotate(tilt);

  const s = width / 420;
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Shoulders / hoodie body
  ctx.fillStyle = '#00E5FF';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-115, 165);
  ctx.quadraticCurveTo(-108, 70, 0, 68);
  ctx.quadraticCurveTo(108, 70, 115, 165);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Hoodie collar
  ctx.fillStyle = '#FFE600';
  ctx.beginPath();
  ctx.roundRect(-54, 62, 108, 28, 12);
  ctx.fill();
  ctx.stroke();

  // Cat Head + Ears
  ctx.fillStyle = '#FFB84D';
  ctx.beginPath();
  ctx.moveTo(-92, -32);
  ctx.lineTo(-108, -124);
  ctx.lineTo(-32, -74);
  ctx.quadraticCurveTo(0, -86, 32, -74);
  ctx.lineTo(108, -124);
  ctx.lineTo(92, -32);
  ctx.quadraticCurveTo(120, 22, 92, 66);
  ctx.quadraticCurveTo(54, 92, 0, 92);
  ctx.quadraticCurveTo(-54, 92, -92, 66);
  ctx.quadraticCurveTo(-120, 22, -92, -32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner ears
  ctx.fillStyle = '#FF7A59';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-82, -46);
  ctx.lineTo(-92, -100);
  ctx.lineTo(-46, -68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(82, -46);
  ctx.lineTo(92, -100);
  ctx.lineTo(46, -68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cool Deal-With-It Shades
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.roundRect(-84, -22, 72, 38, 6);
  ctx.roundRect(12, -22, 72, 38, 6);
  ctx.fill();
  ctx.fillRect(-14, -10, 28, 10);

  // Glasses glare
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-70, -10);
  ctx.lineTo(-46, 6);
  ctx.moveTo(26, -10);
  ctx.lineTo(50, 6);
  ctx.stroke();

  // Nose & Meme Smirk
  ctx.fillStyle = '#FF5416';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-12, 26);
  ctx.lineTo(12, 26);
  ctx.lineTo(0, 40);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-36, 52);
  ctx.quadraticCurveTo(0, 74, 42, 46);
  ctx.stroke();

  // Whiskers
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-126, 12);
  ctx.lineTo(-68, 22);
  ctx.moveTo(-130, 38);
  ctx.lineTo(-70, 38);
  ctx.moveTo(126, 12);
  ctx.lineTo(68, 22);
  ctx.moveTo(130, 38);
  ctx.lineTo(70, 38);
  ctx.stroke();

  ctx.restore();
}

/**
 * Generates a high-resolution (900x900) PNG File with a rich background and central
 * meme character so AI Background Removal and Target-MB Compression produce clear results.
 */
export async function createSampleMemeImageFile(): Promise<File> {
  const size = 900;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  drawMemeSceneFrame(ctx, size, size, 0.15);

  // Add slight high-frequency texture noise so PNG size is realistic (~400-800KB) for compression demos
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = ((i * 17) % 9) - 4;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to generate sample image.'))),
      'image/png'
    );
  });

  return new File([blob], 'sample-meme-cat.png', { type: 'image/png' });
}

/**
 * Generates a short 2.4-second WebM video clip of an animated bouncing meme cat
 * over a studio background for immediate client-side Video BG removal & GIF testing.
 */
export async function createSampleMemeVideoFile(): Promise<File> {
  const width = 480;
  const height = 480;
  const fps = 15;
  const durationMs = 2400;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  drawMemeSceneFrame(ctx, width, height, 0);

  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_500_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  recorder.start(100);

  const startTime = performance.now();
  await new Promise<void>((resolve) => {
    const renderTick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      drawMemeSceneFrame(ctx, width, height, t);

      if (elapsed < durationMs) {
        requestAnimationFrame(renderTick);
      } else {
        recorder.stop();
        resolve();
      }
    };
    requestAnimationFrame(renderTick);
  });

  const blob = await stopped;
  return new File([blob], 'sample-meme-dance.webm', { type: 'video/webm' });
}

/**
 * Generates a compact, visibly soft & JPEG-compressed (220x220, Q=0.22) sample image
 * so users can immediately test CLARIFY (Real-ESRGAN 4x / Steam DSP) on real degradation.
 */
export async function createSampleBlurryImageFile(): Promise<File> {
  const hiSize = 440;
  const hiCanvas = document.createElement('canvas');
  hiCanvas.width = hiSize;
  hiCanvas.height = hiSize;
  const hiCtx = hiCanvas.getContext('2d');
  if (!hiCtx) throw new Error('Canvas 2D context is unavailable.');

  drawMemeSceneFrame(hiCtx, hiSize, hiSize, 0.12);

  // Add fine typography & micro details that visibly degrade when downsampled + blurred
  hiCtx.fillStyle = '#111111';
  hiCtx.fillRect(hiSize * 0.22, hiSize * 0.8, hiSize * 0.56, hiSize * 0.13);
  hiCtx.strokeStyle = '#FFFFFF';
  hiCtx.lineWidth = 3;
  hiCtx.strokeRect(hiSize * 0.22, hiSize * 0.8, hiSize * 0.56, hiSize * 0.13);
  hiCtx.fillStyle = '#FFE600';
  hiCtx.font = 'bold 24px monospace';
  hiCtx.textAlign = 'center';
  hiCtx.textBaseline = 'middle';
  hiCtx.fillText('KILOWASH 24H', hiSize * 0.5, hiSize * 0.865);

  const lowSize = 220;
  const lowCanvas = document.createElement('canvas');
  lowCanvas.width = lowSize;
  lowCanvas.height = lowSize;
  const lowCtx = lowCanvas.getContext('2d');
  if (!lowCtx) throw new Error('Canvas 2D context is unavailable.');
  lowCtx.filter = 'blur(1.4px)';
  lowCtx.drawImage(hiCanvas, 0, 0, lowSize, lowSize);

  const blob = await new Promise<Blob>((resolve, reject) => {
    lowCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to build blurry sample JPEG.'))),
      'image/jpeg',
      0.22
    );
  });

  return new File([blob], 'sample-blurry-220px.jpg', { type: 'image/jpeg' });
}
