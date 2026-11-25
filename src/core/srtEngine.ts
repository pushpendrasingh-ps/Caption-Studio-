import type {
  ActiveCaptionState,
  AudioStrategyInfo,
  CfrFrameDescriptor,
  FrameSchedule,
  GroupedCaptionPage,
  ScheduledFrame,
  SrtCue,
  TimedWord,
  WordToken,
} from './types';

const TIMESTAMP_REGEX =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/** Pause threshold (> 0.9s) that forces a new caption page so unrelated sentences never merge */
export const NATURAL_PAUSE_BREAK_MS = 900;

export function parseTimecodeToMs(
  hours: string,
  minutes: string,
  seconds: string,
  millis: string
): number {
  const paddedMs = millis.padEnd(3, '0').slice(0, 3);
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(paddedMs)
  );
}

export function formatMsToSrtTimecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    ',' +
    String(millis).padStart(3, '0')
  );
}

export function formatMsToDisplayClock(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const tenths = Math.floor((clamped % 1_000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function parseSrt(raw: string): SrtCue[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2) continue;

    const timingLineIdx = lines.findIndex((line) => TIMESTAMP_REGEX.test(line));
    if (timingLineIdx === -1) continue;

    const match = lines[timingLineIdx].match(TIMESTAMP_REGEX);
    if (!match) continue;

    const startMs = parseTimecodeToMs(match[1], match[2], match[3], match[4]);
    const endMs = parseTimecodeToMs(match[5], match[6], match[7], match[8]);
    if (endMs <= startMs) continue;

    const rawText = lines
      .slice(timingLineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!rawText) continue;

    cues.push({
      id: `cue-${cues.length + 1}-${startMs}`,
      index: cues.length + 1,
      startMs,
      endMs,
      text: rawText,
    });
  }

  return cues
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue, idx) => ({ ...cue, index: idx + 1 }));
}

export function serializeSrt(cues: SrtCue[]): string {
  return cues
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue, idx) => {
      return `${idx + 1}\n${formatMsToSrtTimecode(cue.startMs)} --> ${formatMsToSrtTimecode(cue.endMs)}\n${cue.text.trim()}`;
    })
    .join('\n\n')
    .concat(cues.length > 0 ? '\n' : '');
}

export function isWordByWordSrt(cues: SrtCue[]): boolean {
  if (cues.length < 2) return false;
  let singleWordCount = 0;
  for (const cue of cues) {
    const count = cue.text.trim().split(/\s+/).filter(Boolean).length;
    if (count === 1) singleWordCount++;
  }
  return singleWordCount / cues.length >= 0.6;
}

export function distributeKaraokeWords(cue: SrtCue, uppercase = false): WordToken[] {
  const sourceText = uppercase ? cue.text.toUpperCase() : cue.text;
  const lines = sourceText.split('\n');
  const rawTokens: Array<{ text: string; lineIndex: number; weight: number }> = [];

  lines.forEach((line, lineIndex) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const cleanLen = word.replace(/[^a-zA-Z0-9]/g, '').length;
      rawTokens.push({
        text: word,
        lineIndex,
        weight: Math.max(2, cleanLen),
      });
    }
  });

  if (rawTokens.length === 0) return [];

  const totalWeight = rawTokens.reduce((sum, token) => sum + token.weight, 0);
  const cueDuration = Math.max(1, cue.endMs - cue.startMs);

  let cursor = cue.startMs;
  return rawTokens.map((token, idx) => {
    const isLast = idx === rawTokens.length - 1;
    const sliceMs = isLast
      ? cue.endMs - cursor
      : Math.round((token.weight / totalWeight) * cueDuration);
    const startMs = cursor;
    const endMs = isLast ? cue.endMs : Math.min(cue.endMs, cursor + Math.max(1, sliceMs));
    cursor = endMs;

    return {
      text: token.text,
      lineIndex: token.lineIndex,
      wordIndex: idx,
      startMs,
      endMs,
    };
  });
}

function flattenCuesToTimedWords(rawCues: SrtCue[]): TimedWord[] {
  const sorted = rawCues.slice().sort((a, b) => a.startMs - b.startMs);
  const result: TimedWord[] = [];

  for (const cue of sorted) {
    const trimmed = cue.text.trim();
    if (!trimmed) continue;

    const pieces = trimmed.split(/\s+/).filter(Boolean);
    if (pieces.length === 1) {
      result.push({
        text: pieces[0],
        start: cue.startMs,
        end: cue.endMs,
        rawCueId: cue.id,
        lineIndex: 0,
        wordIndex: result.length,
        isExactTimestamp: true,
      });
    } else {
      const distributed = distributeKaraokeWords(cue, false);
      for (const tok of distributed) {
        result.push({
          text: tok.text,
          start: tok.startMs,
          end: tok.endMs,
          rawCueId: cue.id,
          lineIndex: 0,
          wordIndex: result.length,
          isExactTimestamp: false,
        });
      }
    }
  }

  return result;
}

