import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDemoVoiceEnvelope,
  computeAudioEnvelopeFromPcm,
  sampleEnvelopeBars,
} from './audioEnvelope';
import { groupSrtCuesIntoPages, parseSrt } from './srtEngine';
import { DEFAULT_DEMO_SRT } from './types';

test('computeAudioEnvelopeFromPcm gates silent PCM strictly to 0.0 and rises for active vocal tones', () => {
  const sampleRate = 48_000;
  // 2 seconds total: 0.0-1.0s complete silence, 1.0-2.0s 440Hz + 1200Hz voice-like tone
  const pcm = new Float32Array(sampleRate * 2);
  for (let i = sampleRate; i < sampleRate * 2; i++) {
    const t = i / sampleRate;
    pcm[i] = 0.45 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 1200 * t);
  }

  const env = computeAudioEnvelopeFromPcm(pcm, sampleRate);
  assert.equal(env.isRealAudio, true);
  assert.equal(env.bandCount, 48);

  // Silent region (0.4s): every bar MUST be exact 0.0
  const silentBars = sampleEnvelopeBars(env, 400, 42, 1.0, false);
  const maxSilent = Math.max(...silentBars);
  assert.equal(maxSilent, 0, `Expected flat 0 in silence, got ${maxSilent}`);

  // Active region (1.5s): bars MUST rise clearly above 0
  const activeBars = sampleEnvelopeBars(env, 1500, 42, 1.0, false);
  const maxActive = Math.max(...activeBars);
  assert.ok(maxActive > 0.35, `Expected strong active energy, got ${maxActive}`);

  // When paused (forceSilent = true), even active audio timestamp MUST return flat 0.0
  const pausedBars = sampleEnvelopeBars(env, 1500, 42, 1.0, true);
  assert.equal(Math.max(...pausedBars), 0);
});

test('buildDemoVoiceEnvelope rises during spoken SRT words and drops to exact 0.0 in pauses', () => {
  const pages = groupSrtCuesIntoPages(parseSrt(DEFAULT_DEMO_SRT), 6);
  const env = buildDemoVoiceEnvelope(pages, 14_700);
  assert.equal(env.isRealAudio, false);

  // Inside spoken word ("Zero-copy": 300..760ms) -> active energy
  const speakingBars = sampleEnvelopeBars(env, 520, 42, 1.0, false);
  assert.ok(Math.max(...speakingBars) > 0.2);

  // Inside sentence pause (5.8s is between 5.36s and 6.45s) -> exact 0.0 flat baseline
  const pauseBars = sampleEnvelopeBars(env, 5800, 42, 1.0, false);
  assert.equal(Math.max(...pauseBars), 0);
});
