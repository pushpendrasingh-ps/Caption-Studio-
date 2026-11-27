import React, { useEffect, useRef, useState } from 'react';
import { Move, Pause, Play, RotateCcw } from 'lucide-react';
import type { AudioEnergyEnvelope } from '../core/audioEnvelope';
import {
  formatMsToDisplayClock,
  getActiveCaptionFromPages,
} from '../core/srtEngine';
import {
  getOutputDimensions,
  type AspectRatioId,
  type AudioAsset,
  type CaptionStyle,
  type FontOption,
  type FrameSchedule,
  type GroupedCaptionPage,
  type ResolutionId,
} from '../core/types';
import { CompositeFrameRenderer, type FrameHitRects } from '../gl/compositeFrameRenderer';
import type { NormalizedRect } from '../gl/overlayRenderers';

type DragTarget = 'caption' | 'vocalWave' | 'logo';

interface GpuPreviewStageProps {
  aspectId: AspectRatioId;
  resolutionId: ResolutionId;
  imageElement: HTMLImageElement | null;
  imageLoadError: string | null;
  logoImage: HTMLImageElement | null;
  audio: AudioAsset;
  audioEnvelope: AudioEnergyEnvelope | null;
  pages: GroupedCaptionPage[];
  durationMs: number;
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  style: CaptionStyle;
  activeFont: FontOption;
  frameSchedule: FrameSchedule;
  onUpdatePosition: (x: number, y: number) => void;
  onUpdateVocalWavePosition: (x: number, y: number) => void;
  onUpdateLogoPosition: (x: number, y: number) => void;
}

function hitTest(rect: NormalizedRect | null, nx: number, ny: number, pad = 0.028): boolean {
  if (!rect) return false;
  return (
    nx >= rect.x - pad &&
    nx <= rect.x + rect.width + pad &&
    ny >= rect.y - pad &&
    ny <= rect.y + rect.height + pad
  );
}

