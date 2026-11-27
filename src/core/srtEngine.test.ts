import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCfrFrameTimestamps,
  buildFrameScheduleFromPages,
  cleanWatermarkCues,
  computeKenBurnsTransform,
  detectAudioStrategy,
  formatMsToSrtTimecode,
  getActiveCaptionFromPages,
  groupSrtCuesIntoPages,
  isWatermarkText,
  isWordByWordSrt,
  parseSrt,
  serializeSrt,
} from './srtEngine';
import {
  CAPTION_ANIMATIONS,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_DEMO_SRT,
  getOutputDimensions,
} from './types';
import { computeCaptionAnimationCacheKey } from '../gl/captionTextureRenderer';

test('parseSrt handles standard SRT blocks, CRLF, multiline text, and strips HTML tags', () => {
  const raw =
    '\uFEFF1\r\n00:00:01,250 --> 00:00:04,500\r\n<b>Hello</b> world\r\nsecond line\r\n\r\n' +
    '2\r\n00:00:05.000 --> 00:00:08.000\r\nDot milliseconds work too\r\n\r\n' +
    'malformed block without timestamps';

  const cues = parseSrt(raw);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1250);
  assert.equal(cues[0].endMs, 4500);
  assert.equal(cues[0].text, 'Hello world\nsecond line');
  assert.equal(cues[1].startMs, 5000);
  assert.equal(cues[1].endMs, 8000);
});

test('serializeSrt round-trips parsed word-by-word cues losslessly', () => {
  const parsed = parseSrt(DEFAULT_DEMO_SRT);
  assert.equal(parsed.length, 24);
  assert.equal(isWordByWordSrt(parsed), true);

  const serialized = serializeSrt(parsed);
  const reparsed = parseSrt(serialized);
  assert.equal(reparsed.length, parsed.length);
  for (let i = 0; i < parsed.length; i++) {
    assert.equal(reparsed[i].startMs, parsed[i].startMs);
    assert.equal(reparsed[i].endMs, parsed[i].endMs);
    assert.equal(reparsed[i].text, parsed[i].text);
  }
  assert.equal(formatMsToSrtTimecode(3723045), '01:02:03,045');
});

test('groupSrtCuesIntoPages groups up to 100 words and breaks early on >0.9s natural pause', () => {
  const parsed = parseSrt(DEFAULT_DEMO_SRT);
  const pages6 = groupSrtCuesIntoPages(parsed, 6);
  assert.equal(pages6.length, 5);
  assert.equal(pages6[0].words.length, 6);
  assert.equal(pages6[1].words.length, 5);
  assert.equal(pages6[2].words.length, 6);
  assert.equal(pages6[3].words.length, 2);
  assert.equal(pages6[4].words.length, 5);
  assert.equal(pages6[0].hasExactWordTimestamps, true);

  const pages10 = groupSrtCuesIntoPages(parsed, 10);
  assert.equal(pages10.length, 4);
  assert.equal(pages10[0].words.length, 10);
  assert.equal(pages10[1].words.length, 1);
  assert.equal(pages10[2].words.length, 8);
  assert.equal(pages10[3].words.length, 5);

  // Verify up to 100 consecutive words without pause are grouped into a single 100-word page
  const hundredCues = Array.from({ length: 100 }, (_, idx) => ({
    id: `c-${idx + 1}`,
    index: idx + 1,
    startMs: idx * 200,
    endMs: idx * 200 + 180,
    text: `word${idx + 1}`,
  }));
  const pages85 = groupSrtCuesIntoPages(hundredCues, 85);
  assert.equal(pages85.length, 2);
  assert.equal(pages85[0].words.length, 85);
  assert.equal(pages85[1].words.length, 15);
});

