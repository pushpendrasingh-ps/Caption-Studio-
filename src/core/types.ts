export type AspectRatioId = '16:9' | '9:16' | '1:1';

export type ResolutionId = '1080p' | '720p' | '540p' | '480p' | '360p';

export interface ResolutionOption {
  id: ResolutionId;
  label: string;
  shortEdge: number;
  longEdge16x9: number;
  hint: string;
}

export const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { id: '1080p', label: '1080p Full HD', shortEdge: 1080, longEdge16x9: 1920, hint: 'Master 1080p' },
  { id: '720p', label: '720p Fast HD', shortEdge: 720, longEdge16x9: 1280, hint: 'Recommended Fast HD' },
  { id: '540p', label: '540p qHD', shortEdge: 540, longEdge16x9: 960, hint: 'Balanced Social' },
  { id: '480p', label: '480p SD', shortEdge: 480, longEdge16x9: 854, hint: 'Compact Mobile' },
  { id: '360p', label: '360p Draft', shortEdge: 360, longEdge16x9: 640, hint: 'Ultra-Fast Preview' },
];

export interface AspectRatioSpec {
  id: AspectRatioId;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: Record<AspectRatioId, AspectRatioSpec> = {
  '16:9': {
    id: '16:9',
    label: '16:9 Landscape',
    shortLabel: '16:9',
    width: 1920,
    height: 1080,
  },
  '9:16': {
    id: '9:16',
    label: '9:16 Vertical',
    shortLabel: '9:16',
    width: 1080,
    height: 1920,
  },
  '1:1': {
    id: '1:1',
    label: '1:1 Square',
    shortLabel: '1:1',
    width: 1080,
    height: 1080,
  },
};

export function getOutputDimensions(
  aspectId: AspectRatioId,
  resolutionId: ResolutionId = '720p'
): AspectRatioSpec {
  const res = RESOLUTION_OPTIONS.find((r) => r.id === resolutionId) ?? RESOLUTION_OPTIONS[1];
  const base = ASPECT_RATIOS[aspectId];
  if (aspectId === '16:9') {
    return { ...base, width: res.longEdge16x9, height: res.shortEdge };
  }
  if (aspectId === '9:16') {
    return { ...base, width: res.shortEdge, height: res.longEdge16x9 };
  }
  return { ...base, width: res.shortEdge, height: res.shortEdge };
}

export type BackgroundFitMode = 'fill' | 'fit';
export type ExportBitrateMbps = 1.2 | 2.0 | 3.5 | 6.0;
export type ExportFps = 15 | 24 | 30;
export type TextAlignMode = 'left' | 'center' | 'right' | 'justify';

export type VocalWaveStyleId =
  | 'bottom-bars'
  | 'mirrored-wave'
  | 'smooth-line'
  | 'dotted-eq'
  | 'neon-spectrum'
  | 'circular-ring';

export interface VocalWaveStyleOption {
  id: VocalWaveStyleId;
  label: string;
}

export const VOCAL_WAVE_STYLES: VocalWaveStyleOption[] = [
  { id: 'bottom-bars', label: 'Bottom Bars' },
  { id: 'mirrored-wave', label: 'Mirrored Wave' },
  { id: 'smooth-line', label: 'Flowing Line' },
  { id: 'dotted-eq', label: 'Dotted EQ' },
  { id: 'neon-spectrum', label: 'Neon Glow' },
  { id: 'circular-ring', label: 'Mic Ring' },
];

export type CaptionAnimationId =
  | 'none'
  | 'word-scale'
  | 'sliding-pill'
  | 'pop-bounce'
  | 'slide-up'
  | 'slide-left'
  | 'fade-in'
  | 'glow-pulse'
  | 'karaoke-sweep'
  | 'underline-slide'
  | 'punch-shake'
  | 'wave-jump'
  | 'blur-in'
  | 'zoom-out'
  | 'flip-3d'
  | 'glitch-flash'
  | 'neon-flicker'
  | 'box-wipe'
  | 'elastic-drop'
  | 'tilt-pop';

export interface CaptionAnimationOption {
  id: CaptionAnimationId;
  label: string;
  shortDesc: string;
}

export const CAPTION_ANIMATIONS: CaptionAnimationOption[] = [
  { id: 'none', label: 'None', shortDesc: 'Instant clean' },
  { id: 'word-scale', label: 'Word Scale', shortDesc: '1.15x spoken pop' },
  { id: 'sliding-pill', label: 'Sliding Pill', shortDesc: 'Gliding highlight box' },
  { id: 'pop-bounce', label: 'Pop Bounce', shortDesc: 'Spring group entry' },
  { id: 'slide-up', label: 'Slide Up', shortDesc: 'Smooth rise reveal' },
  { id: 'slide-left', label: 'Slide Left', shortDesc: 'Horizontal glide in' },
  { id: 'fade-in', label: 'Fade In', shortDesc: 'Soft opacity entry' },
  { id: 'glow-pulse', label: 'Glow Pulse', shortDesc: 'Active word bloom' },
  { id: 'karaoke-sweep', label: 'Karaoke Sweep', shortDesc: 'Progressive fill' },
  { id: 'underline-slide', label: 'Underline', shortDesc: 'Gliding accent bar' },
  { id: 'punch-shake', label: 'Punch Shake', shortDesc: 'Impact micro-shake' },
  { id: 'wave-jump', label: 'Wave Jump', shortDesc: 'Active word hops up' },
  { id: 'blur-in', label: 'Blur-In', shortDesc: 'Soft focus reveal' },
  { id: 'zoom-out', label: 'Zoom-Out', shortDesc: 'Oversize settle in' },
  { id: 'flip-3d', label: '3D Flip-In', shortDesc: 'Perspective card flip' },
  { id: 'glitch-flash', label: 'Glitch Flash', shortDesc: 'RGB cyber snap' },
  { id: 'neon-flicker', label: 'Neon Flicker', shortDesc: 'Electric tube ignition' },
  { id: 'box-wipe', label: 'Box Wipe', shortDesc: 'Left-to-right curtain' },
  { id: 'elastic-drop', label: 'Elastic Drop', shortDesc: 'Gravity drop bounce' },
  { id: 'tilt-pop', label: 'Tilt Pop', shortDesc: 'Playful active word tilt' },
];

export type ProgressBarPosition = 'top' | 'bottom';

export interface SrtCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TimedWord {
  text: string;
  /** Exact original start timestamp in milliseconds */
  start: number;
  /** Exact original end timestamp in milliseconds */
  end: number;
  rawCueId: string;
  lineIndex: number;
  wordIndex: number;
  isExactTimestamp: boolean;
}

export interface GroupedCaptionPage {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  words: TimedWord[];
  hasExactWordTimestamps: boolean;
}

export interface WordToken {
  text: string;
  lineIndex: number;
  wordIndex: number;
  startMs: number;
  endMs: number;
}

export interface ActiveCaptionState {
  cue: SrtCue | null;
  page: GroupedCaptionPage | null;
  words: WordToken[];
  activeWordIndex: number;
  displayText: string;
  /** Deterministic cache key used to skip redundant draws */
  stateKey: string;
}

export interface FontOption {
  id: string;
  label: string;
  family: string;
  weight: number;
  isCustom?: boolean;
  fileName?: string;
}

export const BUILT_IN_FONTS: FontOption[] = [
  { id: 'plus-jakarta', label: 'Plus Jakarta Sans', family: '"Plus Jakarta Sans", sans-serif', weight: 700 },
  { id: 'outfit', label: 'Outfit Bold', family: '"Outfit", sans-serif', weight: 700 },
  { id: 'oswald', label: 'Oswald Condensed', family: '"Oswald", sans-serif', weight: 600 },
  { id: 'bricolage', label: 'Bricolage Grotesque', family: '"Bricolage Grotesque", sans-serif', weight: 700 },
  { id: 'playfair', label: 'Playfair Editorial', family: '"Playfair Display", serif', weight: 700 },
  { id: 'jetbrains', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace', weight: 600 },
];

export interface CaptionStyle {
  /** Normalized horizontal center anchor [0.05 .. 0.95] */
  positionX: number;
  /** Normalized vertical center anchor [0.08 .. 0.92] */
  positionY: number;
  /** Base font size at 1080p short-edge reference (px) */
  fontSizePx: number;
  /** Max caption wrap width as fraction of video width [35 .. 95] */
  maxWidthPercent: number;
  /** Max words grouped on screen per caption page (1..100, default 6) */
  wordsOnScreen: number;
  /** Global micro-sync offset in milliseconds [-300 .. +300] */
  wordSyncOffsetMs: number;
  /** Horizontal text alignment within caption box */
  textAlign: TextAlignMode;
  /** Distribute words evenly across lines so single orphan words don't hang */
  balancedLines: boolean;
  /** Line height multiplier [0.9 .. 2.2] (default 1.28) */
  lineSpacingMultiplier: number;
  /** Extra word gap at 1080p reference [0 .. 32 px] */
  wordSpacingPx: number;
  /** Extra letter spacing at 1080p reference [-2 .. 16 px] */
  letterSpacingPx: number;
  fontId: string;
  textColor: string;
  highlightColor: string;
  boxColor: string;
  /** 0..1 */
  boxOpacity: number;
  /** 0..50 px corner radius at 1080p reference */
  boxCornerRadius: number;
  /** 4..48 px padding breathing room around text at 1080p reference */
  boxPadding: number;
  /** 0..12 px at 1080p reference */
  outlineThickness: number;
  /** Caption animation type (20 options) */
  animation: CaptionAnimationId;
  /** Animation speed / intensity multiplier [0.4 .. 2.0] */
  animationIntensity: number;
  /** Background image Fill (crop) vs Fit (letterbox) */
  bgFitMode: BackgroundFitMode;
  /** 0..1 radial vignette darkness */
  vignetteStrength: number;
  /** 0..0.8 global background dim */
  backgroundDim: number;
  slowZoom: boolean;
  wordKaraoke: boolean;
  uppercase: boolean;
  /** True CFR export frame rate (15 fps Podcast fast, 24 fps Cinema, 30 fps Smooth) */
  fps: ExportFps;

  // --- Vocal Wave Visualizer ---
  vocalWaveEnabled: boolean;
  vocalWaveStyle: VocalWaveStyleId;
  vocalWaveColor: string;
  vocalWaveGradient: boolean;
  vocalWaveSecondaryColor: string;
  /** 16..64 bars */
  vocalWaveBarCount: number;
  /** Width % of video frame [20..95] */
  vocalWaveWidthPercent: number;
  /** Max height / sensitivity multiplier [0.3..2.0] */
  vocalWaveSensitivity: number;
  /** Bar thickness ratio [0.25..0.9] */
  vocalWaveThickness: number;
  /** 0..1 */
  vocalWaveOpacity: number;
  /** Normalized center X [0.08..0.92] */
  vocalWaveX: number;
  /** Normalized baseline/center Y [0.08..0.95] */
  vocalWaveY: number;

  // --- Channel Logo Watermark ---
  logoEnabled: boolean;
  /** Width % of video short edge [5..35] */
  logoSizePercent: number;
  /** 0..1 */
  logoOpacity: number;
  logoX: number;
  logoY: number;

  // --- Video Progress Bar ---
  progressBarEnabled: boolean;
  progressBarPosition: ProgressBarPosition;
  progressBarColor: string;
  /** 2..12 px at 1080p */
  progressBarThickness: number;
}

export const DEFAULT_TYPOGRAPHY_SPACING = {
  textAlign: 'center' as TextAlignMode,
  balancedLines: true,
  lineSpacingMultiplier: 1.28,
  wordSpacingPx: 0,
  letterSpacingPx: 0,
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  positionX: 0.5,
  positionY: 0.72,
  fontSizePx: 58,
  maxWidthPercent: 80,
  wordsOnScreen: 6,
  wordSyncOffsetMs: 0,
  textAlign: 'center',
  balancedLines: true,
  lineSpacingMultiplier: 1.28,
  wordSpacingPx: 0,
  letterSpacingPx: 0,
  fontId: 'plus-jakarta',
  textColor: '#FFFFFF',
  highlightColor: '#FACC15',
  boxColor: '#0A0B0E',
  boxOpacity: 0.62,
  boxCornerRadius: 16,
  boxPadding: 20,
  outlineThickness: 4,
  animation: 'word-scale',
  animationIntensity: 1.0,
  bgFitMode: 'fill',
  vignetteStrength: 0.45,
  backgroundDim: 0.22,
  slowZoom: false,
  wordKaraoke: true,
  uppercase: false,
  fps: 24,

  vocalWaveEnabled: true,
  vocalWaveStyle: 'bottom-bars',
  vocalWaveColor: '#FACC15',
  vocalWaveGradient: true,
  vocalWaveSecondaryColor: '#F97316',
  vocalWaveBarCount: 42,
  vocalWaveWidthPercent: 64,
  vocalWaveSensitivity: 1.05,
  vocalWaveThickness: 0.58,
  vocalWaveOpacity: 0.92,
  vocalWaveX: 0.5,
  vocalWaveY: 0.91,

  logoEnabled: true,
  logoSizePercent: 12,
  logoOpacity: 0.85,
  logoX: 0.9,
  logoY: 0.1,

  progressBarEnabled: true,
  progressBarPosition: 'bottom',
  progressBarColor: '#F97316',
  progressBarThickness: 6,
};

export interface StylePreset {
  id: string;
  label: string;
  patch: Partial<CaptionStyle>;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'creator-gold',
    label: 'Creator Gold',
    patch: {
      fontId: 'outfit',
      textColor: '#FFFFFF',
      highlightColor: '#FACC15',
      boxColor: '#0A0B0E',
      boxOpacity: 0.62,
      boxCornerRadius: 18,
      boxPadding: 22,
      outlineThickness: 5,
      animation: 'word-scale',
      uppercase: true,
      wordKaraoke: true,
    },
  },
  {
    id: 'sliding-podcast',
    label: 'Podcast Pill',
    patch: {
      fontId: 'plus-jakarta',
      textColor: '#FFFFFF',
      highlightColor: '#F97316',
      boxColor: '#0A0B0E',
      boxOpacity: 0.55,
      boxCornerRadius: 24,
      boxPadding: 22,
      outlineThickness: 3,
      animation: 'sliding-pill',
      uppercase: false,
      wordKaraoke: true,
    },
  },
  {
    id: 'clean-outline',
    label: 'No-Box Outline',
    patch: {
      fontId: 'oswald',
      textColor: '#FFFFFF',
      highlightColor: '#38BDF8',
      boxColor: '#0A0B0E',
      boxOpacity: 0,
      boxCornerRadius: 12,
      boxPadding: 14,
      outlineThickness: 7,
      animation: 'glow-pulse',
      uppercase: true,
      wordKaraoke: true,
    },
  },
  {
    id: 'editorial',
    label: 'Editorial',
    patch: {
      fontId: 'playfair',
      textColor: '#F8FAFC',
      highlightColor: '#FDE047',
      boxColor: '#111827',
      boxOpacity: 0.48,
      boxCornerRadius: 8,
      boxPadding: 20,
      outlineThickness: 2,
      animation: 'underline-slide',
      uppercase: false,
      wordKaraoke: true,
    },
  },
];

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  style: CaptionStyle;
  aspectId: AspectRatioId;
  resolutionId?: ResolutionId;
  bitrateMbps: ExportBitrateMbps;
}

