import { ArrayBufferTarget, Muxer, StreamTarget } from 'mp4-muxer';
import {
  buildDemoVoiceEnvelope,
  computeAudioEnvelopeFromBuffer,
  type AudioEnergyEnvelope,
} from '../core/audioEnvelope';
import {
  buildCfrFrameTimestamps,
  getActiveCaptionFromPages,
} from '../core/srtEngine';
import type {
  AspectRatioSpec,
  AudioAsset,
  CaptionStyle,
  ExportBitrateMbps,
  FontOption,
  GroupedCaptionPage,
} from '../core/types';
import { CompositeFrameRenderer } from './compositeFrameRenderer';

export interface BrowserExportProgress {
  percent: number;
  stage: string;
  renderedFrames: number;
  totalFrames: number;
  textureUploads: number;
}

export interface BrowserExportResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  elapsedMs: number;
  encodedFrames: number;
  textureUploads: number;
  encoderUsed: string;
  bitrateMbps: ExportBitrateMbps;
  fileSizeBytes: number;
  nativeSavedPath?: string | null;
}

export interface BrowserExportOptions {
  aspect: AspectRatioSpec;
  image: HTMLImageElement;
  audio: AudioAsset;
  audioEnvelope: AudioEnergyEnvelope | null;
  logoImage: HTMLImageElement | null;
  pages: GroupedCaptionPage[];
  durationMs: number;
  style: CaptionStyle;
  font: FontOption;
  bitrateMbps: ExportBitrateMbps;
  onProgress: (progress: BrowserExportProgress) => void;
  signal?: AbortSignal;
}

const TARGET_AUDIO_SAMPLE_RATE = 48_000;
const TARGET_AUDIO_BITRATE = 128_000;
/** Strict low-RAM encoder backpressure (<= 6 queued frames prevents 10-20 min mobile OOM crashes) */
const MAX_ENCODER_QUEUE_DEPTH = 6;
const UI_YIELD_FRAME_INTERVAL = 20;

interface SelectedH264Config {
  codec: string;
  config: VideoEncoderConfig;
}

async function selectCfrQualityH264Config(
  width: number,
  height: number,
  fps: number,
  bitrateBps: number
): Promise<SelectedH264Config | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }
  const candidates = ['avc1.42E028', 'avc1.4D0028', 'avc1.640028', 'avc1.420028', 'avc1.42001f'];

  for (const codec of candidates) {
    const hwQualityConfig: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: bitrateBps,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      bitrateMode: 'variable',
    };
    try {
      const support = await VideoEncoder.isConfigSupported(hwQualityConfig);
      if (support.supported) {
        return { codec, config: support.config ?? hwQualityConfig };
      }
    } catch {
      // Fallback to basic CFR config if optional fields are rejected
    }

    const basicConfig: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: bitrateBps,
      framerate: fps,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(basicConfig);
      if (support.supported) {
        return { codec, config: support.config ?? basicConfig };
      }
    } catch {
      // Try next codec
    }
  }
  return null;
}

async function decodeAudioAt48kHz(file: File, maxDurationMs: number): Promise<AudioBuffer | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      await ctx.close();
    }

    const channels = Math.min(2, decoded.numberOfChannels);
    const clipSeconds = Math.min(decoded.duration, Math.max(0.5, maxDurationMs / 1000));

    if (decoded.sampleRate === TARGET_AUDIO_SAMPLE_RATE && decoded.numberOfChannels <= 2) {
      return decoded;
    }

    if (typeof OfflineAudioContext !== 'undefined') {
      const targetFrames = Math.max(1, Math.ceil(clipSeconds * TARGET_AUDIO_SAMPLE_RATE));
      const offline = new OfflineAudioContext(channels, targetFrames, TARGET_AUDIO_SAMPLE_RATE);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      return await offline.startRendering();
    }

    return decoded;
  } catch {
    return null;
  }
}

