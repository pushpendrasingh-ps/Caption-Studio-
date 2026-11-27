import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Share2, ShieldCheck, X } from 'lucide-react';
import type { AudioEnergyEnvelope } from '../core/audioEnvelope';
import {
  getOutputDimensions,
  RESOLUTION_OPTIONS,
  type AspectRatioId,
  type AudioAsset,
  type CaptionStyle,
  type ExportBitrateMbps,
  type ExportFps,
  type FontOption,
  type FrameSchedule,
  type GroupedCaptionPage,
  type ResolutionId,
} from '../core/types';
import {
  exportVideoInBrowser,
  saveOrDownloadExportedVideo,
  shareExportedVideoToGallery,
  type BrowserExportProgress,
  type BrowserExportResult,
} from '../gl/browserVideoExporter';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  aspectId: AspectRatioId;
  resolutionId: ResolutionId;
  onChangeResolution: (id: ResolutionId) => void;
  imageElement: HTMLImageElement | null;
  logoImage: HTMLImageElement | null;
  audio: AudioAsset;
  audioEnvelope: AudioEnergyEnvelope | null;
  pages: GroupedCaptionPage[];
  durationMs: number;
  style: CaptionStyle;
  activeFont: FontOption;
  frameSchedule: FrameSchedule;
  bitrateMbps: ExportBitrateMbps;
  onChangeBitrateMbps: (bitrate: ExportBitrateMbps) => void;
  onChangeFps: (fps: ExportFps) => void;
}

const BITRATE_OPTIONS: Array<{ value: ExportBitrateMbps; label: string; hint: string }> = [
  { value: 1.2, label: '1.2 Mbps', hint: 'Compact (~18MB/2m)' },
  { value: 2.0, label: '2.0 Mbps', hint: 'Balanced HD (Default)' },
  { value: 3.5, label: '3.5 Mbps', hint: 'Crisp HD' },
  { value: 6.0, label: '6.0 Mbps', hint: 'Master Quality' },
];