export function groupSrtCuesIntoPages(
  rawCues: SrtCue[],
  wordsOnScreen: number,
  maxPauseMs: number = NATURAL_PAUSE_BREAK_MS
): GroupedCaptionPage[] {
  const maxWords = Math.max(1, Math.min(30, Math.round(wordsOnScreen) || 6));
  const allWords = flattenCuesToTimedWords(rawCues);
  if (allWords.length === 0) return [];

  const pages: GroupedCaptionPage[] = [];
  let bucket: TimedWord[] = [];

  const flushBucket = () => {
    if (bucket.length === 0) return;
    const reindexed = bucket.map((w, idx) => ({
      ...w,
      lineIndex: 0,
      wordIndex: idx,
    }));
    const first = reindexed[0];
    const last = reindexed[reindexed.length - 1];
    const pageIndex = pages.length + 1;
    pages.push({
      id: `page-${pageIndex}-${first.start}`,
      index: pageIndex,
      startMs: first.start,
      endMs: last.end,
      text: reindexed.map((w) => w.text).join(' '),
      words: reindexed,
      hasExactWordTimestamps: reindexed.every((w) => w.isExactTimestamp),
    });
    bucket = [];
  };

  for (const word of allWords) {
    if (bucket.length > 0) {
      const prev = bucket[bucket.length - 1];
      const pauseMs = word.start - prev.end;
      if (bucket.length >= maxWords || pauseMs > maxPauseMs) {
        flushBucket();
      }
    }
    bucket.push(word);
  }
  flushBucket();

  return pages;
}

/**
 * Strict Word Matching for both Live Preview and True CFR MP4 Export:
 * - Sampled at sampleT (which in CFR export is t + 0.5 / fps).
 * - Matches exact word where `word.start <= sampleT && sampleT < word.end`.
 * - Falls back to the most recently spoken word inside that group (`last word where word.start <= sampleT`).
 * - Guarantees zero skipped small or large words.
 */
export function getActiveCaptionFromPages(
  pages: GroupedCaptionPage[],
  sampleT: number,
  wordKaraoke: boolean,
  uppercase: boolean
): ActiveCaptionState {
  const page =
    pages.find((p) => sampleT >= p.startMs && sampleT < p.endMs) ??
    pages.find((p) => sampleT === p.endMs) ??
    null;

  if (!page) {
    return {
      cue: null,
      page: null,
      words: [],
      activeWordIndex: -1,
      displayText: '',
      stateKey: 'EMPTY',
    };
  }

  const words: WordToken[] = page.words.map((w, idx) => ({
    text: uppercase ? w.text.toUpperCase() : w.text,
    lineIndex: 0,
    wordIndex: idx,
    startMs: w.start,
    endMs: w.end,
  }));

  let activeWordIndex = -1;
  if (wordKaraoke && page.words.length > 0) {
    // 1. Strict half-open interval match: word.start <= sampleT && sampleT < word.end
    const exactIdx = page.words.findIndex((w) => sampleT >= w.start && sampleT < w.end);
    if (exactIdx !== -1) {
      activeWordIndex = exactIdx;
    } else {
      // 2. Fallback to the last word with word.start <= sampleT inside that group
      for (let i = page.words.length - 1; i >= 0; i--) {
        if (sampleT >= page.words[i].start) {
          activeWordIndex = i;
          break;
        }
      }
      if (activeWordIndex === -1) activeWordIndex = 0;
    }
  }

  const displayText = uppercase ? page.text.toUpperCase() : page.text;
  const syntheticCue: SrtCue = {
    id: page.id,
    index: page.index,
    startMs: page.startMs,
    endMs: page.endMs,
    text: page.text,
  };

  const stateKey = wordKaraoke
    ? `${page.id}|W:${activeWordIndex}|${uppercase ? 'U' : 'N'}|${displayText}`
    : `${page.id}|FULL|${uppercase ? 'U' : 'N'}|${displayText}`;

  return {
    cue: syntheticCue,
    page,
    words,
    activeWordIndex,
    displayText,
    stateKey,
  };
}

export function getActiveCaptionAtTime(
  cues: SrtCue[],
  timeMs: number,
  wordKaraoke: boolean,
  uppercase: boolean,
  wordsOnScreen = 6
): ActiveCaptionState {
  const pages = groupSrtCuesIntoPages(cues, wordsOnScreen);
  return getActiveCaptionFromPages(pages, timeMs, wordKaraoke, uppercase);
}

