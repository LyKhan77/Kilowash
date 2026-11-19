import type { WashProgress } from '../types/laundry';

type LoopMode = 'fill' | 'wash' | 'rinse' | 'spin';

interface ActiveLoop {
  mode: LoopMode;
  masterGain: GainNode;
  stopNodes: Array<{ stop: (when?: number) => void; disconnect: () => void }>;
  allNodes: AudioNode[];
}

let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = false;
let activeLoop: ActiveLoop | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      /* ignore autoplay restriction before first gesture */
    });
  }
  return audioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function stopActiveLoopImmediate(fadeSec = 0.08): void {
  if (!activeLoop) return;
  const loop = activeLoop;
  activeLoop = null;

  const ctx = audioCtx;
  if (!ctx) return;

  const now = ctx.currentTime;
  try {
    loop.masterGain.gain.cancelScheduledValues(now);
    loop.masterGain.gain.setValueAtTime(loop.masterGain.gain.value, now);
    loop.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
  } catch {
    /* ignore gain ramp errors */
  }

  const cleanupDelayMs = Math.round((fadeSec + 0.04) * 1000);
  setTimeout(() => {
    for (const n of loop.stopNodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const node of loop.allNodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }, cleanupDelayMs);
}

export function setSfxMuted(nextMuted: boolean): void {
  muted = nextMuted;
  if (muted) {
    stopActiveLoopImmediate(0.04);
  }
}

export function isSfxMuted(): boolean {
  return muted;
}

/**
 * Crisp 30ms tactile button / valve switch click.
 */
export function playMechanicalClick(freq = 680): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.45), now + 0.03);

  gain.gain.setValueAtTime(0.09, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.035);
}

/**
 * Soft band-passed noise hiss for the drying-line touch-up brush (one short burst per stroke).
 */
export function playBrushHiss(durationSec = 0.14): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(2600, now);
  band.Q.setValueAtTime(1.1, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

  source.connect(band);
  band.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + durationSec + 0.02);
}

/**
 * Heavy rotary program dial detent click (220Hz + 880Hz).
 */
export function playRotaryDialTick(): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const low = ctx.createOscillator();
  const high = ctx.createOscillator();
  const gain = ctx.createGain();

  low.type = 'sine';
  low.frequency.setValueAtTime(220, now);
  low.frequency.exponentialRampToValueAtTime(110, now + 0.045);

  high.type = 'square';
  high.frequency.setValueAtTime(880, now);
  high.frequency.exponentialRampToValueAtTime(440, now + 0.025);

  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

  low.connect(gain);
  high.connect(gain);
  gain.connect(ctx.destination);

  low.start(now);
  high.start(now);
  low.stop(now + 0.05);
  high.stop(now + 0.05);
}

/**
 * Front-load washer door lock / load clunk (140Hz -> 52Hz thud + metallic click).
 */
export function playDoorLatch(): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(140, now);
  thud.frequency.exponentialRampToValueAtTime(52, now + 0.12);
  thudGain.gain.setValueAtTime(0.16, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  thud.connect(thudGain);
  thudGain.connect(ctx.destination);
  thud.start(now);
  thud.stop(now + 0.14);

  const latch = ctx.createOscillator();
  const latchGain = ctx.createGain();
  latch.type = 'triangle';
  latch.frequency.setValueAtTime(980, now + 0.02);
  latch.frequency.exponentialRampToValueAtTime(410, now + 0.055);
  latchGain.gain.setValueAtTime(0.07, now + 0.02);
  latchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  latch.connect(latchGain);
  latchGain.connect(ctx.destination);
  latch.start(now + 0.02);
  latch.stop(now + 0.065);
}

/**
 * Pleasant 4-note completion bell chime (C5 - E5 - G5 - C6).
 */
export function playCycleCompleteChime(): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99, 1046.5];
  const base = ctx.currentTime;

  notes.forEach((freq, idx) => {
    const t = base + idx * 0.085;
    const osc = ctx.createOscillator();
    const harm = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);

    harm.type = 'triangle';
    harm.frequency.setValueAtTime(freq * 2, t);

    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(0.2, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.11, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);

    osc.connect(gain);
    harm.connect(harmGain);
    harmGain.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    harm.start(t);
    osc.stop(t + 0.38);
    harm.stop(t + 0.38);
  });
}

function mapPhaseToLoopMode(phase: WashProgress['phase']): LoopMode | null {
  switch (phase) {
    case 'filling':
      return 'fill';
    case 'loading-model':
    case 'extracting':
    case 'washing':
      return 'wash';
    case 'rinsing':
      return 'rinse';
    case 'spinning':
    case 'encoding':
      return 'spin';
    default:
      return null;
  }
}

