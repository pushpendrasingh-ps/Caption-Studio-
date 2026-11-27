import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AndroidSourceViewer } from './components/AndroidSourceViewer';
import { CapCutToolDock } from './components/CapCutToolDock';
import { ExportModal } from './components/ExportModal';
import { GpuPreviewStage } from './components/GpuPreviewStage';
import { SubtitlesEditor } from './components/SubtitlesEditor';
import { TopBar, type WorkspaceTab } from './components/TopBar';
import {
  buildDemoVoiceEnvelope,
  computeAudioEnvelopeFromBuffer,
  type AudioEnergyEnvelope,
} from './core/audioEnvelope';
import {
  deleteFontFromDb,
  deleteLogoFromDb,
  deleteStudioImageFromDb,
  loadPersistedSettings,
  loadSavedFontsFromDb,
  loadSavedLogoFromDb,
  loadSavedStudioImagesFromDb,
  loadSavedTemplates,
  registerFontFace,
  saveFontToDb,
  saveLogoToDb,
  savePersistedSettings,
  saveStudioImageToDb,
  saveTemplatesList,
  type StoredCustomFont,
} from './core/fontStorage';
import {
  buildFrameScheduleFromPages,
  computeTimelineDurationMs,
  detectAudioStrategy,
  groupSrtCuesIntoPages,
  isWordByWordSrt,
  parseSrt,
} from './core/srtEngine';
import {
  BUILT_IN_FONTS,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_DEMO_SRT,
  DEFAULT_TYPOGRAPHY_SPACING,
  SAMPLE_BACKDROPS,
  type AspectRatioId,
  type AudioAsset,
  type CaptionStyle,
  type ExportBitrateMbps,
  type FontOption,
  type ImageAsset,
  type LogoAsset,
  type ResolutionId,
  type SavedTemplate,
  type SrtCue,
} from './core/types';

const VALID_BITRATES: ExportBitrateMbps[] = [1.2, 2.0, 3.5, 6.0];

function sanitizeBitrate(raw: unknown): ExportBitrateMbps {
  const num = Number(raw);
  if (VALID_BITRATES.includes(num as ExportBitrateMbps)) {
    return num as ExportBitrateMbps;
  }
  return 2.0;
}