export type AudioStrategyMode = 'pass-through' | 'transcode-aac';

export interface AudioStrategyInfo {
  mode: AudioStrategyMode;
  extension: string;
  label: string;
  detail: string;
  targetBitrateKbps: number;
}

export interface AudioAsset {
  name: string;
  durationMs: number;
  url: string | null;
  file: File | null;
  isDemo: boolean;
  strategy: AudioStrategyInfo;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  isCustom: boolean;
}

export interface LogoAsset {
  name: string;
  url: string;
}

export interface CfrFrameDescriptor {
  frameIndex: number;
  timestampUs: number;
  durationUs: number;
  /** Exact mid-frame sample time: t + (0.5 / fps) in milliseconds */
  sampleTimeMs: number;
  keyFrame: boolean;
}

export interface ScheduledFrame {
  ptsMs: number;
  reason: 'start' | 'cue-change' | 'word-change' | 'keyframe' | 'continuous' | 'end';
}

export interface FrameSchedule {
  mode: 'cfr' | 'smart-event' | 'continuous';
  fps: ExportFps;
  frames: ScheduledFrame[];
  equivalentContinuousFrames: number;
  uniqueTextureStates: number;
  savingsPercent: number;
}

export interface SampleBackdrop {
  id: string;
  name: string;
  recommendedAspect: AspectRatioId;
  url: string;
}