function startLoopForMode(mode: LoopMode): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.connect(ctx.destination);

  const stopNodes: ActiveLoop['stopNodes'] = [];
  const allNodes: AudioNode[] = [masterGain];

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  noise.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';

  noise.connect(filter);
  filter.connect(masterGain);
  noise.start(now);
  stopNodes.push(noise);
  allNodes.push(noise, filter);

  if (mode === 'fill') {
    masterGain.gain.linearRampToValueAtTime(0.09, now + 0.14);
    filter.Q.setValueAtTime(1.6, now);
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.linearRampToValueAtTime(1350, now + 1.0);
  } else if (mode === 'wash') {
    masterGain.gain.linearRampToValueAtTime(0.08, now + 0.12);
    filter.Q.setValueAtTime(2.2, now);
    filter.frequency.setValueAtTime(520, now);

    // 0.75 Hz rhythmic water slosh LFO
    const sloshLfo = ctx.createOscillator();
    const sloshDepth = ctx.createGain();
    sloshLfo.type = 'sine';
    sloshLfo.frequency.setValueAtTime(0.75, now);
    sloshDepth.gain.setValueAtTime(300, now);
    sloshLfo.connect(sloshDepth);
    sloshDepth.connect(filter.frequency);
    sloshLfo.start(now);

    // Low motor agitation hum
    const motor = ctx.createOscillator();
    const motorGain = ctx.createGain();
    const motorLfo = ctx.createOscillator();
    const motorLfoDepth = ctx.createGain();

    motor.type = 'triangle';
    motor.frequency.setValueAtTime(110, now);
    motorGain.gain.setValueAtTime(0.24, now);

    motorLfo.type = 'sine';
    motorLfo.frequency.setValueAtTime(0.75, now);
    motorLfoDepth.gain.setValueAtTime(16, now);
    motorLfo.connect(motorLfoDepth);
    motorLfoDepth.connect(motor.frequency);

    motor.connect(motorGain);
    motorGain.connect(masterGain);
    motor.start(now);
    motorLfo.start(now);

    stopNodes.push(sloshLfo, motor, motorLfo);
    allNodes.push(sloshLfo, sloshDepth, motor, motorGain, motorLfo, motorLfoDepth);
  } else if (mode === 'rinse') {
    masterGain.gain.linearRampToValueAtTime(0.085, now + 0.1);
    filter.Q.setValueAtTime(1.8, now);
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + 1.1);
  } else if (mode === 'spin') {
    masterGain.gain.linearRampToValueAtTime(0.075, now + 0.15);
    filter.Q.setValueAtTime(1.4, now);
    filter.frequency.setValueAtTime(620, now);

    // 10 Hz fast rotation air whoosh modulation
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.65, now);
    const whooshLfo = ctx.createOscillator();
    const whooshDepth = ctx.createGain();
    whooshLfo.type = 'sine';
    whooshLfo.frequency.setValueAtTime(10, now);
    whooshDepth.gain.setValueAtTime(0.25, now);
    whooshLfo.connect(whooshDepth);
    whooshDepth.connect(noiseGain.gain);
    whooshLfo.start(now);

    filter.disconnect();
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);

    // Rising centrifuge turbine whine
    const turbine = ctx.createOscillator();
    const turbineGain = ctx.createGain();
    turbine.type = 'sawtooth';
    turbine.frequency.setValueAtTime(140, now);
    turbine.frequency.exponentialRampToValueAtTime(440, now + 1.4);

    const turbineFilter = ctx.createBiquadFilter();
    turbineFilter.type = 'lowpass';
    turbineFilter.frequency.setValueAtTime(900, now);

    turbineGain.gain.setValueAtTime(0.18, now);
    turbine.connect(turbineFilter);
    turbineFilter.connect(turbineGain);
    turbineGain.connect(masterGain);
    turbine.start(now);

    stopNodes.push(whooshLfo, turbine);
    allNodes.push(noiseGain, whooshLfo, whooshDepth, turbine, turbineFilter, turbineGain);
  }

  activeLoop = {
    mode,
    masterGain,
    stopNodes,
    allNodes,
  };
}

/**
 * Synchronizes procedural background audio loop to the active washing/spinning stage.
 */
export function syncWashPhaseLoop(phase: WashProgress['phase']): void {
  if (muted) {
    stopActiveLoopImmediate(0.04);
    return;
  }

  const nextMode = mapPhaseToLoopMode(phase);
  if (!nextMode) {
    stopActiveLoopImmediate(0.1);
    return;
  }

  if (activeLoop?.mode === nextMode) {
    return;
  }

  stopActiveLoopImmediate(0.07);
  startLoopForMode(nextMode);
}
