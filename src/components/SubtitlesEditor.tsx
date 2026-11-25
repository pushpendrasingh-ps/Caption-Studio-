import React, { useMemo, useRef, useState } from 'react';
import {
  CornerDownRight,
  Download,
  Minus,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  formatMsToDisplayClock,
  formatMsToSrtTimecode,
  parseSrt,
  serializeSrt,
} from '../core/srtEngine';
import type { FrameSchedule, GroupedCaptionPage, SrtCue } from '../core/types';

interface SubtitlesEditorProps {
  cues: SrtCue[];
  pages: GroupedCaptionPage[];
  isWordByWord: boolean;
  wordsOnScreen: number;
  onChangeWordsOnScreen: (count: number) => void;
  srtFileName: string;
  frameSchedule: FrameSchedule;
  slowZoom: boolean;
  onUpdateCues: (cues: SrtCue[], fileName?: string) => void;
  onJumpToTime: (timeMs: number) => void;
}

type SubtitlesViewMode = 'grouped' | 'raw';

export function SubtitlesEditor({
  cues,
  pages,
  isWordByWord,
  wordsOnScreen,
  onChangeWordsOnScreen,
  srtFileName,
  frameSchedule,
  slowZoom,
  onUpdateCues,
  onJumpToTime,
}: SubtitlesEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewMode, setViewMode] = useState<SubtitlesViewMode>('raw');
  const [searchQuery, setSearchQuery] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredRawCues = useMemo(() => {
    if (!normalizedQuery) return cues;
    return cues.filter((c) => c.text.toLowerCase().includes(normalizedQuery));
  }, [cues, normalizedQuery]);

  const filteredPages = useMemo(() => {
    if (!normalizedQuery) return pages;
    return pages.filter((p) => p.text.toLowerCase().includes(normalizedQuery));
  }, [pages, normalizedQuery]);

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseSrt(text);
      if (parsed.length === 0) {
        setImportError('No valid SRT cue blocks were found in that file.');
        return;
      }
      setImportError(null);
      onUpdateCues(parsed, file.name);
    } catch {
      setImportError('Unable to read the selected SRT file.');
    }
  };

  const handleUpdateCueText = (id: string, text: string) => {
    onUpdateCues(cues.map((c) => (c.id === id ? { ...c, text } : c)));
  };

  const handleUpdateCueMs = (id: string, field: 'startMs' | 'endMs', secondsValue: string) => {
    const parsedSec = Number(secondsValue);
    if (Number.isNaN(parsedSec) || parsedSec < 0) return;
    const ms = Math.round(parsedSec * 1000);
    onUpdateCues(
      cues.map((c) => {
        if (c.id !== id) return c;
        if (field === 'startMs') {
          return { ...c, startMs: ms, endMs: Math.max(c.endMs, ms + 80) };
        }
        return { ...c, endMs: Math.max(c.startMs + 80, ms) };
      })
    );
  };

  const handleAddCue = () => {
    const lastEnd = cues.reduce((max, c) => Math.max(max, c.endMs), 0);
    const startMs = lastEnd > 0 ? lastEnd + 100 : 300;
    const endMs = startMs + 600;
    const next: SrtCue = {
      id: `cue-${Date.now()}-${cues.length + 1}`,
      index: cues.length + 1,
      startMs,
      endMs,
      text: 'NewWord',
    };
    onUpdateCues([...cues, next]);
  };

  const handleDeleteCue = (id: string) => {
    const remaining = cues
      .filter((c) => c.id !== id)
      .map((c, idx) => ({ ...c, index: idx + 1 }));
    onUpdateCues(remaining);
  };

  const handleDeleteGroupedPage = (page: GroupedCaptionPage) => {
    const idsToDelete = new Set(page.words.map((w) => w.rawCueId));
    const remaining = cues
      .filter((c) => !idsToDelete.has(c.id))
      .map((c, idx) => ({ ...c, index: idx + 1 }));
    onUpdateCues(remaining);
  };

  const handleDownloadSrt = () => {
    const content = serializeSrt(cues);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = srtFileName.endsWith('.srt') ? srtFileName : `${srtFileName}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 py-5 sm:px-6 lg:grid-cols-12">
      {/* Main Column: Searchable Editable Subtitles (Raw Word Cues & Grouped Pages) */}
      <section className="flex flex-col gap-4 lg:col-span-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#F4F5F7]">
              Subtitles &amp; Word-by-Word Editor
            </h1>
            <p className="mt-0.5 text-xs text-[#9BA1AE]">
              {srtFileName} · {cues.length} raw cues · {pages.length} grouped pages
              {isWordByWord ? ' · Word-level exact timestamps active' : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1C1F26] px-3 text-xs font-semibold text-[#F4F5F7] transition-colors hover:bg-[#262B35] whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 text-[#F97316]" aria-hidden="true" />
              <span>Import .SRT</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={handleDownloadSrt}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1C1F26] px-3 text-xs font-semibold text-[#F4F5F7] transition-colors hover:bg-[#262B35] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download .SRT</span>
            </button>

            <button
              type="button"
              onClick={handleAddCue}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#F97316] px-3.5 text-xs font-semibold text-[#0C0D10] transition-colors hover:bg-[#FB923C] whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Cue</span>
            </button>
          </div>
        </div>

        {/* Search Bar + Raw/Grouped Switcher + Words on Screen Quick Stepper */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
              aria-hidden="true"
            />
            <label htmlFor="subtitle-search-input" className="sr-only">
              Search subtitles
            </label>
            <input
              id="subtitle-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search words, lines, or watermarks..."
              className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#14161B] pl-9 pr-8 text-xs text-[#F4F5F7] placeholder:text-[#6B7280] focus:border-[#F97316] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear subtitle search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[#9BA1AE] hover:text-[#F4F5F7]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Subtitle view mode"
            className="inline-flex rounded-lg border border-white/[0.08] bg-[#14161B] p-0.5"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'raw'}
              onClick={() => setViewMode('raw')}
              className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'raw'
                  ? 'bg-[#262A34] text-[#F4F5F7]'
                  : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
              }`}
            >
              Raw Cues ({cues.length})
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'grouped'}
              onClick={() => setViewMode('grouped')}
              className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'grouped'
                  ? 'bg-[#262A34] text-[#F4F5F7]'
                  : 'text-[#9BA1AE] hover:text-[#F4F5F7]'
              }`}
            >
              Grouped Pages ({pages.length})
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#14161B] px-2.5 py-1">
            <span className="text-[11px] font-medium text-[#9BA1AE] whitespace-nowrap">
              Words/Screen
            </span>
            <button
              type="button"
              aria-label="Decrease words on screen in subtitles"
              onClick={() => onChangeWordsOnScreen(Math.max(1, wordsOnScreen - 1))}
              className="flex h-7 w-7 items-center justify-center rounded bg-[#1C1F26] text-[#F4F5F7] hover:bg-[#262B35]"
            >
              <Minus className="h-3 w-3" aria-hidden="true" />
            </button>
            <span className="w-6 text-center font-mono text-xs font-semibold text-[#F4F5F7] tabular-nums">
              {wordsOnScreen}
            </span>
            <button
              type="button"
              aria-label="Increase words on screen in subtitles"
              onClick={() => onChangeWordsOnScreen(Math.min(25, wordsOnScreen + 1))}
              className="flex h-7 w-7 items-center justify-center rounded bg-[#1C1F26] text-[#F4F5F7] hover:bg-[#262B35]"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>

        {importError && (
          <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-xs text-[#FCA5A5]">
            {importError}
          </div>
        )}

        {/* RAW WORD CUES LIST */}
        {viewMode === 'raw' && (
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-xl border border-white/[0.08] bg-[#14161B]">
            {filteredRawCues.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-[#9BA1AE]">
                  {searchQuery
                    ? `No cues match "${searchQuery}".`
                    : 'No subtitle cues loaded yet.'}
                </p>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={handleAddCue}
                    className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#F97316] px-4 text-xs font-semibold text-[#0C0D10]"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Add First Cue</span>
                  </button>
                )}
              </div>
            ) : (
              filteredRawCues.map((cue) => (
                <div
                  key={cue.id}
                  className="grid grid-cols-1 gap-2.5 p-3.5 sm:grid-cols-[36px_170px_1fr_auto] sm:items-center"
                >
                  <span className="font-mono text-xs font-semibold text-[#9BA1AE] tabular-nums">
                    #{cue.index}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <label htmlFor={`start-${cue.id}`} className="sr-only">
                      Start seconds for cue {cue.index}
                    </label>
                    <input
                      id={`start-${cue.id}`}
                      type="number"
                      step="0.05"
                      min="0"
                      value={(cue.startMs / 1000).toFixed(2)}
                      onChange={(e) => handleUpdateCueMs(cue.id, 'startMs', e.target.value)}
                      className="h-9 w-[76px] rounded-md border border-white/[0.1] bg-[#0C0D10] px-2 font-mono text-xs text-[#F4F5F7] tabular-nums focus:border-[#F97316] focus:outline-none"
                    />
                    <span className="text-xs text-[#6B7280]">→</span>
                    <label htmlFor={`end-${cue.id}`} className="sr-only">
                      End seconds for cue {cue.index}
                    </label>
                    <input
                      id={`end-${cue.id}`}
                      type="number"
                      step="0.05"
                      min="0.08"
                      value={(cue.endMs / 1000).toFixed(2)}
                      onChange={(e) => handleUpdateCueMs(cue.id, 'endMs', e.target.value)}
                      className="h-9 w-[76px] rounded-md border border-white/[0.1] bg-[#0C0D10] px-2 font-mono text-xs text-[#F4F5F7] tabular-nums focus:border-[#F97316] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor={`text-${cue.id}`} className="sr-only">
                      Caption text for cue {cue.index}
                    </label>
                    <input
                      id={`text-${cue.id}`}
                      type="text"
                      value={cue.text}
                      onChange={(e) => handleUpdateCueText(cue.id, e.target.value)}
                      className="h-9 w-full rounded-lg border border-white/[0.1] bg-[#0C0D10] px-3 text-sm text-[#F4F5F7] focus:border-[#F97316] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onJumpToTime(cue.startMs + 20)}
                      aria-label={`Jump to cue ${cue.index}`}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.1] bg-[#1C1F26] px-2.5 text-xs font-medium text-[#D1D5DB] hover:border-[#F97316]/60 hover:text-[#F4F5F7]"
                    >
                      <CornerDownRight className="h-3.5 w-3.5 text-[#F97316]" aria-hidden="true" />
                      <span>Jump</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete cue ${cue.index}`}
                      onClick={() => handleDeleteCue(cue.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-[#9BA1AE] transition-colors hover:border-[#EF4444]/40 hover:text-[#FCA5A5]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* GROUPED CAPTION PAGES LIST */}
        {viewMode === 'grouped' && (
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-xl border border-white/[0.08] bg-[#14161B]">
            {filteredPages.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#9BA1AE]">
                {searchQuery
                  ? `No grouped pages match "${searchQuery}".`
                  : 'No grouped pages yet.'}
              </div>
            ) : (
              filteredPages.map((page) => (
                <div key={page.id} className="flex flex-col gap-2.5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 text-xs">
                      <span className="font-mono font-semibold text-[#F97316] tabular-nums">
                        Page {page.index}
                      </span>
                      <span className="font-mono text-[#9BA1AE] tabular-nums">
                        {formatMsToSrtTimecode(page.startMs)} → {formatMsToSrtTimecode(page.endMs)}
                      </span>
                      <span className="text-[#9BA1AE]">
                        · {page.words.length} {page.words.length === 1 ? 'word' : 'words'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onJumpToTime(page.startMs + 30)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.1] bg-[#1C1F26] px-2.5 text-xs font-medium text-[#D1D5DB] hover:border-[#F97316]/60 hover:text-[#F4F5F7]"
                      >
                        <CornerDownRight className="h-3.5 w-3.5 text-[#F97316]" aria-hidden="true" />
                        <span>Jump</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete grouped page ${page.index}`}
                        onClick={() => handleDeleteGroupedPage(page)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-[#9BA1AE] hover:border-[#EF4444]/40 hover:text-[#FCA5A5]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="text-sm font-medium text-[#F4F5F7]">{page.text}</div>

                  {/* Exact per-word timestamps preserved in this grouped page */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[#9BA1AE] tabular-nums">
                    {page.words.map((w) => (
                      <button
                        key={`${page.id}-${w.wordIndex}`}
                        type="button"
                        onClick={() => onJumpToTime(w.start + 10)}
                        className="hover:text-[#F97316]"
                        title={`Jump to "${w.text}" (${w.start}ms – ${w.end}ms)`}
                      >
                        <span className="text-[#D1D5DB]">{w.text}</span>{' '}
                        <span className="text-[#6B7280]">{formatMsToDisplayClock(w.start)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Right Column: Smart Event-Frame Schedule Preview */}
      <aside className="flex flex-col gap-4 lg:col-span-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#14161B] p-5">
          <h2 className="text-sm font-semibold text-[#F4F5F7]">
            True CFR Word-Sync Frame Schedule
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#9BA1AE]">
            {slowZoom
              ? `Constant ${frameSchedule.fps} fps with Slow Zoom — monotonic VideoFrame timestamps + 2s keyframes and mid-frame word sampling (t + 0.5/fps).`
              : `Constant ${frameSchedule.fps} fps with pre-cached 1080p backdrop — latencyMode: quality prevents dropped or shifted words on every device.`}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-white/[0.08] py-3.5 text-xs">
            <div>
              <dt className="text-[#9BA1AE]">CFR Video Frames</dt>
              <dd className="mt-1 font-mono text-base font-semibold text-[#F4F5F7] tabular-nums">
                {frameSchedule.frames.length}
              </dd>
            </div>
            <div>
              <dt className="text-[#9BA1AE]">Frame Rate / GOP</dt>
              <dd className="mt-1 font-mono text-base font-semibold text-[#F97316] tabular-nums">
                {frameSchedule.fps} fps · 2s
              </dd>
            </div>
            <div>
              <dt className="text-[#9BA1AE]">Grouped Pages</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-[#D1D5DB] tabular-nums">
                {pages.length} ({wordsOnScreen}/screen)
              </dd>
            </div>
            <div>
              <dt className="text-[#9BA1AE]">Unique Word States</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-[#D1D5DB] tabular-nums">
                {frameSchedule.uniqueTextureStates}
              </dd>
            </div>
          </dl>

          <div className="mt-3.5">
            <h3 className="text-xs font-medium text-[#D1D5DB]">First 14 PTS Events</h3>
            <ul className="mt-2 max-h-64 divide-y divide-white/[0.06] overflow-y-auto font-mono text-xs tabular-nums">
              {frameSchedule.frames.slice(0, 14).map((f, idx) => (
                <li
                  key={`${f.ptsMs}-${idx}`}
                  className="flex items-center justify-between py-1.5 text-[#9BA1AE]"
                >
                  <span className="text-[#F4F5F7]">{(f.ptsMs / 1000).toFixed(3)}s</span>
                  <span>{f.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