export default function App() {
  // Restore persisted settings & saved templates synchronously from localStorage
  const persisted = useMemo(() => loadPersistedSettings(), []);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [aspectId, setAspectId] = useState<AspectRatioId>(persisted?.aspectId ?? '16:9');
  const [resolutionId, setResolutionId] = useState<ResolutionId>(
    persisted?.resolutionId ?? '720p'
  );
  const [bitrateMbps, setBitrateMbps] = useState<ExportBitrateMbps>(() =>
    sanitizeBitrate(persisted?.bitrateMbps)
  );
  const [exportOpen, setExportOpen] = useState(false);

  // 1. Background Image Asset + Permanent Studio Image Library (IndexedDB)
  const [imageAsset, setImageAsset] = useState<ImageAsset>(() => {
    const initialSample =
      SAMPLE_BACKDROPS.find((b) => b.id === persisted?.selectedImageId) ?? SAMPLE_BACKDROPS[0];
    return {
      id: initialSample.id,
      name: initialSample.name.split(' (')[0],
      url: initialSample.url,
      naturalWidth: 1920,
      naturalHeight: 1080,
      isCustom: false,
    };
  });
  const [savedStudioImages, setSavedStudioImages] = useState<ImageAsset[]>([]);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);

  // Channel Logo / Watermark Asset (persisted in IndexedDB)
  const [logoAsset, setLogoAsset] = useState<LogoAsset | null>(null);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);

  // 2. Audio Asset + Real Multi-Band Energy Envelope
  const [audioAsset, setAudioAsset] = useState<AudioAsset>({
    name: 'narration_demo.m4a',
    durationMs: 14_700,
    url: null,
    file: null,
    isDemo: true,
    strategy: detectAudioStrategy('narration_demo.m4a', 'audio/mp4'),
  });
  const [realAudioEnvelope, setRealAudioEnvelope] = useState<AudioEnergyEnvelope | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // 3. Raw Word-by-Word SRT Cues
  const [srtFileName, setSrtFileName] = useState('whisper_word_sync.srt');
  const [cues, setCues] = useState<SrtCue[]>(() => parseSrt(DEFAULT_DEMO_SRT));

  // Built-in + Permanent IndexedDB Custom Fonts
  const [fonts, setFonts] = useState<FontOption[]>(BUILT_IN_FONTS);
  const [fontUploadError, setFontUploadError] = useState<string | null>(null);

  // Saved Custom Templates ("Save My Preset") persisted in localStorage
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(() => loadSavedTemplates());

  // Caption, Vocal Wave, Logo & Progress Bar Style (restored from localStorage)
  const [style, setStyle] = useState<CaptionStyle>(() => ({
    ...DEFAULT_CAPTION_STYLE,
    ...(persisted?.style ?? {}),
  }));

  // Playback State (starts at 1.32s so word "ES" inside first 6-word group is highlighted immediately)
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(1_320);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Load permanently saved custom fonts, channel logo, and Studio Image Library from IndexedDB on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedFonts, savedLogo, savedImages] = await Promise.all([
        loadSavedFontsFromDb(),
        loadSavedLogoFromDb(),
        loadSavedStudioImagesFromDb(),
      ]);
      if (cancelled) return;

      if (savedFonts.length > 0) {
        const loadedOptions: FontOption[] = [];
        for (const item of savedFonts) {
          try {
            await registerFontFace(item.familyName, item.buffer);
            loadedOptions.push({
              id: item.id,
              label: item.label,
              family: `"${item.familyName}", sans-serif`,
              weight: 700,
              isCustom: true,
              fileName: item.fileName,
            });
          } catch {
            // Skip corrupted font entry
          }
        }
        if (!cancelled && loadedOptions.length > 0) {
          setFonts([...BUILT_IN_FONTS, ...loadedOptions]);
        }
      }

      if (!cancelled && savedLogo) {
        const blob = new Blob([savedLogo.buffer], { type: savedLogo.mimeType || 'image/png' });
        const url = URL.createObjectURL(blob);
        setLogoAsset({ name: savedLogo.fileName, url });
      }

      if (!cancelled && savedImages.length > 0) {
        const restoredAssets: ImageAsset[] = savedImages.map((item) => {
          const blob = new Blob([item.buffer], { type: item.mimeType || 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          return {
            id: item.id,
            name: item.name,
            url,
            naturalWidth: 1920,
            naturalHeight: 1080,
            isCustom: true,
          };
        });
        setSavedStudioImages(restoredAssets);

        // If user previously had a custom studio image active, restore it automatically
        if (persisted?.selectedImageId) {
          const match = restoredAssets.find((img) => img.id === persisted.selectedImageId);
          if (match) {
            setImageAsset(match);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persisted?.selectedImageId]);

  // Persist user style, aspect ratio, resolution, bitrate, and active image ID to localStorage
  useEffect(() => {
    savePersistedSettings({
      style,
      aspectId,
      resolutionId,
      bitrateMbps,
      selectedImageId: imageAsset.id,
    });
  }, [style, aspectId, resolutionId, bitrateMbps, imageAsset.id]);

  // Persist Saved Custom Templates to localStorage
  useEffect(() => {
    saveTemplatesList(savedTemplates);
  }, [savedTemplates]);

  const wordByWordDetected = useMemo(() => isWordByWordSrt(cues), [cues]);

  // Live Word-by-Word Smart Grouping (1 to 100 words per screen)
  const groupedPages = useMemo(
    () => groupSrtCuesIntoPages(cues, style.wordsOnScreen),
    [cues, style.wordsOnScreen]
  );

  const durationMs = useMemo(
    () => computeTimelineDurationMs(cues, audioAsset.durationMs),
    [cues, audioAsset.durationMs]
  );

  // Active Audio Envelope: real decoded FFT/RMS envelope for uploaded audio, or voice-synced demo envelope
  const demoEnvelope = useMemo(
    () => buildDemoVoiceEnvelope(groupedPages, durationMs),
    [groupedPages, durationMs]
  );
  const activeAudioEnvelope = realAudioEnvelope ?? demoEnvelope;

  const frameSchedule = useMemo(
    () =>
      buildFrameScheduleFromPages(
        groupedPages,
        durationMs,
        style.slowZoom,
        style.wordKaraoke,
        style.fps
      ),
    [groupedPages, durationMs, style.slowZoom, style.wordKaraoke, style.fps]
  );

  const activeFont = useMemo(
    () => fonts.find((f) => f.id === style.fontId) ?? fonts[0],
    [fonts, style.fontId]
  );

  // Decode Background Image Element whenever imageAsset.url changes
  useEffect(() => {
    let cancelled = false;
    setImageLoadError(null);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      setImageElement(img);
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageLoadError('Could not decode the selected background image.');
    };
    img.src = imageAsset.url;

    return () => {
      cancelled = true;
    };
  }, [imageAsset.url]);

  // Decode Channel Logo Image Element whenever logoAsset changes
  useEffect(() => {
    if (!logoAsset) {
      setLogoImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) setLogoImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setLogoImage(null);
    };
    img.src = logoAsset.url;

    return () => {
      cancelled = true;
    };
  }, [logoAsset]);

  // Synchronized playback loop — ONLY runs requestAnimationFrame while isPlaying is true
  useEffect(() => {
    if (!isPlaying) {
      audioElRef.current?.pause();
      return;
    }

    const audioEl = audioElRef.current;
    if (audioEl && audioAsset.url) {
      audioEl.currentTime = currentTimeMs / 1000;
      audioEl.play().catch(() => {});
    }

    let rafId = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      const dt = now - lastTick;
      lastTick = now;

      if (audioEl && audioAsset.url && !audioEl.paused) {
        const nextMs = Math.round(audioEl.currentTime * 1000);
        if (nextMs >= durationMs) {
          setCurrentTimeMs(0);
          setIsPlaying(false);
          return;
        }
        setCurrentTimeMs(nextMs);
      } else {
        setCurrentTimeMs((prev) => {
          const next = prev + dt;
          if (next >= durationMs) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      audioEl?.pause();
    };
  }, [isPlaying, durationMs, audioAsset.url]);

  const handleUpdateStyle = useCallback((patch: Partial<CaptionStyle>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleResetSpacing = useCallback(() => {
    setStyle((prev) => ({
      ...prev,
      ...DEFAULT_TYPOGRAPHY_SPACING,
    }));
  }, []);

  const handleResetAllStyle = useCallback(() => {
    setStyle({ ...DEFAULT_CAPTION_STYLE });
  }, []);

  const handleUpdatePosition = useCallback((x: number, y: number) => {
    setStyle((prev) => ({
      ...prev,
      positionX: Math.max(0.05, Math.min(0.95, x)),
      positionY: Math.max(0.08, Math.min(0.92, y)),
    }));
  }, []);

  const handleNudgePosition = useCallback((dx: number, dy: number) => {
    setStyle((prev) => ({
      ...prev,
      positionX: Math.max(0.05, Math.min(0.95, Number((prev.positionX + dx).toFixed(4)))),
      positionY: Math.max(0.08, Math.min(0.92, Number((prev.positionY + dy).toFixed(4)))),
    }));
  }, []);

  const handleCenterPosition = useCallback(() => {
    setStyle((prev) => ({ ...prev, positionX: 0.5, positionY: 0.5 }));
  }, []);

  const handleUpdateVocalWavePosition = useCallback((x: number, y: number) => {
    setStyle((prev) => ({
      ...prev,
      vocalWaveX: Math.max(0.08, Math.min(0.92, x)),
      vocalWaveY: Math.max(0.08, Math.min(0.96, y)),
    }));
  }, []);

  const handleNudgeVocalWave = useCallback((dx: number, dy: number) => {
    setStyle((prev) => ({
      ...prev,
      vocalWaveX: Math.max(0.08, Math.min(0.92, Number((prev.vocalWaveX + dx).toFixed(4)))),
      vocalWaveY: Math.max(0.08, Math.min(0.96, Number((prev.vocalWaveY + dy).toFixed(4)))),
    }));
  }, []);

  const handleResetVocalWavePosition = useCallback(() => {
    setStyle((prev) => ({ ...prev, vocalWaveX: 0.5, vocalWaveY: 0.91 }));
  }, []);

  const handleUpdateLogoPosition = useCallback((x: number, y: number) => {
    setStyle((prev) => ({
      ...prev,
      logoX: Math.max(0.05, Math.min(0.95, x)),
      logoY: Math.max(0.05, Math.min(0.95, y)),
    }));
  }, []);

  const handleAdjustFontSize = useCallback((delta: number) => {
    setStyle((prev) => ({
      ...prev,
      fontSizePx: Math.max(24, Math.min(140, prev.fontSizePx + delta)),
    }));
  }, []);

  const handleSelectSampleBackdrop = useCallback((backdropId: string) => {
    const sample = SAMPLE_BACKDROPS.find((b) => b.id === backdropId);
    if (!sample) return;
    setImageAsset({
      id: sample.id,
      name: sample.name.split(' (')[0],
      url: sample.url,
      naturalWidth: 1920,
      naturalHeight: 1080,
      isCustom: false,
    });
    setAspectId(sample.recommendedAspect);
  }, []);

  const handleSelectStudioImage = useCallback((img: ImageAsset) => {
    setImageAsset(img);
  }, []);

  const handleDeleteStudioImage = useCallback(async (id: string) => {
    try {
      await deleteStudioImageFromDb(id);
    } catch {
      // Continue removing from memory state even if IndexedDB fails
    }
    setSavedStudioImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.url.startsWith('blob:')) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((item) => item.id !== id);
    });
    setImageAsset((prev) => {
      if (prev.id !== id) return prev;
      return {
        id: SAMPLE_BACKDROPS[0].id,
        name: SAMPLE_BACKDROPS[0].name.split(' (')[0],
        url: SAMPLE_BACKDROPS[0].url,
        naturalWidth: 1920,
        naturalHeight: 1080,
        isCustom: false,
      };
    });
  }, []);

  const handleUploadImage = useCallback(async (file: File) => {
    const id = `studio_img_${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    const nextAsset: ImageAsset = {
      id,
      name: file.name,
      url: objectUrl,
      naturalWidth: 1920,
      naturalHeight: 1080,
      isCustom: true,
    };

    setImageAsset(nextAsset);
    setSavedStudioImages((prev) => [nextAsset, ...prev]);

    try {
      const buffer = await file.arrayBuffer();
      await saveStudioImageToDb({
        id,
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        buffer,
        addedAt: Date.now(),
      });
    } catch {
      // Image still works for the current session even if IndexedDB quota is exceeded
    }
  }, []);

  const handleUploadAudio = useCallback((file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const strategy = detectAudioStrategy(file.name, file.type);

    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const detectedMs =
        Number.isFinite(probe.duration) && probe.duration > 0
          ? Math.round(probe.duration * 1000)
          : 15_000;
      setAudioAsset((prev) => {
        if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
        return {
          name: file.name,
          durationMs: detectedMs,
          url: objectUrl,
          file,
          isDemo: false,
          strategy,
        };
      });
    };
    probe.onerror = () => {
      setAudioAsset((prev) => {
        if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
        return {
          name: file.name,
          durationMs: 15_000,
          url: objectUrl,
          file,
          isDemo: false,
          strategy,
        };
      });
    };
    probe.src = objectUrl;

    // Decode PCM asynchronously & pre-compute real multi-band FFT/RMS energy envelope for Vocal Wave
    (async () => {
      try {
        const arrayBuf = await file.arrayBuffer();
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        try {
          const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
          const env = computeAudioEnvelopeFromBuffer(decoded);
          setRealAudioEnvelope(env);
        } finally {
          await ctx.close();
        }
      } catch {
        setRealAudioEnvelope(null);
      }
    })();
  }, []);

  const handleUploadSrt = useCallback(async (file: File) => {
    const text = await file.text();
    const parsed = parseSrt(text);
    if (parsed.length > 0) {
      setCues(parsed);
      setSrtFileName(file.name);
      setCurrentTimeMs(parsed[0].startMs + 25);
    }
  }, []);

  const handleUploadCustomFont = useCallback(async (file: File) => {
    setFontUploadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const baseName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
      const id = `custom_font_${Date.now()}`;
      const familyName = `CSFont_${Date.now()}`;

      await registerFontFace(familyName, buffer);

      const record: StoredCustomFont = {
        id,
        label: baseName,
        familyName,
        fileName: file.name,
        buffer,
        addedAt: Date.now(),
      };
      await saveFontToDb(record);

      const newOption: FontOption = {
        id,
        label: baseName,
        family: `"${familyName}", sans-serif`,
        weight: 700,
        isCustom: true,
        fileName: file.name,
      };
      setFonts((prev) => [...prev, newOption]);
      setStyle((prev) => ({ ...prev, fontId: id }));
    } catch {
      setFontUploadError('Could not load font file. Please select a valid .TTF, .OTF, or .WOFF2 font.');
    }
  }, []);

  const handleDeleteCustomFont = useCallback(async (fontId: string) => {
    try {
      await deleteFontFromDb(fontId);
    } catch {
      // Remove from UI state even if DB transaction fails
    }
    setFonts((prev) => prev.filter((f) => f.id !== fontId));
    setStyle((prev) => (prev.fontId === fontId ? { ...prev, fontId: BUILT_IN_FONTS[0].id } : prev));
  }, []);

  const handleUploadLogo = useCallback(async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      await saveLogoToDb(file.name, file.type || 'image/png', buffer);
      const blob = new Blob([buffer], { type: file.type || 'image/png' });
      const url = URL.createObjectURL(blob);
      setLogoAsset((prev) => {
        if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
        return { name: file.name, url };
      });
      setStyle((prev) => ({ ...prev, logoEnabled: true }));
    } catch {
      // Ignore logo decode failures cleanly
    }
  }, []);

  const handleDeleteLogo = useCallback(async () => {
    try {
      await deleteLogoFromDb();
    } catch {
      // Continue clearing state
    }
    setLogoAsset((prev) => {
      if (prev?.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      return null;
    });
    setLogoImage(null);
  }, []);

  const handleSaveTemplate = useCallback(
    (name: string) => {
      const next: SavedTemplate = {
        id: `tpl-${Date.now()}`,
        name,
        createdAt: Date.now(),
        style: { ...style },
        aspectId,
        bitrateMbps,
      };
      setSavedTemplates((prev) => [next, ...prev]);
    },
    [style, aspectId, bitrateMbps]
  );

  const handleApplyTemplate = useCallback((tpl: SavedTemplate) => {
    setStyle((prev) => ({ ...prev, ...tpl.style }));
    setAspectId(tpl.aspectId);
    setBitrateMbps(sanitizeBitrate(tpl.bitrateMbps));
  }, []);

  const handleDeleteTemplate = useCallback((id: string) => {
    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSeek = useCallback(
    (timeMs: number) => {
      const clamped = Math.max(0, Math.min(durationMs, timeMs));
      setCurrentTimeMs(clamped);
      if (audioElRef.current && audioAsset.url) {
        audioElRef.current.currentTime = clamped / 1000;
      }
    },
    [durationMs, audioAsset.url]
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0C0D10] text-[#F4F5F7]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        aspectId={aspectId}
        onChangeAspect={setAspectId}
        resolutionId={resolutionId}
        onChangeResolution={setResolutionId}
        onOpenExport={() => setExportOpen(true)}
      />

      {audioAsset.url && (
        <audio ref={audioElRef} src={audioAsset.url} preload="auto" className="hidden" />
      )}

      {activeTab === 'studio' && (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <GpuPreviewStage
            aspectId={aspectId}
            resolutionId={resolutionId}
            imageElement={imageElement}
            imageLoadError={imageLoadError}
            logoImage={logoImage}
            audio={audioAsset}
            audioEnvelope={activeAudioEnvelope}
            pages={groupedPages}
            durationMs={durationMs}
            currentTimeMs={currentTimeMs}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            style={style}
            activeFont={activeFont}
            frameSchedule={frameSchedule}
            onUpdatePosition={handleUpdatePosition}
            onUpdateVocalWavePosition={handleUpdateVocalWavePosition}
            onUpdateLogoPosition={handleUpdateLogoPosition}
          />

          <CapCutToolDock
            aspectId={aspectId}
            onChangeAspect={setAspectId}
            imageAsset={imageAsset}
            savedStudioImages={savedStudioImages}
            audioAsset={audioAsset}
            logoAsset={logoAsset}
            srtFileName={srtFileName}
            rawCueCount={cues.length}
            groupedPageCount={groupedPages.length}
            isWordByWord={wordByWordDetected}
            style={style}
            fonts={fonts}
            savedTemplates={savedTemplates}
            frameSchedule={frameSchedule}
            onUploadImage={handleUploadImage}
            onSelectSampleBackdrop={handleSelectSampleBackdrop}
            onSelectStudioImage={handleSelectStudioImage}
            onDeleteStudioImage={handleDeleteStudioImage}
            onUploadAudio={handleUploadAudio}
            onUploadSrt={handleUploadSrt}
            onUploadCustomFont={handleUploadCustomFont}
            onDeleteCustomFont={handleDeleteCustomFont}
            onUploadLogo={handleUploadLogo}
            onDeleteLogo={handleDeleteLogo}
            onSaveTemplate={handleSaveTemplate}
            onApplyTemplate={handleApplyTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onOpenSubtitlesTab={() => setActiveTab('subtitles')}
            onUpdateStyle={handleUpdateStyle}
            onResetSpacing={handleResetSpacing}
            onResetAllStyle={handleResetAllStyle}
            onNudgePosition={handleNudgePosition}
            onCenterPosition={handleCenterPosition}
            onNudgeVocalWave={handleNudgeVocalWave}
            onResetVocalWavePosition={handleResetVocalWavePosition}
            onAdjustFontSize={handleAdjustFontSize}
            fontUploadError={fontUploadError}
          />
        </main>
      )}

      {activeTab === 'subtitles' && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <SubtitlesEditor
            cues={cues}
            pages={groupedPages}
            isWordByWord={wordByWordDetected}
            wordsOnScreen={style.wordsOnScreen}
            onChangeWordsOnScreen={(wordsOnScreen) => handleUpdateStyle({ wordsOnScreen })}
            srtFileName={srtFileName}
            frameSchedule={frameSchedule}
            slowZoom={style.slowZoom}
            onUpdateCues={(nextCues, nextName) => {
              setCues(nextCues);
              if (nextName) setSrtFileName(nextName);
            }}
            onJumpToTime={(ms) => {
              handleSeek(ms);
              setActiveTab('studio');
            }}
          />
        </main>
      )}

      {activeTab === 'android' && (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-[1440px]">
            <AndroidSourceViewer />
          </div>
        </main>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        aspectId={aspectId}
        resolutionId={resolutionId}
        onChangeResolution={setResolutionId}
        imageElement={imageElement}
        logoImage={logoImage}
        audio={audioAsset}
        audioEnvelope={activeAudioEnvelope}
        pages={groupedPages}
        durationMs={durationMs}
        style={style}
        activeFont={activeFont}
        frameSchedule={frameSchedule}
        bitrateMbps={bitrateMbps}
        onChangeBitrateMbps={setBitrateMbps}
        onChangeFps={(fps) => handleUpdateStyle({ fps })}
      />
    </div>
  );
}