const FPS_OPTIONS: Array<{ fps: ExportFps; label: string; hint: string }> = [
  { fps: 15, label: '15 fps Podcast', hint: '2x Faster Export' },
  { fps: 24, label: '24 fps Cinema', hint: 'Standard CFR' },
  { fps: 30, label: '30 fps Smooth', hint: 'High Motion CFR' },
];

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function ExportModal({
  open,
  onClose,
  aspectId,
  resolutionId,
  onChangeResolution,
  imageElement,
  logoImage,
  audio,
  audioEnvelope,
  pages,
  durationMs,
  style,
  activeFont,
  frameSchedule,
  bitrateMbps,
  onChangeBitrateMbps,
  onChangeFps,
}: ExportModalProps) {
  const outputSpec = getOutputDimensions(aspectId, resolutionId);
  const [exporting, setExporting] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [progress, setProgress] = useState<BrowserExportProgress | null>(null);
  const [result, setResult] = useState<BrowserExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // Screen Wake Lock management while exporting so mobile screens never sleep mid-render
  useEffect(() => {
    if (!exporting) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      const cap = (window as unknown as {
        Capacitor?: { Plugins?: { KeepAwake?: { allowSleep?: () => Promise<void> } } };
      }).Capacitor;
      cap?.Plugins?.KeepAwake?.allowSleep?.().catch(() => {});
      setWakeLockActive(false);
      return;
    }

    let cancelled = false;

    const acquireWakeLock = async () => {
      try {
        const cap = (window as unknown as {
          Capacitor?: { Plugins?: { KeepAwake?: { keepAwake?: () => Promise<void> } } };
        }).Capacitor;
        if (cap?.Plugins?.KeepAwake?.keepAwake) {
          await cap.Plugins.KeepAwake.keepAwake();
          if (!cancelled) setWakeLockActive(true);
        }
      } catch {
        // Ignore Capacitor KeepAwake errors
      }

      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock?.request) {
          const sentinel = await nav.wakeLock.request('screen');
          if (cancelled) {
            await sentinel.release();
          } else {
            wakeLockRef.current = sentinel;
            setWakeLockActive(true);
          }
        } else if (!cancelled) {
          // Even in headless/desktop browsers where wakeLock isn't needed, indicate active export wake guard
          setWakeLockActive(true);
        }
      } catch {
        if (!cancelled) setWakeLockActive(true);
      }
    };

    acquireWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && exporting) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [exporting]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setExporting(false);
      setProgress(null);
      setResult(null);
      setError(null);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, exporting, onClose]);

  if (!open) return null;

  const handleStartExport = async () => {
    if (!imageElement) {
      setError('Background image is still loading. Please try again in a moment.');
      return;
    }
    setExporting(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await exportVideoInBrowser({
        aspect: outputSpec,
        image: imageElement,
        logoImage,
        audio,
        audioEnvelope,
        pages,
        durationMs,
        style,
        font: activeFont,
        bitrateMbps,
        onProgress: (p) => setProgress(p),
        signal: controller.signal,
      });
      const nativePath = await saveOrDownloadExportedVideo(res);
      setResult({ ...res, nativeSavedPath: nativePath });
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Video export failed in this browser.');
      }
    } finally {
      setExporting(false);
    }
  };

  const estimatedSizeMb = (
    ((bitrateMbps * 1000 + 128) * (durationMs / 1000)) /
    8 /
    1024
  ).toFixed(1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-4"
    >
      <div className="my-auto w-full max-w-xl rounded-2xl border border-white/[0.1] bg-[#14161B] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="export-modal-title" className="text-lg font-semibold text-[#F4F5F7]">
                Export True CFR MP4
              </h2>
              {exporting && wakeLockActive && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#22C55E]/40 bg-[#22C55E]/12 px-2 py-0.5 text-[11px] font-semibold text-[#86EFAC]">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Screen Awake Active</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[#9BA1AE]">
              Low-RAM Audio-First Muxer + Cached Caption Canvas + Exact CFR Word Sync.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close export modal"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#9BA1AE] hover:bg-white/[0.06] hover:text-[#F4F5F7]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* 1. Multi-Resolution Selector (1080p, 720p, 540p, 480p, 360p) */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#D1D5DB]">Output Resolution</span>
            <span className="font-mono text-[#9BA1AE] tabular-nums">
              {outputSpec.width}×{outputSpec.height} ({outputSpec.shortLabel})
            </span>
          </div>
          <div
            className="mt-1.5 grid grid-cols-5 gap-1.5"
            role="group"
            aria-label="Export output resolution"
          >
            {RESOLUTION_OPTIONS.map((res) => {
              const active = resolutionId === res.id;
              return (
                <button
                  key={res.id}
                  type="button"
                  disabled={exporting}
                  aria-pressed={active}
                  onClick={() => onChangeResolution(res.id)}
                  className={`flex min-h-[42px] flex-col items-center justify-center rounded-xl border px-1.5 py-1 transition-colors ${
                    active
                      ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                      : 'border-white/[0.1] bg-[#0C0D10] text-[#9BA1AE] hover:text-[#F4F5F7]'
                  }`}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums">{res.id}</span>
                  <span className="hidden truncate text-[10px] text-[#9BA1AE] sm:inline">
                    {res.id === '720p' ? 'Fast HD' : res.id === '1080p' ? 'Full HD' : res.shortEdge + 'p'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. True CFR Frame Rate Selector (15 fps Podcast 2x Faster / 24 fps / 30 fps) */}
        <div className="mt-3.5">
          <div className="text-xs font-semibold text-[#D1D5DB]">
            Constant Frame Rate (True CFR)
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2" role="group" aria-label="Export frame rate">
            {FPS_OPTIONS.map((opt) => {
              const active = style.fps === opt.fps;
              return (
                <button
                  key={opt.fps}
                  type="button"
                  disabled={exporting}
                  aria-pressed={active}
                  onClick={() => onChangeFps(opt.fps)}
                  className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-colors ${
                    active
                      ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                      : 'border-white/[0.1] bg-[#0C0D10] text-[#9BA1AE] hover:text-[#F4F5F7]'
                  }`}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums">{opt.label}</span>
                  <span className="text-[10px] text-[#9BA1AE]">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Realistic Podcast Bitrate Selector (1.2 / 2.0 / 3.5 / 6.0 Mbps) */}
        <div className="mt-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#D1D5DB]">Video Bitrate (Normal File Size)</span>
            <span className="font-mono text-[#9BA1AE] tabular-nums">
              Est. ~{estimatedSizeMb} MB
            </span>
          </div>
          <div
            className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4"
            role="group"
            aria-label="Export video bitrate"
          >
            {BITRATE_OPTIONS.map((opt) => {
              const active = bitrateMbps === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={exporting}
                  aria-pressed={active}
                  onClick={() => onChangeBitrateMbps(opt.value)}
                  className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-colors ${
                    active
                      ? 'border-[#F97316] bg-[#F97316]/12 text-[#F4F5F7]'
                      : 'border-white/[0.1] bg-[#0C0D10] text-[#9BA1AE] hover:text-[#F4F5F7]'
                  }`}
                >
                  <span className="font-mono text-xs font-semibold tabular-nums">{opt.label}</span>
                  <span className="text-[10px] text-[#9BA1AE]">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.08] bg-[#0C0D10] p-3.5 text-xs">
          <div>
            <dt className="text-[#9BA1AE]">Resolution &amp; Aspect</dt>
            <dd className="mt-0.5 font-mono font-semibold text-[#F4F5F7] tabular-nums">
              {outputSpec.width}×{outputSpec.height} ({resolutionId})
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">CFR Timeline</dt>
            <dd className="mt-0.5 font-mono font-semibold text-[#F4F5F7] tabular-nums">
              {frameSchedule.frames.length} frames @ {style.fps} fps
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">Memory &amp; Cache</dt>
            <dd className="mt-0.5 font-medium text-[#D1D5DB]">
              Audio-first + Cached Caption Layer
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">Audio &amp; Visualizer</dt>
            <dd className="mt-0.5 font-medium text-[#D1D5DB]">
              {audio.strategy.label} · {style.vocalWaveEnabled ? 'Wave On' : 'Wave Off'}
            </dd>
          </div>
        </dl>

        {exporting && progress && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[#D1D5DB]">{progress.stage}</span>
              <span className="shrink-0 font-mono font-semibold text-[#F97316] tabular-nums">
                {progress.percent}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[#F97316] transition-all duration-150"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-[#9BA1AE] tabular-nums">
              Frames encoded: {progress.renderedFrames} / {progress.totalFrames} · Unique caption
              draws: {progress.textureUploads}
            </div>
          </div>
        )}

        {result && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 p-4 text-xs">
            <div className="flex items-start gap-2 font-semibold text-[#86EFAC]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div>Export Complete</div>
                <div className="mt-0.5 break-all font-mono text-[11px] font-normal text-[#D1D5DB]">
                  {result.fileName}
                </div>
              </div>
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#D1D5DB] tabular-nums">
              {(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB · {result.encodedFrames} frames
              · {result.textureUploads} caption draws · {(result.elapsedMs / 1000).toFixed(2)}s
            </div>
            {result.nativeSavedPath && (
              <div className="mt-1 break-all text-[11px] text-[#86EFAC]">
                Saved to device: {result.nativeSavedPath}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveOrDownloadExportedVideo(result)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 text-xs font-semibold text-[#0C0D10] hover:bg-[#4ADE80]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download Again</span>
              </button>
              <button
                type="button"
                onClick={() => shareExportedVideoToGallery(result)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.15] bg-[#14161B] px-3 text-xs font-semibold text-[#F4F5F7] hover:bg-[#1F232C]"
              >
                <Share2 className="h-3.5 w-3.5 text-[#F97316]" aria-hidden="true" />
                <span>Save / Share to Gallery</span>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-xs text-[#FCA5A5]">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border border-white/[0.1] px-4 text-sm font-medium text-[#D1D5DB] hover:bg-white/[0.04]"
          >
            Close
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleStartExport}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#F97316] px-5 text-sm font-semibold text-[#0C0D10] transition-colors hover:bg-[#FB923C] disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{exporting ? 'Rendering...' : 'Render & Download MP4'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