export function GpuPreviewStage({
  aspectId,
  resolutionId,
  imageElement,
  imageLoadError,
  logoImage,
  audio,
  audioEnvelope,
  pages,
  durationMs,
  currentTimeMs,
  onSeek,
  isPlaying,
  onTogglePlay,
  style,
  activeFont,
  frameSchedule,
  onUpdatePosition,
  onUpdateVocalWavePosition,
  onUpdateLogoPosition,
}: GpuPreviewStageProps) {
  const outputSpec = getOutputDimensions(aspectId, resolutionId);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CompositeFrameRenderer | null>(null);
  const hitRectsRef = useRef<FrameHitRects>({ caption: null, vocalWave: null, logo: null });

  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [boxDims, setBoxDims] = useState<{ w: number; h: number }>({ w: 640, h: 360 });
  const [renderCount, setRenderCount] = useState(0);

  // Preview resolution capped at 720p-equivalent or output resolution for crisp real-time rendering
  const previewScale = Math.min(1, 960 / Math.max(outputSpec.width, outputSpec.height));
  const previewWidth = Math.max(320, Math.round(outputSpec.width * previewScale));
  const previewHeight = Math.max(320, Math.round(outputSpec.height * previewScale));

  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const recalc = () => {
      const rect = el.getBoundingClientRect();
      const pad = 16;
      const availW = Math.max(120, rect.width - pad);
      const availH = Math.max(120, rect.height - pad);
      const targetRatio = outputSpec.width / outputSpec.height;

      let w = availW;
      let h = w / targetRatio;
      if (h > availH) {
        h = availH;
        w = h * targetRatio;
      }
      setBoxDims({ w: Math.floor(w), h: Math.floor(h) });
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [outputSpec.width, outputSpec.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CompositeFrameRenderer(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setBackgroundImage(imageElement);
  }, [imageElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    if (canvas.width !== previewWidth || canvas.height !== previewHeight) {
      canvas.width = previewWidth;
      canvas.height = previewHeight;
    }

    const captionState = getActiveCaptionFromPages(
      pages,
      currentTimeMs,
      style.wordKaraoke,
      style.uppercase,
      style.wordSyncOffsetMs
    );

    hitRectsRef.current = renderer.render({
      timeMs: currentTimeMs,
      durationMs,
      captionState,
      style,
      font: activeFont,
      audioEnvelope,
      logoImage,
      forceWaveSilent: !isPlaying,
    });
    setRenderCount(renderer.captionRenders);
  }, [
    previewWidth,
    previewHeight,
    imageElement,
    logoImage,
    audioEnvelope,
    pages,
    currentTimeMs,
    durationMs,
    isPlaying,
    style,
    activeFont,
  ]);

  const applyDragCoords = (target: DragTarget, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    let nx = (clientX - rect.left) / rect.width;
    let ny = (clientY - rect.top) / rect.height;

    if (Math.abs(nx - 0.5) < 0.018) nx = 0.5;
    if (Math.abs(ny - 0.5) < 0.018) ny = 0.5;

    if (target === 'logo') {
      onUpdateLogoPosition(
        Math.max(0.05, Math.min(0.95, nx)),
        Math.max(0.05, Math.min(0.95, ny))
      );
    } else if (target === 'vocalWave') {
      onUpdateVocalWavePosition(
        Math.max(0.08, Math.min(0.92, nx)),
        Math.max(0.08, Math.min(0.96, ny))
      );
    } else {
      onUpdatePosition(
        Math.max(0.05, Math.min(0.95, nx)),
        Math.max(0.08, Math.min(0.92, ny))
      );
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const ny = (e.clientY - rect.top) / Math.max(1, rect.height);

    let chosen: DragTarget = 'caption';
    if (style.logoEnabled && logoImage && hitTest(hitRectsRef.current.logo, nx, ny, 0.025)) {
      chosen = 'logo';
    } else if (
      style.vocalWaveEnabled &&
      hitTest(hitRectsRef.current.vocalWave, nx, ny, 0.025) &&
      !hitTest(hitRectsRef.current.caption, nx, ny, 0.01)
    ) {
      chosen = 'vocalWave';
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragTarget(chosen);
    applyDragCoords(chosen, e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragTarget) return;
    applyDragCoords(dragTarget, e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragTarget(null);
  };

  const activeX =
    dragTarget === 'logo'
      ? style.logoX
      : dragTarget === 'vocalWave'
        ? style.vocalWaveX
        : style.positionX;
  const activeY =
    dragTarget === 'logo'
      ? style.logoY
      : dragTarget === 'vocalWave'
        ? style.vocalWaveY
        : style.positionY;

  const nearCenterX = Math.abs(activeX - 0.5) < 0.008;
  const nearCenterY = Math.abs(activeY - 0.5) < 0.008;

  const dragBadgeLabel =
    dragTarget === 'logo'
      ? 'Moving Logo'
      : dragTarget === 'vocalWave'
        ? 'Moving Vocal Wave'
        : dragTarget === 'caption'
          ? 'Moving Caption'
          : 'Drag overlays';

  return (
    <section
      aria-label="GPU Video Preview Stage"
      className="flex min-h-0 flex-1 flex-col bg-[#08090C]"
    >
      {/* Locked Upper Viewport Canvas (never scrolls away) */}
      <div
        ref={stageContainerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
      >
        <div
          className="relative flex items-center justify-center"
          style={{ width: boxDims.w, height: boxDims.h }}
        >
          <canvas
            ref={canvasRef}
            data-testid="gpu-preview-canvas"
            data-aspect={aspectId}
            data-resolution={resolutionId}
            data-words-on-screen={style.wordsOnScreen}
            data-text-align={style.textAlign}
            data-balanced-lines={String(style.balancedLines)}
            data-pos-x={Math.round(style.positionX * 100)}
            data-pos-y={Math.round(style.positionY * 100)}
            data-animation={style.animation}
            data-vocal-wave-style={style.vocalWaveEnabled ? style.vocalWaveStyle : 'off'}
            data-box-radius={style.boxCornerRadius}
            data-fps={style.fps}
            data-caption-uploads={renderCount}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="h-full w-full cursor-grab touch-none rounded-md shadow-2xl shadow-black/80 active:cursor-grabbing"
          />

          {dragTarget && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {nearCenterX && (
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#F97316]/80" />
              )}
              {nearCenterY && (
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#F97316]/80" />
              )}
            </div>
          )}

          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/65 px-2 py-0.5 text-[10px] text-[#D1D5DB] backdrop-blur-sm">
            <Move className="h-3 w-3 text-[#F97316]" aria-hidden="true" />
            <span>{dragBadgeLabel}</span>
          </div>

          {imageLoadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#14161B]/90 p-4 text-center text-xs text-[#FCA5A5]">
              {imageLoadError}
            </div>
          )}
        </div>
      </div>

      {/* Sleek Compact Transport & Scrubber Bar Directly Beneath Preview */}
      <div className="shrink-0 border-t border-white/[0.08] bg-[#0F1116] px-3 py-2 sm:px-5">
        <div className="mx-auto flex max-w-[1100px] items-center gap-2.5 sm:gap-3.5">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#222630] text-[#F4F5F7] transition-colors hover:bg-[#2E3340] focus-visible:outline-2 focus-visible:outline-[#F97316]"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px]" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Rewind preview to start"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-[#9BA1AE] transition-colors hover:bg-white/[0.04] hover:text-[#F4F5F7] focus-visible:outline-2 focus-visible:outline-[#F97316]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Grouped page markers above scrubber */}
            <div
              className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
              aria-hidden="true"
            >
              {pages.map((page) => {
                const leftPct = (page.startMs / Math.max(1, durationMs)) * 100;
                const widthPct = Math.max(
                  1,
                  ((page.endMs - page.startMs) / Math.max(1, durationMs)) * 100
                );
                const effectiveT = currentTimeMs + (style.wordSyncOffsetMs || 0);
                const isActive = effectiveT >= page.startMs && effectiveT <= page.endMs;
                return (
                  <span
                    key={page.id}
                    className={`absolute inset-y-0 rounded-full transition-colors ${
                      isActive ? 'bg-[#F97316]' : 'bg-white/25'
                    }`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                );
              })}
            </div>

            <input
              type="range"
              aria-label="Timeline scrubber"
              min={0}
              max={durationMs}
              step={25}
              value={Math.min(currentTimeMs, durationMs)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="shrink-0 text-right font-mono text-[11px] text-[#D1D5DB] tabular-nums sm:text-xs">
            <span>{formatMsToDisplayClock(currentTimeMs)}</span>
            <span className="text-[#6B7280]"> / </span>
            <span className="text-[#9BA1AE]">{formatMsToDisplayClock(durationMs)}</span>
          </div>
        </div>

        {/* Quiet 1-line metadata strip */}
        <div className="mx-auto mt-1 hidden max-w-[1100px] items-center justify-between text-[11px] text-[#9BA1AE] sm:flex">
          <div className="flex items-center gap-2">
            <span>
              {outputSpec.width}×{outputSpec.height} ({resolutionId})
            </span>
            <span aria-hidden="true">·</span>
            <span>{style.wordsOnScreen} words/screen</span>
            {style.wordSyncOffsetMs !== 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Sync {style.wordSyncOffsetMs > 0 ? `+${style.wordSyncOffsetMs}` : style.wordSyncOffsetMs}ms
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{audio.strategy.label}</span>
          </div>
          <div className="font-mono tabular-nums">
            True CFR {frameSchedule.fps} fps ({frameSchedule.frames.length} frames · Zero Drops)
          </div>
        </div>
      </div>
    </section>
  );
}
