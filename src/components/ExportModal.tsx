import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, X } from 'lucide-react';
import type { AudioEnergyEnvelope } from '../core/audioEnvelope';
import {
  ASPECT_RATIOS,
  type AspectRatioId,
  type AudioAsset,
  type CaptionStyle,
  type ExportBitrateMbps,
  type FontOption,
  type FrameSchedule,
  type GroupedCaptionPage,
} from '../core/types';
import {
  exportVideoInBrowser,
  type BrowserExportProgress,
  type BrowserExportResult,
} from '../gl/browserVideoExporter';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  aspectId: AspectRatioId;
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
  onChangeFps: (fps: 24 | 30) => void;
}

const BITRATE_OPTIONS: Array<{ value: ExportBitrateMbps; label: string; hint: string }> = [
  { value: 3.5, label: '3.5 Mbps', hint: 'Fast 1080p' },
  { value: 6, label: '6 Mbps', hint: 'High' },
  { value: 10, label: '10 Mbps', hint: 'Master' },
];

export function ExportModal({
  open,
  onClose,
  aspectId,
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
  const aspect = ASPECT_RATIOS[aspectId];
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<BrowserExportProgress | null>(null);
  const [result, setResult] = useState<BrowserExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const triggerDownload = (res: BrowserExportResult) => {
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        aspect,
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
      setResult(res);
      triggerDownload(res);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Video export failed in this browser.');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#14161B] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="export-modal-title" className="text-lg font-semibold text-[#F4F5F7]">
              Export True CFR 1080p MP4
            </h2>
            <p className="mt-1 text-xs text-[#9BA1AE]">
              Exact Constant Frame Rate (<code className="font-mono text-[#D1D5DB]">avc1.42E028</code>{' '}
              · <code className="font-mono text-[#D1D5DB]">latencyMode: quality</code>) with
              mid-frame word sync so zero words skip or shift.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close export modal"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#9BA1AE] hover:bg-white/[0.06] hover:text-[#F4F5F7]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* True CFR Frame Rate Selector */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-[#D1D5DB]">Constant Frame Rate (True CFR)</div>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Export frame rate">
            {([
              { fps: 24 as const, label: '24 fps CFR', hint: 'Fast Default · Cinema' },
              { fps: 30 as const, label: '30 fps CFR', hint: 'Ultra-Smooth Motion' },
            ]).map((opt) => {
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
                  <span className="text-[11px] text-[#9BA1AE]">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bitrate Quality Selector */}
        <div className="mt-3.5">
          <div className="text-xs font-semibold text-[#D1D5DB]">Video Bitrate (Variable H.264)</div>
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Export video bitrate">
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
                  <span className="text-[11px] text-[#9BA1AE]">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.08] bg-[#0C0D10] p-4 text-xs">
          <div>
            <dt className="text-[#9BA1AE]">Resolution</dt>
            <dd className="mt-1 font-mono font-semibold text-[#F4F5F7] tabular-nums">
              {aspect.width}×{aspect.height} ({aspect.shortLabel})
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">CFR Timeline</dt>
            <dd className="mt-1 font-mono font-semibold text-[#F4F5F7] tabular-nums">
              {frameSchedule.frames.length} frames @ {style.fps} fps (2s GOP)
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">Backdrop Cache</dt>
            <dd className="mt-1 font-medium text-[#D1D5DB]">
              {style.slowZoom ? 'Dynamic Ken Burns zoom' : 'Pre-baked 1080p ImageBitmap'}
            </dd>
          </div>
          <div>
            <dt className="text-[#9BA1AE]">Audio &amp; Visualizer</dt>
            <dd className="mt-1 font-medium text-[#D1D5DB]">
              {audio.strategy.label} · {style.vocalWaveEnabled ? 'Wave On' : 'Wave Off'}
            </dd>
          </div>
        </dl>

        {exporting && progress && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#D1D5DB]">{progress.stage}</span>
              <span className="font-mono font-semibold text-[#F97316] tabular-nums">
                {progress.percent}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[#F97316] transition-all duration-150"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#9BA1AE] tabular-nums">
              Frames encoded: {progress.renderedFrames} / {progress.totalFrames} · Caption redraws:{' '}
              {progress.textureUploads}
            </div>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 p-4 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#86EFAC]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Export Complete — {result.fileName}</span>
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#D1D5DB] tabular-nums">
              {result.encoderUsed} · {result.encodedFrames} frames · {result.textureUploads} caption
              redraws · {(result.elapsedMs / 1000).toFixed(2)}s
            </div>
            <button
              type="button"
              onClick={() => triggerDownload(result)}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 text-xs font-semibold text-[#0C0D10]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download Again</span>
            </button>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-xs text-[#FCA5A5]">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
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
