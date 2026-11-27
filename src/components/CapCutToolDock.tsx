import React, { useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AudioLines,
  BookmarkPlus,
  FileAudio,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Minus,
  Move,
  Palette,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  ASPECT_RATIOS,
  CAPTION_ANIMATIONS,
  SAMPLE_BACKDROPS,
  STYLE_PRESETS,
  VOCAL_WAVE_STYLES,
  type AspectRatioId,
  type AudioAsset,
  type CaptionStyle,
  type FontOption,
  type FrameSchedule,
  type ImageAsset,
  type LogoAsset,
  type SavedTemplate,
  type TextAlignMode,
} from '../core/types';

export type DockToolId = 'media' | 'position' | 'font' | 'style' | 'animate' | 'wave' | 'brand';

interface CapCutToolDockProps {
  aspectId: AspectRatioId;
  onChangeAspect: (id: AspectRatioId) => void;
  imageAsset: ImageAsset;
  savedStudioImages: ImageAsset[];
  audioAsset: AudioAsset;
  logoAsset: LogoAsset | null;
  srtFileName: string;
  rawCueCount: number;
  groupedPageCount: number;
  isWordByWord: boolean;
  style: CaptionStyle;
  fonts: FontOption[];
  savedTemplates: SavedTemplate[];
  frameSchedule: FrameSchedule;
  onUploadImage: (file: File) => void;
  onSelectSampleBackdrop: (backdropId: string) => void;
  onSelectStudioImage: (img: ImageAsset) => void;
  onDeleteStudioImage: (id: string) => void;
  onUploadAudio: (file: File) => void;
  onUploadSrt: (file: File) => void;
  onUploadCustomFont: (file: File) => void;
  onDeleteCustomFont: (fontId: string) => void;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: () => void;
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (template: SavedTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onOpenSubtitlesTab: () => void;
  onUpdateStyle: (patch: Partial<CaptionStyle>) => void;
  onResetSpacing: () => void;
  onResetAllStyle: () => void;
  onNudgePosition: (dx: number, dy: number) => void;
  onCenterPosition: () => void;
  onNudgeVocalWave: (dx: number, dy: number) => void;
  onResetVocalWavePosition: () => void;
  onAdjustFontSize: (delta: number) => void;
  fontUploadError: string | null;
}

const TEXT_SWATCHES = ['#FFFFFF', '#FDE047', '#38BDF8', '#FDA4AF', '#E2E8F0'];
const HIGHLIGHT_SWATCHES = ['#FACC15', '#F97316', '#22C55E', '#38BDF8', '#FB7185'];
const BOX_SWATCHES = ['#0A0B0E', '#1E293B', '#3F1D0E', '#111827', '#FFFFFF'];
const WAVE_SWATCHES = ['#FACC15', '#F97316', '#38BDF8', '#22C55E', '#FFFFFF'];

const DOCK_TABS: Array<{ id: DockToolId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'media', label: 'Media', icon: FolderOpen },
  { id: 'position', label: 'Move', icon: Move },
  { id: 'font', label: 'Font', icon: Type },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'animate', label: 'Animate', icon: Sparkles },
  { id: 'wave', label: 'Wave', icon: AudioLines },
  { id: 'brand', label: 'Brand', icon: SlidersHorizontal },
];

const ALIGN_OPTIONS: Array<{
  id: TextAlignMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'left', label: 'Left Align', icon: AlignLeft },
  { id: 'center', label: 'Center Align', icon: AlignCenter },
  { id: 'right', label: 'Right Align', icon: AlignRight },
  { id: 'justify', label: 'Justify', icon: AlignJustify },
];