export const SAMPLE_BACKDROPS: SampleBackdrop[] = [
  {
    id: 'studio-cinema',
    name: 'Twilight Studio (16:9)',
    recommendedAspect: '16:9',
    url: '/src/assets/images/backdrop_studio_cinema_1795201540392.jpg',
  },
  {
    id: 'mountain-mist',
    name: 'Alpine Blue Hour (9:16)',
    recommendedAspect: '9:16',
    url: '/src/assets/images/backdrop_mountain_mist_1795201601856.jpg',
  },
];

export const DEFAULT_DEMO_SRT = `1
00:00:00,300 --> 00:00:00,760
Zero-copy

2
00:00:00,780 --> 00:00:01,180
OpenGL

3
00:00:01,200 --> 00:00:01,520
ES

4
00:00:01,540 --> 00:00:01,920
3.0

5
00:00:01,940 --> 00:00:02,380
renders

6
00:00:02,400 --> 00:00:02,880
1080p

7
00:00:02,900 --> 00:00:03,380
captions

8
00:00:03,400 --> 00:00:03,860
straight

9
00:00:03,880 --> 00:00:04,220
to

10
00:00:04,240 --> 00:00:04,760
hardware

11
00:00:04,780 --> 00:00:05,360
H.264

12
00:00:06,450 --> 00:00:06,920
Every

13
00:00:06,940 --> 00:00:07,380
single

14
00:00:07,400 --> 00:00:07,840
word

15
00:00:07,860 --> 00:00:08,360
syncs

16
00:00:08,380 --> 00:00:08,820
to

17
00:00:08,840 --> 00:00:09,320
exact

18
00:00:09,340 --> 00:00:09,940
millisecond

19
00:00:09,960 --> 00:00:10,580
timestamps

20
00:00:11,700 --> 00:00:12,180
Export

21
00:00:12,200 --> 00:00:12,620
fast

22
00:00:12,640 --> 00:00:13,040
at

23
00:00:13,060 --> 00:00:13,480
24

24
00:00:13,500 --> 00:00:14,150
fps
`;