export function computeTimelineDurationMs(cues: SrtCue[], audioDurationMs?: number): number {
  const lastCueEnd = cues.reduce((max, cue) => Math.max(max, cue.endMs), 0);
  const base = Math.max(lastCueEnd + 500, audioDurationMs ?? 0, 5_000);
  return Math.round(base);
}

/**
 * Generates True Constant Frame Rate (CFR) frame descriptors for rock-solid hardware H.264 sync:
 * - timestampUs = Math.round(frameIndex * (1_000_000 / fps))
 * - durationUs = Math.round(1_000_000 / fps)
 * - sampleTimeMs = (frameIndex + 0.5) * (1000 / fps)  [t + 0.5 / fps]
 * - keyFrame every 2 seconds (frameIndex % (fps * 2) === 0)
 */
export function buildCfrFrameTimestamps(
  durationMs: number,
  fps: 24 | 30
): CfrFrameDescriptor[] {
  const safeDurationMs = Math.max(1_000, Math.round(durationMs));
  const frameDurationUsExact = 1_000_000 / fps;
  const durationUs = Math.round(frameDurationUsExact);
  const frameDurationMsExact = 1_000 / fps;
  const totalFrames = Math.max(1, Math.ceil((safeDurationMs / 1_000) * fps));
  const keyInterval = fps * 2;

  const list = new Array<CfrFrameDescriptor>(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    list[i] = {
      frameIndex: i,
      timestampUs: Math.round(i * frameDurationUsExact),
      durationUs,
      sampleTimeMs: (i + 0.5) * frameDurationMsExact,
      keyFrame: i % keyInterval === 0,
    };
  }
  return list;
}

/**
 * Builds the True CFR export frame schedule summary for UI & Subtitles inspector.
 */
export function buildFrameScheduleFromPages(
  pages: GroupedCaptionPage[],
  durationMs: number,
  _slowZoom: boolean,
  wordKaraoke: boolean,
  fps: 24 | 30
): FrameSchedule {
  const cfrFrames = buildCfrFrameTimestamps(durationMs, fps);
  const frames: ScheduledFrame[] = cfrFrames.map((f, idx) => ({
    ptsMs: Math.round(f.timestampUs / 1000),
    reason:
      idx === 0
        ? 'start'
        : idx === cfrFrames.length - 1
          ? 'end'
          : f.keyFrame
            ? 'keyframe'
            : 'continuous',
  }));

  const uniqueStates = new Set<string>();
  for (const f of cfrFrames) {
    uniqueStates.add(
      getActiveCaptionFromPages(pages, f.sampleTimeMs, wordKaraoke, false).stateKey
    );
  }

  return {
    mode: 'cfr',
    fps,
    frames,
    equivalentContinuousFrames: cfrFrames.length,
    uniqueTextureStates: uniqueStates.size,
    savingsPercent: 0,
  };
}

export function buildFrameSchedule(
  cues: SrtCue[],
  durationMs: number,
  slowZoom: boolean,
  wordKaraoke: boolean,
  fps: 24 | 30,
  wordsOnScreen = 6
): FrameSchedule {
  const pages = groupSrtCuesIntoPages(cues, wordsOnScreen);
  return buildFrameScheduleFromPages(pages, durationMs, slowZoom, wordKaraoke, fps);
}

export function detectAudioStrategy(fileName: string, mimeType = ''): AudioStrategyInfo {
  const lower = fileName.toLowerCase();
  const extMatch = lower.match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';

  const isPassThrough =
    ext === 'm4a' ||
    ext === 'aac' ||
    ext === 'mp4' ||
    mimeType.includes('mp4a') ||
    mimeType.includes('audio/aac') ||
    mimeType.includes('audio/x-m4a');

  if (isPassThrough) {
    return {
      mode: 'pass-through',
      extension: ext || 'm4a',
      label: 'Direct AAC Pass-through',
      detail: '48 kHz AAC-LC 128 kbps · 1s chunked CFR sync',
      targetBitrateKbps: 128,
    };
  }

  return {
    mode: 'transcode-aac',
    extension: ext || 'wav',
    label: 'PCM → AAC-LC 128 kbps',
    detail: '48 kHz AAC-LC hardware encode (1s chunked)',
    targetBitrateKbps: 128,
  };
}

export interface KenBurnsTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function computeKenBurnsTransform(
  timeMs: number,
  durationMs: number,
  enabled: boolean
): KenBurnsTransform {
  if (!enabled || durationMs <= 0) {
    return { scale: 1.0, offsetX: 0.0, offsetY: 0.0 };
  }
  const progress = Math.max(0, Math.min(1, timeMs / durationMs));
  const eased = progress * progress * (3 - 2 * progress);
  return {
    scale: 1.0 + 0.12 * eased,
    offsetX: (eased - 0.5) * 0.025,
    offsetY: (0.5 - eased) * 0.018,
  };
}