export function CapCutToolDock({
  aspectId,
  onChangeAspect,
  imageAsset,
  savedStudioImages,
  audioAsset,
  logoAsset,
  srtFileName,
  rawCueCount,
  groupedPageCount,
  isWordByWord,
  style,
  fonts,
  savedTemplates,
  frameSchedule,
  onUploadImage,
  onSelectSampleBackdrop,
  onSelectStudioImage,
  onDeleteStudioImage,
  onUploadAudio,
  onUploadSrt,
  onUploadCustomFont,
  onDeleteCustomFont,
  onUploadLogo,
  onDeleteLogo,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  onOpenSubtitlesTab,
  onUpdateStyle,
  onResetSpacing,
  onResetAllStyle,
  onNudgePosition,
  onCenterPosition,
  onNudgeVocalWave,
  onResetVocalWavePosition,
  onAdjustFontSize,
  fontUploadError,
}: CapCutToolDockProps) {
  const [activeTool, setActiveTool] = useState<DockToolId>('style');
  const [templateName, setTemplateName] = useState('');

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const customFonts = fonts.filter((f) => f.isCustom);
  const builtInFonts = fonts.filter((f) => !f.isCustom);

  const setWordsOnScreenSafe = (next: number) => {
    const clamped = Math.max(1, Math.min(100, Math.round(next) || 1));
    onUpdateStyle({ wordsOnScreen: clamped });
  };

  const handleSaveTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = templateName.trim() || `My Look ${savedTemplates.length + 1}`;
    onSaveTemplate(trimmed);
    setTemplateName('');
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-white/[0.08] bg-[#13151B]">
      {/* Hidden native file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadImage(file);
          e.target.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadAudio(file);
          e.target.value = '';
        }}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadSrt(file);
          e.target.value = '';
        }}
      />
      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadCustomFont(file);
          e.target.value = '';
        }}
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadLogo(file);
          e.target.value = '';
        }}
      />

      {/* Compact Fixed-Height Middle-Bottom Control Drawer (scrolls internally only if needed) */}
      <div
        role="tabpanel"
        aria-label={`${DOCK_TABS.find((t) => t.id === activeTool)?.label ?? 'Tool'} controls`}
        className="relative h-[235px] overflow-y-auto px-3 py-3 sm:h-[245px] sm:px-5"
      >
        <div className="mx-auto max-w-[1100px]">
          {/* TAB 1: MEDIA (1. Image, 2. Audio, 3. SRT + Permanent Studio Image Library in IndexedDB) */}
          {activeTool === 'media' && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex min-h-[66px] flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.1] bg-[#1B1E26] px-2 py-2 text-center transition-colors hover:border-white/25 hover:bg-[#232732]"
                >
                  <ImageIcon className="h-4 w-4 text-[#F97316]" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[#F4F5F7]">1. Image (+ Save)</span>
                  <span className="max-w-full truncate text-[11px] text-[#9BA1AE]">
                    {imageAsset.name}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className="flex min-h-[66px] flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.1] bg-[#1B1E26] px-2 py-2 text-center transition-colors hover:border-white/25 hover:bg-[#232732]"
                >
                  <FileAudio className="h-4 w-4 text-[#F97316]" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[#F4F5F7]">2. Audio</span>
                  <span className="max-w-full truncate text-[11px] text-[#9BA1AE]">
                    {audioAsset.name}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => srtInputRef.current?.click()}
                  className="flex min-h-[66px] flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.1] bg-[#1B1E26] px-2 py-2 text-center transition-colors hover:border-white/25 hover:bg-[#232732]"
                >
                  <FileText className="h-4 w-4 text-[#F97316]" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[#F4F5F7]">3. SRT</span>
                  <span className="max-w-full truncate text-[11px] text-[#9BA1AE]">
                    {srtFileName} ({rawCueCount})
                  </span>
                </button>
              </div>

              {/* Studio Image Library (Permanent IndexedDB Gallery + Built-in Samples) */}
              <div className="rounded-xl border border-white/[0.08] bg-[#181B22] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[#F4F5F7]">
                    Studio Image Library{' '}
                    <span className="font-normal text-[#9BA1AE]">
                      ({savedStudioImages.length} saved in IndexedDB · 1-tap switch)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-[#F97316] px-2.5 text-[11px] font-semibold text-[#0C0D10] hover:bg-[#FB923C]"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      <span>Add Background</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSubtitlesTab}
                      className="text-xs font-semibold text-[#F97316] underline-offset-4 hover:underline whitespace-nowrap"
                    >
                      Subtitles Editor ({groupedPageCount} pages)
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                  {/* User's Saved Custom Studio Images from IndexedDB */}
                  {savedStudioImages.map((img) => {
                    const selected = imageAsset.id === img.id;
                    return (
                      <div
                        key={img.id}
                        className={`group relative flex h-14 w-24 shrink-0 overflow-hidden rounded-lg border transition-all ${
                          selected
                            ? 'border-[#F97316] ring-2 ring-[#F97316]/40'
                            : 'border-white/[0.12] hover:border-white/30'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectStudioImage(img)}
                          className="relative h-full w-full text-left"
                          title={`Switch to ${img.name}`}
                        >
                          <img
                            src={img.url}
                            alt={img.name}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-[#F4F5F7]">
                            {img.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete saved studio image ${img.name}`}
                          onClick={() => onDeleteStudioImage(img.id)}
                          className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded bg-black/80 text-[#9BA1AE] hover:text-[#FCA5A5]"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}

                  {/* Built-in Studio Sample Backdrops */}
                  {SAMPLE_BACKDROPS.map((b) => {
                    const selected = !imageAsset.isCustom && imageAsset.id === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectSampleBackdrop(b.id)}
                        className={`relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border text-left transition-all ${
                          selected
                            ? 'border-[#F97316] ring-2 ring-[#F97316]/40'
                            : 'border-white/[0.12] hover:border-white/30'
                        }`}
                      >
                        <img
                          src={b.url}
                          alt={b.name}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-[#F4F5F7]">
                          {b.name.split(' (')[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs text-[#9BA1AE]">
                {isWordByWord ? 'Word-by-word SRT detected' : 'Multi-word SRT loaded'} ·{' '}
                {rawCueCount} raw cues grouped into {groupedPageCount} pages ({style.wordsOnScreen}{' '}
                words max, &gt;0.9s pause split) · True CFR {frameSchedule.fps} fps
              </div>
            </div>
          )}

          {/* TAB 2: MOVE & SIZE (Arrow D-pad, Center, A-/A+, Text Alignment, Balanced Lines, Max Text Width) */}
          {activeTool === 'position' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
              <div className="flex items-center justify-between gap-4 sm:justify-start">
                <div
                  className="grid grid-cols-3 justify-items-center gap-1.5"
                  role="group"
                  aria-label="Caption position D-pad"
                >
                  <div />
                  <button
                    type="button"
                    aria-label="Move caption up"
                    onClick={() => onNudgePosition(0, -0.025)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35] active:scale-95"
                  >
                    ▲
                  </button>
                  <div />

                  <button
                    type="button"
                    aria-label="Move caption left"
                    onClick={() => onNudgePosition(-0.025, 0)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35] active:scale-95"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={onCenterPosition}
                    className="flex h-11 min-w-[64px] items-center justify-center rounded-lg bg-[#262B35] px-2 text-xs font-semibold text-[#F4F5F7] hover:bg-[#323846] active:scale-95"
                  >
                    Center
                  </button>
                  <button
                    type="button"
                    aria-label="Move caption right"
                    onClick={() => onNudgePosition(0.025, 0)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35] active:scale-95"
                  >
                    ▶
                  </button>

                  <div />
                  <button
                    type="button"
                    aria-label="Move caption down"
                    onClick={() => onNudgePosition(0, 0.025)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35] active:scale-95"
                  >
                    ▼
                  </button>
                  <div />
                </div>

                {/* Mobile inline A-/A+ next to D-pad */}
                <div className="flex flex-col items-end gap-2 sm:hidden">
                  <span className="font-mono text-xs text-[#9BA1AE] tabular-nums">
                    X {Math.round(style.positionX * 100)}% · Y {Math.round(style.positionY * 100)}%
                  </span>
                  <div className="text-xs text-[#D1D5DB]">
                    Size{' '}
                    <span className="font-mono font-semibold text-[#F4F5F7] tabular-nums">
                      {style.fontSizePx} px
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Decrease font size"
                      onClick={() => onAdjustFontSize(-4)}
                      className="flex h-11 min-w-[48px] items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] px-2.5 text-sm font-semibold text-[#F4F5F7]"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      aria-label="Increase font size"
                      onClick={() => onAdjustFontSize(4)}
                      className="flex h-11 min-w-[48px] items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] px-2.5 text-sm font-semibold text-[#F4F5F7]"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="hidden items-center justify-between gap-4 sm:flex">
                  <div>
                    <div className="text-xs font-semibold text-[#F4F5F7]">Position Anchor</div>
                    <div className="mt-0.5 font-mono text-xs text-[#9BA1AE] tabular-nums">
                      X {Math.round(style.positionX * 100)}% · Y {Math.round(style.positionY * 100)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#F4F5F7] tabular-nums">
                      {style.fontSizePx} px
                    </span>
                    <button
                      type="button"
                      aria-label="Decrease font size"
                      onClick={() => onAdjustFontSize(-4)}
                      className="flex h-10 min-w-[50px] items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] px-3 text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      aria-label="Increase font size"
                      onClick={() => onAdjustFontSize(4)}
                      className="flex h-10 min-w-[50px] items-center justify-center rounded-lg border border-white/[0.1] bg-[#1C1F26] px-3 text-sm font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                    >
                      A+
                    </button>
                  </div>
                </div>

                {/* 4 Text Alignment Buttons + Balanced Lines Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#1B1E26] p-1"
                    role="group"
                    aria-label="Text alignment"
                  >
                    {ALIGN_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = style.textAlign === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-label={opt.label}
                          aria-pressed={active}
                          onClick={() => onUpdateStyle({ textAlign: opt.id })}
                          className={`flex h-8 w-9 items-center justify-center rounded-md transition-colors ${
                            active
                              ? 'bg-[#F97316] text-[#0C0D10]'
                              : 'text-[#9BA1AE] hover:bg-white/[0.06] hover:text-[#F4F5F7]'
                          }`}
                          title={opt.label}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>

                  <div className="w-[180px]">
                    <ToggleButton
                      label="Balanced Lines"
                      checked={style.balancedLines}
                      onToggle={() => onUpdateStyle({ balancedLines: !style.balancedLines })}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="max-width-slider" className="text-[#D1D5DB]">
                      Max Text Width
                    </label>
                    <span className="font-mono text-[#9BA1AE] tabular-nums">
                      {style.maxWidthPercent}%
                    </span>
                  </div>
                  <input
                    id="max-width-slider"
                    type="range"
                    min={35}
                    max={95}
                    step={1}
                    value={style.maxWidthPercent}
                    onChange={(e) => onUpdateStyle({ maxWidthPercent: Number(e.target.value) })}
                    className="mt-1.5 w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: FONT (Built-in + Permanent IndexedDB Custom Fonts) */}
          {activeTool === 'font' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="font-family-select" className="text-xs font-semibold text-[#F4F5F7]">
                    Active Font
                  </label>
                  <select
                    id="font-family-select"
                    value={style.fontId}
                    onChange={(e) => onUpdateStyle({ fontId: e.target.value })}
                    className="h-10 rounded-lg border border-white/[0.1] bg-[#1B1E26] px-3 text-xs font-medium text-[#F4F5F7] focus:border-[#F97316] focus:outline-none"
                  >
                    {fonts.map((f) => (
                      <option key={f.id} value={f.id} className="bg-[#14161B] text-[#F4F5F7]">
                        {f.isCustom ? `${f.label} (Saved Custom)` : f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => fontInputRef.current?.click()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#F97316] px-3.5 text-xs font-semibold text-[#0C0D10] hover:bg-[#FB923C] whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Upload .TTF / .OTF / .WOFF2</span>
                </button>
              </div>

              {fontUploadError && <p className="text-xs text-[#FCA5A5]">{fontUploadError}</p>}

              {customFonts.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-[#9BA1AE]">
                    Saved Custom Fonts (IndexedDB — persists across reloads)
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {customFonts.map((f) => {
                      const active = style.fontId === f.id;
                      return (
                        <div
                          key={f.id}
                          className={`inline-flex items-center overflow-hidden rounded-lg border ${
                            active
                              ? 'border-[#F97316] bg-[#F97316]/12'
                              : 'border-white/[0.1] bg-[#1B1E26]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onUpdateStyle({ fontId: f.id })}
                            style={{ fontFamily: f.family }}
                            className="min-h-[38px] px-3 text-xs font-semibold text-[#F4F5F7]"
                          >
                            {f.label}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete saved font ${f.label}`}
                            onClick={() => onDeleteCustomFont(f.id)}
                            className="flex h-[38px] w-9 items-center justify-center border-l border-white/[0.08] text-[#9BA1AE] hover:text-[#FCA5A5]"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] font-medium text-[#9BA1AE]">Built-in Fonts</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {builtInFonts.map((f) => {
                    const active = style.fontId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onUpdateStyle({ fontId: f.id })}
                        style={{ fontFamily: f.family }}
                        className={`min-h-[40px] truncate rounded-lg border px-3 text-left text-xs font-semibold transition-colors ${
                          active
                            ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                            : 'border-white/[0.08] bg-[#1B1E26] text-[#D1D5DB] hover:border-white/20'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: STYLE (Words on Screen 1..100, Word Sync Offset, Alignment + Balanced Lines, Spacing Controls + Reset to Default, Colors, Box, Templates) */}
          {activeTool === 'style' && (
            <div className="flex flex-col gap-3">
              {/* Row 1: Words on Screen (1..100) + Word Sync Offset (-300ms..+300ms) + Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-[#1B1E26] px-2.5 py-1.5">
                    <label
                      htmlFor="words-on-screen-input"
                      className="text-xs font-semibold text-[#F4F5F7] whitespace-nowrap"
                    >
                      Words on Screen
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Decrease words on screen"
                        onClick={() => setWordsOnScreenSafe(style.wordsOnScreen - 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] bg-[#12141A] text-[#F4F5F7] hover:bg-[#262B35]"
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <input
                        id="words-on-screen-input"
                        type="number"
                        min={1}
                        max={100}
                        value={style.wordsOnScreen}
                        onChange={(e) => setWordsOnScreenSafe(Number(e.target.value))}
                        className="h-8 w-14 rounded-md border border-white/[0.12] bg-[#0C0D10] text-center font-mono text-xs font-bold text-[#F4F5F7] tabular-nums focus:border-[#F97316] focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-label="Increase words on screen"
                        onClick={() => setWordsOnScreenSafe(style.wordsOnScreen + 1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] bg-[#12141A] text-[#F4F5F7] hover:bg-[#262B35]"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Word Sync Offset (-300ms to +300ms) */}
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-[#1B1E26] px-2.5 py-1.5">
                    <label
                      htmlFor="word-sync-offset-slider"
                      className="text-xs font-medium text-[#D1D5DB] whitespace-nowrap"
                    >
                      Sync Offset
                    </label>
                    <input
                      id="word-sync-offset-slider"
                      type="range"
                      min={-300}
                      max={300}
                      step={10}
                      value={style.wordSyncOffsetMs}
                      onChange={(e) => onUpdateStyle({ wordSyncOffsetMs: Number(e.target.value) })}
                      className="w-24 sm:w-28"
                    />
                    <span className="w-14 text-right font-mono text-xs font-semibold text-[#F4F5F7] tabular-nums">
                      {style.wordSyncOffsetMs > 0
                        ? `+${style.wordSyncOffsetMs}ms`
                        : `${style.wordSyncOffsetMs}ms`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {STYLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onUpdateStyle(preset.patch)}
                      className="min-h-[34px] rounded-lg border border-white/[0.09] bg-[#1B1E26] px-2.5 text-xs font-medium text-[#D1D5DB] transition-colors hover:border-[#F97316]/60 hover:text-[#F4F5F7] whitespace-nowrap"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Text Alignment (Left, Center, Right, Justify) + Balanced Lines + Typography Spacing Sliders + Reset to Default */}
              <div className="rounded-xl border border-white/[0.08] bg-[#181B22] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#F4F5F7]">
                      Alignment &amp; Spacing
                    </span>
                    <div
                      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#0C0D10] p-0.5"
                      role="group"
                      aria-label="Text alignment"
                    >
                      {ALIGN_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const active = style.textAlign === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-label={opt.label}
                            aria-pressed={active}
                            onClick={() => onUpdateStyle({ textAlign: opt.id })}
                            className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${
                              active
                                ? 'bg-[#F97316] text-[#0C0D10]'
                                : 'text-[#9BA1AE] hover:bg-white/[0.06] hover:text-[#F4F5F7]'
                            }`}
                            title={opt.label}
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={style.balancedLines}
                      onClick={() => onUpdateStyle({ balancedLines: !style.balancedLines })}
                      className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                        style.balancedLines
                          ? 'border-[#F97316]/60 bg-[#F97316]/15 text-[#F4F5F7]'
                          : 'border-white/[0.1] bg-[#12141A] text-[#9BA1AE] hover:text-[#F4F5F7]'
                      }`}
                    >
                      Balanced Lines: {style.balancedLines ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onResetSpacing}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.12] bg-[#12141A] px-2.5 text-xs font-semibold text-[#D1D5DB] hover:border-[#F97316]/50 hover:text-[#F4F5F7]"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>Reset to Default</span>
                    </button>
                    <button
                      type="button"
                      onClick={onResetAllStyle}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#12141A] px-2.5 text-xs font-medium text-[#9BA1AE] hover:text-[#FCA5A5]"
                    >
                      <span>Reset All Style</span>
                    </button>
                  </div>
                </div>

                {/* 3 Typography Spacing Sliders: Line Gap (0.9x..2.2x), Word Gap (0..32px), Letter Gap (-2..16px) */}
                <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <SliderField
                    id="line-gap-slider"
                    label="Line Gap / Height"
                    valueText={`${style.lineSpacingMultiplier.toFixed(2)}x`}
                    min={90}
                    max={220}
                    step={2}
                    value={Math.round(style.lineSpacingMultiplier * 100)}
                    onChange={(v) => onUpdateStyle({ lineSpacingMultiplier: Number((v / 100).toFixed(2)) })}
                  />
                  <SliderField
                    id="word-gap-slider"
                    label="Word Gap / Spacing"
                    valueText={`${style.wordSpacingPx} px`}
                    min={0}
                    max={32}
                    step={1}
                    value={style.wordSpacingPx}
                    onChange={(v) => onUpdateStyle({ wordSpacingPx: v })}
                  />
                  <SliderField
                    id="letter-gap-slider"
                    label="Letter Gap / Spacing"
                    valueText={`${style.letterSpacingPx} px`}
                    min={-2}
                    max={16}
                    step={0.5}
                    value={style.letterSpacingPx}
                    onChange={(v) => onUpdateStyle({ letterSpacingPx: v })}
                  />
                </div>
              </div>

              {/* Row 3: Colors */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ColorPickerRow
                  label="Text"
                  value={style.textColor}
                  swatches={TEXT_SWATCHES}
                  onChange={(textColor) => onUpdateStyle({ textColor })}
                />
                <ColorPickerRow
                  label="Highlight"
                  value={style.highlightColor}
                  swatches={HIGHLIGHT_SWATCHES}
                  onChange={(highlightColor) => onUpdateStyle({ highlightColor })}
                />
                <ColorPickerRow
                  label="Box"
                  value={style.boxColor}
                  swatches={BOX_SWATCHES}
                  onChange={(boxColor) => onUpdateStyle({ boxColor })}
                />
              </div>

              {/* Row 4: Box Opacity + Corner Radius (0-50px) + Box Padding + Outline */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SliderField
                  id="box-opacity-slider"
                  label="Box Opacity"
                  valueText={`${Math.round(style.boxOpacity * 100)}%`}
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(style.boxOpacity * 100)}
                  onChange={(v) => onUpdateStyle({ boxOpacity: v / 100 })}
                />
                <SliderField
                  id="box-radius-slider"
                  label="Corner Radius"
                  valueText={`${style.boxCornerRadius} px`}
                  min={0}
                  max={50}
                  step={1}
                  value={style.boxCornerRadius}
                  onChange={(v) => onUpdateStyle({ boxCornerRadius: v })}
                />
                <SliderField
                  id="box-padding-slider"
                  label="Box Padding"
                  valueText={`${style.boxPadding} px`}
                  min={4}
                  max={48}
                  step={1}
                  value={style.boxPadding}
                  onChange={(v) => onUpdateStyle({ boxPadding: v })}
                />
                <SliderField
                  id="outline-slider"
                  label="Outline"
                  valueText={`${style.outlineThickness} px`}
                  min={0}
                  max={12}
                  step={1}
                  value={style.outlineThickness}
                  onChange={(v) => onUpdateStyle({ outlineThickness: v })}
                />
              </div>

              {/* Row 5: Karaoke, UPPERCASE & Saved Custom Templates ("Save My Preset") */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr] lg:items-center">
                <ToggleButton
                  label="Word Karaoke"
                  checked={style.wordKaraoke}
                  onToggle={() => onUpdateStyle({ wordKaraoke: !style.wordKaraoke })}
                />
                <ToggleButton
                  label="UPPERCASE"
                  checked={style.uppercase}
                  onToggle={() => onUpdateStyle({ uppercase: !style.uppercase })}
                />
                <form onSubmit={handleSaveTemplateSubmit} className="relative flex items-center gap-1.5">
                  <label htmlFor="custom-template-name" className="sr-only">
                    Custom template name
                  </label>
                  <input
                    id="custom-template-name"
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="My podcast template name..."
                    className="h-[42px] min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-[#0C0D10] px-2.5 text-xs text-[#F4F5F7] placeholder:text-[#6B7280] focus:border-[#F97316] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-lg bg-[#262B35] px-3 text-xs font-semibold text-[#F4F5F7] transition-colors hover:bg-[#F97316] hover:text-[#0C0D10] whitespace-nowrap"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Save Template</span>
                  </button>
                </form>
              </div>

              {savedTemplates.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
                  <span className="text-[11px] font-medium text-[#9BA1AE]">My Templates:</span>
                  {savedTemplates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="inline-flex items-center overflow-hidden rounded-lg border border-white/[0.1] bg-[#1B1E26]"
                    >
                      <button
                        type="button"
                        onClick={() => onApplyTemplate(tpl)}
                        className="min-h-[34px] px-2.5 text-xs font-semibold text-[#F4F5F7] hover:text-[#F97316]"
                      >
                        {tpl.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete saved template ${tpl.name}`}
                        onClick={() => onDeleteTemplate(tpl.id)}
                        className="flex h-[34px] w-8 items-center justify-center border-l border-white/[0.08] text-[#9BA1AE] hover:text-[#FCA5A5]"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: ANIMATE (20 Smooth Caption & Word Animations + Speed/Intensity Slider) */}
          {activeTool === 'animate' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#F4F5F7]">
                  20 Smooth Caption &amp; Word Animations
                </span>
                <div className="w-64">
                  <SliderField
                    id="anim-intensity-slider"
                    label="Animation Speed & Intensity"
                    valueText={`${style.animationIntensity.toFixed(2)}x`}
                    min={40}
                    max={200}
                    step={5}
                    value={Math.round(style.animationIntensity * 100)}
                    onChange={(v) => onUpdateStyle({ animationIntensity: v / 100 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
                {CAPTION_ANIMATIONS.map((anim) => {
                  const active = style.animation === anim.id;
                  return (
                    <button
                      key={anim.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onUpdateStyle({ animation: anim.id })}
                      className={`flex min-h-[48px] flex-col items-start justify-center rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
                        active
                          ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                          : 'border-white/[0.08] bg-[#1B1E26] text-[#D1D5DB] hover:border-white/25'
                      }`}
                    >
                      <span className="text-xs font-semibold">{anim.label}</span>
                      <span className="mt-0.5 text-[10px] text-[#9BA1AE]">{anim.shortDesc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 6: VOCAL WAVE (Audio-Reactive Podcast Sound Visualizer — 6 Styles + Gradient + Positioning) */}
          {activeTool === 'wave' && (
            <div className="flex flex-col gap-3">
              {/* Row 1: On/Off + 6 Selectable Styles */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-[165px]">
                  <ToggleButton
                    label="Vocal Wave"
                    checked={style.vocalWaveEnabled}
                    onToggle={() => onUpdateStyle({ vocalWaveEnabled: !style.vocalWaveEnabled })}
                  />
                </div>

                <div className="flex flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Vocal wave styles">
                  {VOCAL_WAVE_STYLES.map((opt) => {
                    const active = style.vocalWaveStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onUpdateStyle({ vocalWaveStyle: opt.id, vocalWaveEnabled: true })}
                        className={`min-h-[38px] rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                          active
                            ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                            : 'border-white/[0.08] bg-[#1B1E26] text-[#9BA1AE] hover:text-[#F4F5F7]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Row 2: Primary Color + 2-Color Gradient Toggle + Secondary Color */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
                <ColorPickerRow
                  label="Primary"
                  value={style.vocalWaveColor}
                  swatches={WAVE_SWATCHES}
                  onChange={(vocalWaveColor) => onUpdateStyle({ vocalWaveColor })}
                />
                <ToggleButton
                  label="2-Color Gradient"
                  checked={style.vocalWaveGradient}
                  onToggle={() => onUpdateStyle({ vocalWaveGradient: !style.vocalWaveGradient })}
                />
                <div className={style.vocalWaveGradient ? 'opacity-100' : 'opacity-45'}>
                  <ColorPickerRow
                    label="Secondary"
                    value={style.vocalWaveSecondaryColor}
                    swatches={HIGHLIGHT_SWATCHES}
                    onChange={(vocalWaveSecondaryColor) =>
                      onUpdateStyle({ vocalWaveSecondaryColor, vocalWaveGradient: true })
                    }
                  />
                </div>
              </div>

              {/* Row 3: Bar Count, Width %, Height/Sensitivity, Thickness, Opacity */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <SliderField
                  id="wave-bars-slider"
                  label="Bar Count"
                  valueText={`${style.vocalWaveBarCount}`}
                  min={16}
                  max={64}
                  step={2}
                  value={style.vocalWaveBarCount}
                  onChange={(v) => onUpdateStyle({ vocalWaveBarCount: v })}
                />
                <SliderField
                  id="wave-width-slider"
                  label="Width"
                  valueText={`${style.vocalWaveWidthPercent}%`}
                  min={20}
                  max={95}
                  step={1}
                  value={style.vocalWaveWidthPercent}
                  onChange={(v) => onUpdateStyle({ vocalWaveWidthPercent: v })}
                />
                <SliderField
                  id="wave-height-slider"
                  label="Sensitivity"
                  valueText={`${Math.round(style.vocalWaveSensitivity * 100)}%`}
                  min={30}
                  max={200}
                  step={5}
                  value={Math.round(style.vocalWaveSensitivity * 100)}
                  onChange={(v) => onUpdateStyle({ vocalWaveSensitivity: v / 100 })}
                />
                <SliderField
                  id="wave-thick-slider"
                  label="Thickness"
                  valueText={`${Math.round(style.vocalWaveThickness * 100)}%`}
                  min={25}
                  max={90}
                  step={1}
                  value={Math.round(style.vocalWaveThickness * 100)}
                  onChange={(v) => onUpdateStyle({ vocalWaveThickness: v / 100 })}
                />
                <SliderField
                  id="wave-opacity-slider"
                  label="Opacity"
                  valueText={`${Math.round(style.vocalWaveOpacity * 100)}%`}
                  min={10}
                  max={100}
                  step={1}
                  value={Math.round(style.vocalWaveOpacity * 100)}
                  onChange={(v) => onUpdateStyle({ vocalWaveOpacity: v / 100 })}
                />
              </div>

              {/* Row 4: Vocal Wave X/Y Nudge & Center-Bottom Reset */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                <span className="font-mono text-xs text-[#9BA1AE] tabular-nums">
                  Wave Position: X {Math.round(style.vocalWaveX * 100)}% · Y{' '}
                  {Math.round(style.vocalWaveY * 100)}% (or drag wave on preview)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Move vocal wave left"
                    onClick={() => onNudgeVocalWave(-0.025, 0)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1B1E26] text-xs font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    aria-label="Move vocal wave up"
                    onClick={() => onNudgeVocalWave(0, -0.025)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1B1E26] text-xs font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="Move vocal wave down"
                    onClick={() => onNudgeVocalWave(0, 0.025)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1B1E26] text-xs font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    aria-label="Move vocal wave right"
                    onClick={() => onNudgeVocalWave(0.025, 0)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#1B1E26] text-xs font-semibold text-[#F4F5F7] hover:bg-[#262B35]"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={onResetVocalWavePosition}
                    className="h-9 rounded-lg bg-[#262B35] px-3 text-xs font-semibold text-[#F4F5F7] hover:bg-[#323846] whitespace-nowrap"
                  >
                    Center-Bottom
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: BRAND & BG (Fill/Fit, Vignette/Dim, Slow Zoom, 15/24/30fps CFR, Channel Logo Watermark, Video Progress Bar) */}
          {activeTool === 'brand' && (
            <div className="flex flex-col gap-3.5">
              {/* Background Scaling + Aspect + CFR FPS */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#F4F5F7]">BG</span>
                  <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0C0D10] p-0.5">
                    {(['fill', 'fit'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={style.bgFitMode === mode}
                        onClick={() => onUpdateStyle({ bgFitMode: mode })}
                        className={`min-h-[34px] rounded-md px-2.5 text-xs font-semibold transition-colors ${
                          style.bgFitMode === mode
                            ? 'bg-[#262A34] text-[#F4F5F7]'
                            : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
                        }`}
                      >
                        {mode === 'fill' ? 'Fill (Crop)' : 'Fit (Full)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {(['16:9', '9:16', '1:1'] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={aspectId === id}
                      onClick={() => onChangeAspect(id)}
                      className={`min-h-[34px] rounded-lg px-2.5 font-mono text-xs font-semibold transition-colors ${
                        aspectId === id
                          ? 'bg-[#262A34] text-[#F4F5F7]'
                          : 'bg-[#1B1E26] text-[#9BA1AE] hover:text-[#F4F5F7]'
                      }`}
                    >
                      {ASPECT_RATIOS[id].shortLabel}
                    </button>
                  ))}
                </div>

                <div className="inline-flex items-center rounded-lg border border-white/[0.08] bg-[#0C0D10] p-0.5">
                  {([15, 24, 30] as const).map((fpsOption) => (
                    <button
                      key={fpsOption}
                      type="button"
                      aria-pressed={style.fps === fpsOption}
                      onClick={() => onUpdateStyle({ fps: fpsOption })}
                      className={`min-h-[34px] rounded-md px-2.5 font-mono text-xs font-semibold ${
                        style.fps === fpsOption
                          ? 'bg-[#262A34] text-[#F4F5F7]'
                          : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
                      }`}
                    >
                      {fpsOption} fps CFR
                    </button>
                  ))}
                </div>
              </div>

              {/* Dark Vignette + Background Dim + Slow Zoom */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
                <SliderField
                  id="vignette-slider"
                  label="Dark Vignette"
                  valueText={`${Math.round(style.vignetteStrength * 100)}%`}
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(style.vignetteStrength * 100)}
                  onChange={(v) => onUpdateStyle({ vignetteStrength: v / 100 })}
                />
                <SliderField
                  id="dim-slider"
                  label="Background Dim"
                  valueText={`${Math.round(style.backgroundDim * 100)}%`}
                  min={0}
                  max={80}
                  step={1}
                  value={Math.round(style.backgroundDim * 100)}
                  onChange={(v) => onUpdateStyle({ backgroundDim: v / 100 })}
                />
                <ToggleButton
                  label="Slow Zoom (Ken Burns)"
                  checked={style.slowZoom}
                  onToggle={() => onUpdateStyle({ slowZoom: !style.slowZoom })}
                />
              </div>

              {/* Channel Logo / Watermark Overlay (Permanent IndexedDB) */}
              <div className="rounded-xl border border-white/[0.08] bg-[#181B22] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#F4F5F7]">
                      Channel Logo Watermark
                    </span>
                    {logoAsset && (
                      <span className="max-w-[140px] truncate text-[11px] text-[#9BA1AE]">
                        ({logoAsset.name})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#F97316] px-3 text-xs font-semibold text-[#0C0D10] hover:bg-[#FB923C]"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{logoAsset ? 'Replace Logo' : 'Upload PNG/JPG'}</span>
                    </button>
                    {logoAsset && (
                      <button
                        type="button"
                        aria-label="Remove saved logo"
                        onClick={onDeleteLogo}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#12141A] text-[#9BA1AE] hover:text-[#FCA5A5]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
                  <ToggleButton
                    label="Show Logo"
                    checked={style.logoEnabled}
                    onToggle={() => onUpdateStyle({ logoEnabled: !style.logoEnabled })}
                  />
                  <SliderField
                    id="logo-size-slider"
                    label="Logo Size"
                    valueText={`${style.logoSizePercent}%`}
                    min={5}
                    max={35}
                    step={1}
                    value={style.logoSizePercent}
                    onChange={(v) => onUpdateStyle({ logoSizePercent: v })}
                  />
                  <SliderField
                    id="logo-opacity-slider"
                    label="Logo Opacity"
                    valueText={`${Math.round(style.logoOpacity * 100)}%`}
                    min={10}
                    max={100}
                    step={1}
                    value={Math.round(style.logoOpacity * 100)}
                    onChange={(v) => onUpdateStyle({ logoOpacity: v / 100 })}
                  />
                </div>

                {/* 4 Corner Snap Buttons */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[#9BA1AE]">Snap Corner:</span>
                  {[
                    { label: 'Top-Left', x: 0.1, y: 0.1 },
                    { label: 'Top-Right', x: 0.9, y: 0.1 },
                    { label: 'Bottom-Left', x: 0.1, y: 0.88 },
                    { label: 'Bottom-Right', x: 0.9, y: 0.88 },
                  ].map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => onUpdateStyle({ logoX: c.x, logoY: c.y, logoEnabled: true })}
                      className="min-h-[32px] rounded-md border border-white/[0.08] bg-[#12141A] px-2.5 text-[11px] font-medium text-[#D1D5DB] hover:border-[#F97316]/60 hover:text-[#F4F5F7]"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Progress Bar */}
              <div className="rounded-xl border border-white/[0.08] bg-[#181B22] p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-center">
                  <ToggleButton
                    label="Progress Bar"
                    checked={style.progressBarEnabled}
                    onToggle={() =>
                      onUpdateStyle({ progressBarEnabled: !style.progressBarEnabled })
                    }
                  />
                  <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#0C0D10] p-0.5">
                    {(['top', 'bottom'] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        aria-pressed={style.progressBarPosition === pos}
                        onClick={() =>
                          onUpdateStyle({ progressBarPosition: pos, progressBarEnabled: true })
                        }
                        className={`min-h-[36px] flex-1 rounded-md px-3 text-xs font-semibold capitalize ${
                          style.progressBarPosition === pos
                            ? 'bg-[#262A34] text-[#F4F5F7]'
                            : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                  <ColorPickerRow
                    label="Bar"
                    value={style.progressBarColor}
                    swatches={HIGHLIGHT_SWATCHES}
                    onChange={(progressBarColor) => onUpdateStyle({ progressBarColor })}
                  />
                  <SliderField
                    id="progress-thick-slider"
                    label="Thickness"
                    valueText={`${style.progressBarThickness} px`}
                    min={2}
                    max={12}
                    step={1}
                    value={style.progressBarThickness}
                    onChange={(v) => onUpdateStyle({ progressBarThickness: v })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom CapCut 7-Icon Tool Bar (Fixed Height, >= 44px touch targets at 390px) */}
      <div
        role="tablist"
        aria-label="Editor tools"
        className="grid h-[62px] shrink-0 grid-cols-7 border-t border-white/[0.08] bg-[#0C0D10]"
      >
        {DOCK_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTool === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTool(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#F97316] ${
                active ? 'text-[#F97316]' : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="text-[10px] font-medium tracking-tight whitespace-nowrap sm:text-[11px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SliderFieldProps {
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
}

function SliderField({ id, label, valueText, min, max, step, value, onChange }: SliderFieldProps) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="truncate text-[#D1D5DB]">
          {label}
        </label>
        <span className="ml-1 shrink-0 font-mono text-[#9BA1AE] tabular-nums">{valueText}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full"
      />
    </div>
  );
}

interface ToggleButtonProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleButton({ label, checked, onToggle }: ToggleButtonProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#F97316] ${
        checked
          ? 'border-[#F97316]/60 bg-[#F97316]/12 text-[#F4F5F7]'
          : 'border-white/[0.1] bg-[#1B1E26] text-[#9BA1AE] hover:text-[#F4F5F7]'
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[#F97316]' : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

interface ColorPickerRowProps {
  label: string;
  value: string;
  swatches: string[];
  onChange: (hex: string) => void;
}

function ColorPickerRow({ label, value, swatches, onChange }: ColorPickerRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-[#D1D5DB]">{label}</span>
      <div className="flex items-center gap-1.5">
        {swatches.map((hex) => {
          const selected = value.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              aria-label={`${label} color ${hex}`}
              aria-pressed={selected}
              onClick={() => onChange(hex)}
              className={`h-6 w-6 rounded-full border transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-[#F97316] ${
                selected ? 'border-[#F97316] ring-2 ring-[#F97316]/50' : 'border-white/25'
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}
        <label className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/25">
          <span className="sr-only">Custom {label} color</span>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-9 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
      </div>
    </div>
  );
}