test('getActiveCaptionFromPages highlights exact original word timestamps and supports wordSyncOffsetMs', () => {
  const raw = [
    { id: 'w1', index: 1, startMs: 1000, endMs: 1200, text: 'Fast' },
    { id: 'w2', index: 2, startMs: 1250, endMs: 3500, text: 'drawn-out' },
    { id: 'w3', index: 3, startMs: 3550, endMs: 3800, text: 'end' },
  ];
  const pages = groupSrtCuesIntoPages(raw, 6);
  assert.equal(pages.length, 1);

  assert.equal(getActiveCaptionFromPages(pages, 1150, true, false).activeWordIndex, 0);
  assert.equal(getActiveCaptionFromPages(pages, 1220, true, false).activeWordIndex, 0);
  assert.equal(getActiveCaptionFromPages(pages, 3400, true, false).activeWordIndex, 1);
  assert.equal(getActiveCaptionFromPages(pages, 3600, true, true).activeWordIndex, 2);
  assert.equal(getActiveCaptionFromPages(pages, 3600, true, true).words[2].text, 'END');

  // At 1150ms, +150ms sync offset advances effective sample time to 1300ms (word index 1)
  assert.equal(getActiveCaptionFromPages(pages, 1150, true, false, 150).activeWordIndex, 1);
});

test('cleanWatermarkCues strips TurboScribe, Otter.ai, and transcription watermarks cleanly', () => {
  const cues = [
    {
      id: 'wm-1',
      index: 1,
      startMs: 0,
      endMs: 900,
      text: '(Transcribed by TurboScribe.ai. Go Unlimited to remove this message.)',
    },
    { id: 'w-2', index: 2, startMs: 1000, endMs: 1400, text: 'Welcome' },
    { id: 'w-3', index: 3, startMs: 1400, endMs: 1800, text: 'everyone' },
    { id: 'wm-2', index: 4, startMs: 1900, endMs: 2200, text: 'Transcribed by Otter.ai' },
  ];

  assert.equal(isWatermarkText(cues[0].text), true);
  assert.equal(isWatermarkText(cues[1].text), false);

  const result = cleanWatermarkCues(cues);
  assert.equal(result.removedCount, 2);
  assert.equal(result.cleaned.length, 2);
  assert.equal(result.cleaned[0].index, 1);
  assert.equal(result.cleaned[0].text, 'Welcome');
  assert.equal(result.cleaned[1].index, 2);
  assert.equal(result.cleaned[1].text, 'everyone');
});