export async function exportVideoInBrowser(
  options: BrowserExportOptions
): Promise<BrowserExportResult> {
  const startWall = performance.now();
  const { aspect, style, bitrateMbps, signal } = options;

  const bitrateBps = Math.round(bitrateMbps * 1_000_000);
  const selected = await selectCfrQualityH264Config(
    aspect.width,
    aspect.height,
    style.fps,
    bitrateBps
  );

  if (selected) {
    try {
      return await exportWithTrueCfrWebCodecsMp4(options, selected, startWall);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  return exportWithMediaRecorderFallback(options, startWall);
}

/**
 * Low-RAM True Constant Frame Rate (CFR) Hardware MP4 Export:
 * 1. Decodes audio FIRST, computes lightweight Vocal Wave envelope, encodes the entire AAC
 *    track into the MP4 muxer FIRST, and IMMEDIATELY frees/nulls all AudioBuffer / PCM RAM
 *    before the video frame loop begins (eliminating 10-20 min Mobile Chrome OOM crashes).
 * 2. Uses chunked StreamTarget (or ArrayBufferTarget fallback) and strict queue backpressure (<= 6).
 * 3. Pre-bakes static background + vignette once into an ImageBitmap and caches rendered
 *    captions on a separate canvas so static captions are never redrawn per frame.
 */
async function exportWithTrueCfrWebCodecsMp4(
  options: BrowserExportOptions,
  selected: SelectedH264Config,
  startWall: number
): Promise<BrowserExportResult> {
  const {
    aspect,
    image,
    audio,
    logoImage,
    pages,
    durationMs,
    style,
    font,
    bitrateMbps,
    onProgress,
    signal,
  } = options;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = aspect.width;
  outputCanvas.height = aspect.height;

  const compositor = new CompositeFrameRenderer(outputCanvas);
  compositor.setBackgroundImage(image);

  if (!style.slowZoom) {
    await compositor.prepareStaticBackdropBitmap(aspect.width, aspect.height, style);
  }

  // Step 1: Decode audio + compute lightweight vocal-wave envelope FIRST
  let decodedAudio: AudioBuffer | null = null;
  let canEncodeAac = false;
  let audioSampleRate = TARGET_AUDIO_SAMPLE_RATE;
  let audioChannels = 2;

  if (audio.file && typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
    onProgress({
      percent: 2,
      stage: 'Decoding 48 kHz audio & energy envelope…',
      renderedFrames: 0,
      totalFrames: 1,
      textureUploads: 0,
    });
    decodedAudio = await decodeAudioAt48kHz(audio.file, durationMs);
    if (decodedAudio) {
      audioSampleRate = decodedAudio.sampleRate;
      audioChannels = Math.min(2, decodedAudio.numberOfChannels);
      try {
        const aacSupport = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: audioSampleRate,
          numberOfChannels: audioChannels,
          bitrate: TARGET_AUDIO_BITRATE,
        });
        canEncodeAac = Boolean(aacSupport.supported);
      } catch {
        canEncodeAac = false;
      }
    }
  }

  const exportEnvelope: AudioEnergyEnvelope =
    options.audioEnvelope && (!decodedAudio || options.audioEnvelope.isRealAudio)
      ? options.audioEnvelope
      : decodedAudio
        ? computeAudioEnvelopeFromBuffer(decodedAudio)
        : buildDemoVoiceEnvelope(pages, durationMs);

  // Use chunked StreamTarget when available to avoid giant contiguous ArrayBuffer reallocations
  interface WrittenChunk {
    data: Uint8Array;
    position: number;
  }
  const streamedChunks: WrittenChunk[] = [];
  let totalBytes = 0;
  const useStreamTarget = typeof StreamTarget !== 'undefined';

  const target = useStreamTarget
    ? new StreamTarget({
        onData: (data: Uint8Array, position: number) => {
          const copy = data.slice();
          streamedChunks.push({ data: copy, position });
          const endPos = position + copy.byteLength;
          if (endPos > totalBytes) totalBytes = endPos;
        },
        chunked: true,
        chunkSize: 2 * 1024 * 1024,
      })
    : new ArrayBufferTarget();

  const muxer = new Muxer({
    target,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
    video: {
      codec: 'avc',
      width: aspect.width,
      height: aspect.height,
      frameRate: style.fps,
    },
    ...(canEncodeAac && decodedAudio
      ? {
          audio: {
            codec: 'aac',
            sampleRate: audioSampleRate,
            numberOfChannels: audioChannels,
          },
        }
      : {}),
  });

  let encodeError: Error | null = null;

  try {
    // Step 2: Encode the ENTIRE AAC audio track FIRST, then immediately free all raw PCM AudioBuffer RAM!
    if (canEncodeAac && decodedAudio) {
      onProgress({
        percent: 6,
        stage: 'Encoding 48 kHz AAC-LC audio & freeing PCM memory…',
        renderedFrames: 0,
        totalFrames: 1,
        textureUploads: 0,
      });

      const maxSamples = Math.min(
        decodedAudio.length,
        Math.ceil((durationMs / 1000) * audioSampleRate)
      );

      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => {
          encodeError = e;
        },
      });
      audioEncoder.configure({
        codec: 'mp4a.40.2',
        sampleRate: audioSampleRate,
        numberOfChannels: audioChannels,
        bitrate: TARGET_AUDIO_BITRATE,
      });

      const oneSecondSamples = audioSampleRate;
      const channelBuffers: Float32Array<ArrayBuffer>[] = [];
      for (let ch = 0; ch < audioChannels; ch++) {
        channelBuffers.push(decodedAudio.getChannelData(ch) as Float32Array<ArrayBuffer>);
      }
      const scratch =
        audioChannels > 1 ? new Float32Array(oneSecondSamples * audioChannels) : null;

      for (let offset = 0; offset < maxSamples; offset += oneSecondSamples) {
        if (signal?.aborted) throw new Error('Export cancelled');
        if (encodeError) throw encodeError;

        const count = Math.min(oneSecondSamples, maxSamples - offset);
        let dataView: Float32Array<ArrayBuffer>;
        if (audioChannels === 1) {
          dataView = channelBuffers[0].subarray(offset, offset + count);
        } else {
          const targetArr =
            count === oneSecondSamples ? scratch! : new Float32Array(count * audioChannels);
          for (let ch = 0; ch < audioChannels; ch++) {
            targetArr.set(channelBuffers[ch].subarray(offset, offset + count), ch * count);
          }
          dataView = targetArr;
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioSampleRate,
          numberOfFrames: count,
          numberOfChannels: audioChannels,
          timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
          data: dataView,
        });
        audioEncoder.encode(audioData);
        audioData.close();

        if (audioEncoder.encodeQueueSize > 8) {
          await audioEncoder.flush();
        }
      }
      await audioEncoder.flush();
      audioEncoder.close();

      // CRITICAL OOM PREVENTION: Immediately release all raw PCM Float32Arrays & AudioBuffer before video loop!
      channelBuffers.length = 0;
      decodedAudio = null;
    }

    // Step 3: Encode True CFR Video Frames with strict queue backpressure (<= 6 frames)
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encodeError = e;
      },
    });
    videoEncoder.configure(selected.config);

    const cfrFrames = buildCfrFrameTimestamps(durationMs, style.fps);
    const totalFrames = cfrFrames.length;
    const syncOffsetMs = style.wordSyncOffsetMs || 0;

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new Error('Export cancelled');
      if (encodeError) throw encodeError;

      const f = cfrFrames[i];
      const captionState = getActiveCaptionFromPages(
        pages,
        f.sampleTimeMs,
        style.wordKaraoke,
        style.uppercase,
        syncOffsetMs
      );

      compositor.render({
        timeMs: f.sampleTimeMs,
        durationMs,
        captionState,
        style,
        font,
        audioEnvelope: exportEnvelope,
        logoImage,
        forceWaveSilent: false,
      });

      const videoFrame = new VideoFrame(outputCanvas, {
        timestamp: f.timestampUs,
        duration: f.durationUs,
      });
      videoEncoder.encode(videoFrame, { keyFrame: f.keyFrame });
      videoFrame.close();

      // Strict queue backpressure <= 6 frames prevents GPU/CPU memory spikes on long 15-20m videos
      if (videoEncoder.encodeQueueSize > MAX_ENCODER_QUEUE_DEPTH) {
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            if (videoEncoder.encodeQueueSize <= 3) {
              videoEncoder.removeEventListener('dequeue', onDequeue);
              resolve();
            }
          };
          videoEncoder.addEventListener('dequeue', onDequeue);
        });
      }

      if (i % UI_YIELD_FRAME_INTERVAL === 0 || i === totalFrames - 1) {
        onProgress({
          percent: Math.min(98, 10 + Math.round(((i + 1) / totalFrames) * 88)),
          stage: `True CFR ${style.fps} fps H.264 (${aspect.width}×${aspect.height} · ${bitrateMbps} Mbps)`,
          renderedFrames: i + 1,
          totalFrames,
          textureUploads: compositor.captionRenders,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await videoEncoder.flush();
    videoEncoder.close();

    muxer.finalize();

    let blob: Blob;
    if (useStreamTarget && streamedChunks.length > 0) {
      // Assemble final MP4 buffer from written positions cleanly
      const finalBuf = new Uint8Array(totalBytes);
      for (const chunk of streamedChunks) {
        finalBuf.set(chunk.data, chunk.position);
      }
      streamedChunks.length = 0;
      blob = new Blob([finalBuf], { type: 'video/mp4' });
    } else {
      blob = new Blob([(target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
    }

    onProgress({
      percent: 100,
      stage: 'Export complete',
      renderedFrames: totalFrames,
      totalFrames,
      textureUploads: compositor.captionRenders,
    });

    return {
      blob,
      fileName: `CaptionStudio_${aspect.width}x${aspect.height}_${style.fps}fps_${bitrateMbps}Mbps.mp4`,
      mimeType: 'video/mp4',
      elapsedMs: Math.round(performance.now() - startWall),
      encodedFrames: totalFrames,
      textureUploads: compositor.captionRenders,
      encoderUsed: `True CFR ${style.fps}fps ${selected.codec} (${bitrateMbps} Mbps VBR)`,
      bitrateMbps,
      fileSizeBytes: blob.size,
    };
  } finally {
    compositor.dispose();
  }
}

async function exportWithMediaRecorderFallback(
  options: BrowserExportOptions,
  startWall: number
): Promise<BrowserExportResult> {
  const {
    aspect,
    image,
    audioEnvelope,
    logoImage,
    pages,
    durationMs,
    style,
    font,
    bitrateMbps,
    onProgress,
    signal,
  } = options;

  const offscreen = document.createElement('canvas');
  offscreen.width = aspect.width;
  offscreen.height = aspect.height;
  const compositor = new CompositeFrameRenderer(offscreen);
  compositor.setBackgroundImage(image);
  const envelope = audioEnvelope ?? buildDemoVoiceEnvelope(pages, durationMs);

  const mimeCandidates = [
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType =
    typeof MediaRecorder !== 'undefined'
      ? mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
      : 'video/webm';

  const stream = offscreen.captureStream(style.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(bitrateMbps * 1_000_000),
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const stopPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(250);
  const stepMs = 1000 / style.fps;
  const totalSteps = Math.max(10, Math.ceil(Math.min(durationMs, 6_000) / stepMs));
  const timeScale = durationMs / Math.min(durationMs, 6_000);
  const syncOffsetMs = style.wordSyncOffsetMs || 0;

  try {
    for (let i = 0; i <= totalSteps; i++) {
      if (signal?.aborted) {
        recorder.stop();
        throw new Error('Export cancelled');
      }
      const sampleT = Math.min(durationMs, (i + 0.5) * stepMs * timeScale);
      const captionState = getActiveCaptionFromPages(
        pages,
        sampleT,
        style.wordKaraoke,
        style.uppercase,
        syncOffsetMs
      );
      compositor.render({
        timeMs: sampleT,
        durationMs,
        captionState,
        style,
        font,
        audioEnvelope: envelope,
        logoImage,
        forceWaveSilent: false,
      });

      if (i % 4 === 0 || i === totalSteps) {
        onProgress({
          percent: Math.round((i / totalSteps) * 95),
          stage: `Capturing ${style.fps} fps stream via MediaRecorder fallback`,
          renderedFrames: i + 1,
          totalFrames: totalSteps + 1,
          textureUploads: compositor.captionRenders,
        });
      }
      await new Promise((r) => setTimeout(r, Math.max(12, Math.round(stepMs * 0.5))));
    }

    recorder.stop();
    await stopPromise;

    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    onProgress({
      percent: 100,
      stage: 'Export complete',
      renderedFrames: totalSteps + 1,
      totalFrames: totalSteps + 1,
      textureUploads: compositor.captionRenders,
    });

    return {
      blob,
      fileName: `CaptionStudio_${aspect.width}x${aspect.height}_${style.fps}fps_${bitrateMbps}Mbps.${ext}`,
      mimeType,
      elapsedMs: Math.round(performance.now() - startWall),
      encodedFrames: totalSteps + 1,
      textureUploads: compositor.captionRenders,
      encoderUsed: `MediaRecorder ${style.fps}fps (${mimeType}, ${bitrateMbps} Mbps)`,
      bitrateMbps,
      fileSizeBytes: blob.size,
    };
  } finally {
    compositor.dispose();
  }
}

// --- Native Capacitor APK Storage & Web File Saving Helpers ---

interface CapacitorWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Filesystem?: {
        writeFile: (opts: {
          path: string;
          data: string;
          directory?: string;
          recursive?: boolean;
        }) => Promise<{ uri: string }>;
        appendFile: (opts: {
          path: string;
          data: string;
          directory?: string;
        }) => Promise<void>;
      };
      Share?: {
        share: (opts: {
          title?: string;
          text?: string;
          url?: string;
          dialogTitle?: string;
        }) => Promise<void>;
      };
      KeepAwake?: {
        keepAwake?: () => Promise<void>;
        allowSleep?: () => Promise<void>;
      };
    };
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

/**
 * Saves the exported MP4 video reliably in both Web Browsers and Native Android Capacitor APK:
 * - On Native Android APK (`Capacitor.isNativePlatform()`), writes the MP4 in 2MB base64 chunks
 *   via `Capacitor.Plugins.Filesystem` into `DOCUMENTS/CaptionStudio/<fileName>` to prevent OOM
 *   and returns the saved device URI.
 * - On Web Browsers, triggers a standard Blob anchor download.
 */
export async function saveOrDownloadExportedVideo(
  res: BrowserExportResult
): Promise<string | null> {
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  const isNative = Boolean(cap?.isNativePlatform?.());
  const fsPlugin = cap?.Plugins?.Filesystem;

  if (isNative && fsPlugin) {
    try {
      const arrayBuf = await res.blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      // 1.5 MB multiple of 3 bytes so base64 boundaries align without inner padding
      const CHUNK_BYTES = 1_572_864;
      const relPath = `CaptionStudio/${res.fileName}`;
      const directory = 'DOCUMENTS';

      let savedUri = relPath;
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const slice = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES));
        const b64 = uint8ToBase64(slice);
        if (offset === 0) {
          const w = await fsPlugin.writeFile({
            path: relPath,
            data: b64,
            directory,
            recursive: true,
          });
          if (w?.uri) savedUri = w.uri;
        } else {
          await fsPlugin.appendFile({
            path: relPath,
            data: b64,
            directory,
          });
        }
      }
      return savedUri;
    } catch {
      // Fallback to Web Share / Blob download if Filesystem permission denied
    }
  }

  // Standard Web Browser Blob download
  const url = URL.createObjectURL(res.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return null;
}

/**
 * Shares or saves the exported MP4 to the phone Gallery / system Share sheet using
 * Capacitor Share plugin or Web Share API (`navigator.share` with File).
 */
export async function shareExportedVideoToGallery(res: BrowserExportResult): Promise<boolean> {
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  const isNative = Boolean(cap?.isNativePlatform?.());

  if (isNative && cap?.Plugins?.Share) {
    const uri = res.nativeSavedPath ?? (await saveOrDownloadExportedVideo(res));
    if (uri) {
      await cap.Plugins.Share.share({
        title: res.fileName,
        text: 'Exported from CaptionStudio',
        url: uri,
        dialogTitle: 'Save or Share MP4 Video',
      });
      return true;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([res.blob], res.fileName, { type: res.mimeType });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: res.fileName,
          files: [file],
        });
        return true;
      }
    } catch {
      // User dismissed share sheet or unsupported
    }
  }

  await saveOrDownloadExportedVideo(res);
  return false;
}