test('buildCfrFrameTimestamps emits monotonic CFR timestamps for 15fps, 24fps, and 30fps', () => {
  const frames15 = buildCfrFrameTimestamps(6000, 15);
  assert.equal(frames15.length, 90);
  assert.equal(frames15[0].keyFrame, true);
  assert.equal(frames15[30].keyFrame, true); // 2.0s keyframe at 15fps

  const frames24 = buildCfrFrameTimestamps(6000, 24);
  assert.equal(frames24.length, 144);
  assert.equal(frames24[0].timestampUs, 0);
  assert.equal(frames24[0].durationUs, Math.round(1_000_000 / 24));
  assert.equal(frames24[0].keyFrame, true);
  assert.equal(frames24[48].keyFrame, true); // 2.0s keyframe at 24fps
  assert.equal(frames24[47].keyFrame, false);

  for (let i = 1; i < frames24.length; i++) {
    assert.ok(frames24[i].timestampUs > frames24[i - 1].timestampUs);
    assert.equal(frames24[i].timestampUs, Math.round(i * (1_000_000 / 24)));
  }

  // Verify short 80ms words ("to", "a", "in") are NEVER skipped by 24fps mid-frame sampling
  const shortWordCues = [
    { id: 's1', index: 1, startMs: 500, endMs: 700, text: 'Go' },
    { id: 's2', index: 2, startMs: 700, endMs: 780, text: 'to' },
    { id: 's3', index: 3, startMs: 780, endMs: 860, text: 'a' },
    { id: 's4', index: 4, startMs: 860, endMs: 1200, text: 'studio' },
  ];
  const pages = groupSrtCuesIntoPages(shortWordCues, 6);
  const seenWordIndices = new Set<number>();
  for (const f of frames24) {
    const active = getActiveCaptionFromPages(pages, f.sampleTimeMs, true, false);
    if (active.activeWordIndex >= 0) {
      seenWordIndices.add(active.activeWordIndex);
    }
  }
  assert.deepEqual(Array.from(seenWordIndices).sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('buildFrameScheduleFromPages uses True CFR mode for 15fps, 24fps, and 30fps', () => {
  const pages = groupSrtCuesIntoPages(parseSrt(DEFAULT_DEMO_SRT), 6);
  const cfr15 = buildFrameScheduleFromPages(pages, 10000, false, true, 15);
  assert.equal(cfr15.mode, 'cfr');
  assert.equal(cfr15.fps, 15);
  assert.equal(cfr15.frames.length, 150);

  const cfr24 = buildFrameScheduleFromPages(pages, 10000, false, true, 24);
  assert.equal(cfr24.mode, 'cfr');
  assert.equal(cfr24.fps, 24);
  assert.equal(cfr24.frames.length, 240);

  const cfr30 = buildFrameScheduleFromPages(pages, 10000, true, true, 30);
  assert.equal(cfr30.mode, 'cfr');
  assert.equal(cfr30.fps, 30);
  assert.equal(cfr30.frames.length, 300);
});

test('getOutputDimensions scales 16:9, 9:16, and 1:1 across 1080p, 720p, 540p, 480p, and 360p with even dimensions', () => {
  const d1080 = getOutputDimensions('16:9', '1080p');
  assert.equal(d1080.width, 1920);
  assert.equal(d1080.height, 1080);

  const d720 = getOutputDimensions('16:9', '720p');
  assert.equal(d720.width, 1280);
  assert.equal(d720.height, 720);

  const v720 = getOutputDimensions('9:16', '720p');
  assert.equal(v720.width, 720);
  assert.equal(v720.height, 1280);

  const sq540 = getOutputDimensions('1:1', '540p');
  assert.equal(sq540.width, 540);
  assert.equal(sq540.height, 540);

  const d480 = getOutputDimensions('16:9', '480p');
  assert.equal(d480.width, 854);
  assert.equal(d480.height, 480);

  const d360 = getOutputDimensions('16:9', '360p');
  assert.equal(d360.width, 640);
  assert.equal(d360.height, 360);
});

test('CAPTION_ANIMATIONS contains all 20 animations and computeCaptionAnimationCacheKey settles after transition', () => {
  assert.equal(CAPTION_ANIMATIONS.length, 20);
  const pages = groupSrtCuesIntoPages(parseSrt(DEFAULT_DEMO_SRT), 6);
  const active = getActiveCaptionFromPages(pages, 1850, true, false);
  // Word index 3 ("3.0") started at 1600ms; at 1850ms (250ms elapsed > 200ms), word-scale settles to W_SETTLED_3
  const settledKey = computeCaptionAnimationCacheKey(active, DEFAULT_CAPTION_STYLE, 1850);
  assert.equal(settledKey, 'W_SETTLED_3');
});

test('detectAudioStrategy selects pass-through for .m4a/.aac and PCM->AAC-LC for .mp3/.wav/.ogg', () => {
  assert.equal(detectAudioStrategy('voiceover.m4a').mode, 'pass-through');
  assert.equal(detectAudioStrategy('clip.AAC').mode, 'pass-through');
  assert.equal(detectAudioStrategy('podcast.mp3').mode, 'transcode-aac');
  assert.equal(detectAudioStrategy('studio.wav').mode, 'transcode-aac');
  assert.equal(detectAudioStrategy('note.ogg').mode, 'transcode-aac');
  assert.equal(detectAudioStrategy('studio.wav').targetBitrateKbps, 128);
});

test('computeKenBurnsTransform stays identity when disabled and zooms smoothly to 1.12x when enabled', () => {
  const off = computeKenBurnsTransform(5000, 10000, false);
  assert.equal(off.scale, 1.0);
  assert.equal(off.offsetX, 0);

  const start = computeKenBurnsTransform(0, 10000, true);
  const end = computeKenBurnsTransform(10000, 10000, true);
  assert.equal(start.scale, 1.0);
  assert.ok(Math.abs(end.scale - 1.12) < 1e-6);
});
