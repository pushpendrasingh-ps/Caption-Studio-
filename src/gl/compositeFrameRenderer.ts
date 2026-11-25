import type { AudioEnergyEnvelope } from '../core/audioEnvelope';
import { computeKenBurnsTransform } from '../core/srtEngine';
import type { ActiveCaptionState, CaptionStyle, FontOption } from '../core/types';
import {
  buildCaptionStyleHash,
  renderCaptionToTransparentCanvas,
  type RenderedCaptionBitmap,
} from './captionTextureRenderer';
import {
  renderChannelLogoOverlay,
  renderProgressBarOverlay,
  renderVocalWaveOverlay,
  type NormalizedRect,
} from './overlayRenderers';

export interface FrameHitRects {
  caption: NormalizedRect | null;
  vocalWave: NormalizedRect | null;
  logo: NormalizedRect | null;
}

export interface CompositeRenderParams {
  timeMs: number;
  durationMs: number;
  captionState: ActiveCaptionState;
  style: CaptionStyle;
  font: FontOption;
  audioEnvelope: AudioEnergyEnvelope | null;
  logoImage: HTMLImageElement | null;
  /** True when live preview is paused so Vocal Wave drops cleanly to its 2-3px flat baseline */
  forceWaveSilent?: boolean;
}

/**
 * Unified 1080p Frame Compositor shared by BOTH GpuPreviewStage (live preview)
 * and browserVideoExporter (True CFR MP4 export) for 100% WYSIWYG output.
 *
 * Fast Caching Architecture:
 * - When Slow Zoom is OFF, pre-bakes the 1080p static background image (Fill/Fit) +
 *   Background Dim + Dark Vignette ONCE into an offscreen canvas/ImageBitmap so every
 *   CFR frame only blits the cached backdrop + draws active caption, vocal wave, logo,
 *   and progress bar.
 * - When caption animation is 'none', caches the transparent caption bitmap across
 *   identical stateKeys to skip redundant text measurement & Canvas 2D stroke/fill.
 */
export class CompositeFrameRenderer {
  private readonly targetCanvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backdropCanvas: HTMLCanvasElement;
  private readonly vignetteCanvas: HTMLCanvasElement;
  private readonly captionCanvas: HTMLCanvasElement;

  private bgImage: HTMLImageElement | null = null;
  private bgVersion = 0;

  private bakedBackdropKey = '';
  private bakedBackdropBitmap: ImageBitmap | null = null;
  private bakedVignetteKey = '';

  private lastCaptionKey = '';
  private lastRenderedCaption: RenderedCaptionBitmap | null = null;

  public captionRenders = 0;

  constructor(targetCanvas: HTMLCanvasElement) {
    this.targetCanvas = targetCanvas;
    const ctx = targetCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Unable to acquire 2D rendering context');
    this.ctx = ctx;

    this.backdropCanvas = document.createElement('canvas');
    this.vignetteCanvas = document.createElement('canvas');
    this.captionCanvas = document.createElement('canvas');
  }

  public setBackgroundImage(image: HTMLImageElement | null): void {
    this.bgImage = image;
    this.bgVersion++;
    this.bakedBackdropKey = '';
    if (this.bakedBackdropBitmap) {
      this.bakedBackdropBitmap.close();
      this.bakedBackdropBitmap = null;
    }
  }

  /**
   * Optional async pre-bake to GPU-backed ImageBitmap right before True CFR MP4 export
   * when Slow Zoom is OFF for maximum blit throughput.
   */
  public async prepareStaticBackdropBitmap(
    width: number,
    height: number,
    style: CaptionStyle
  ): Promise<void> {
    this.ensureStaticBackdropBaked(width, height, style);
    if (typeof createImageBitmap !== 'undefined') {
      if (this.bakedBackdropBitmap) {
        this.bakedBackdropBitmap.close();
      }
      this.bakedBackdropBitmap = await createImageBitmap(this.backdropCanvas);
    }
  }

  private ensureStaticBackdropBaked(width: number, height: number, style: CaptionStyle): void {
    const key = [
      width,
      height,
      this.bgVersion,
      style.bgFitMode,
      style.backgroundDim.toFixed(3),
      style.vignetteStrength.toFixed(3),
    ].join('|');

    if (key === this.bakedBackdropKey) return;

    this.backdropCanvas.width = width;
    this.backdropCanvas.height = height;
    const bctx = this.backdropCanvas.getContext('2d', { alpha: false });
    if (!bctx) return;

    bctx.fillStyle = '#090A0D';
    bctx.fillRect(0, 0, width, height);

    if (this.bgImage && this.bgImage.naturalWidth > 0) {
      drawImageWithFitMode(bctx, this.bgImage, width, height, style.bgFitMode, 1, 0, 0);
    }

    if (style.backgroundDim > 0.005) {
      bctx.fillStyle = `rgba(0, 0, 0, ${style.backgroundDim})`;
      bctx.fillRect(0, 0, width, height);
    }

    if (style.vignetteStrength > 0.005) {
      const grad = bctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.24,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, `rgba(0, 0, 0, ${style.vignetteStrength * 0.88})`);
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, width, height);
    }

    this.bakedBackdropKey = key;
    if (this.bakedBackdropBitmap) {
      this.bakedBackdropBitmap.close();
      this.bakedBackdropBitmap = null;
    }
  }

  private ensureVignetteOverlayBaked(width: number, height: number, style: CaptionStyle): void {
    const key = `${width}|${height}|${style.backgroundDim.toFixed(3)}|${style.vignetteStrength.toFixed(3)}`;
    if (key === this.bakedVignetteKey) return;

    this.vignetteCanvas.width = width;
    this.vignetteCanvas.height = height;
    const vctx = this.vignetteCanvas.getContext('2d');
    if (!vctx) return;

    vctx.clearRect(0, 0, width, height);
    if (style.backgroundDim > 0.005) {
      vctx.fillStyle = `rgba(0, 0, 0, ${style.backgroundDim})`;
      vctx.fillRect(0, 0, width, height);
    }
    if (style.vignetteStrength > 0.005) {
      const grad = vctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.24,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, `rgba(0, 0, 0, ${style.vignetteStrength * 0.88})`);
      vctx.fillStyle = grad;
      vctx.fillRect(0, 0, width, height);
    }
    this.bakedVignetteKey = key;
  }

  public render(params: CompositeRenderParams): FrameHitRects {
    const {
      timeMs,
      durationMs,
      captionState,
      style,
      font,
      audioEnvelope,
      logoImage,
      forceWaveSilent = false,
    } = params;

    const width = this.targetCanvas.width;
    const height = this.targetCanvas.height;
    const ctx = this.ctx;

    // 1. Background Layer (Pre-baked static blit OR Ken Burns Slow Zoom)
    if (!style.slowZoom) {
      this.ensureStaticBackdropBaked(width, height, style);
      if (this.bakedBackdropBitmap) {
        ctx.drawImage(this.bakedBackdropBitmap, 0, 0);
      } else {
        ctx.drawImage(this.backdropCanvas, 0, 0);
      }
    } else {
      ctx.fillStyle = '#090A0D';
      ctx.fillRect(0, 0, width, height);
      if (this.bgImage && this.bgImage.naturalWidth > 0) {
        const kb = computeKenBurnsTransform(timeMs, durationMs, true);
        drawImageWithFitMode(
          ctx,
          this.bgImage,
          width,
          height,
          style.bgFitMode,
          kb.scale,
          kb.offsetX,
          kb.offsetY
        );
      }
      if (style.backgroundDim > 0.005 || style.vignetteStrength > 0.005) {
        this.ensureVignetteOverlayBaked(width, height, style);
        ctx.drawImage(this.vignetteCanvas, 0, 0);
      }
    }

    // 2. Vocal Wave Visualizer Layer
    const vocalWaveRect = renderVocalWaveOverlay(
      ctx,
      width,
      height,
      style,
      audioEnvelope,
      timeMs,
      forceWaveSilent
    );

    // 3. Animated Caption Layer (with static cache bypass when animation === 'none')
    let captionRect: NormalizedRect | null = null;
    if (captionState.cue && captionState.words.length > 0) {
      const styleHash = buildCaptionStyleHash(style, font);
      const isAnimated = style.animation !== 'none';
      const cacheKey = isAnimated
        ? `${captionState.stateKey}#${styleHash}@${Math.round(timeMs)}`
        : `${captionState.stateKey}#${styleHash}`;

      if (cacheKey !== this.lastCaptionKey) {
        this.lastRenderedCaption = renderCaptionToTransparentCanvas(
          captionState,
          style,
          font,
          width,
          height,
          timeMs,
          this.captionCanvas
        );
        this.lastCaptionKey = cacheKey;
        if (this.lastRenderedCaption) {
          this.captionRenders++;
        }
      }

      if (this.lastRenderedCaption) {
        const cap = this.lastRenderedCaption;
        // Clamp core box inside frame cleanly, then offset by animation headroom margin
        const boxLeft = Math.max(
          0,
          Math.min(width - cap.boxWidth, style.positionX * width - cap.boxWidth * 0.5)
        );
        const boxTop = Math.max(
          0,
          Math.min(height - cap.boxHeight, style.positionY * height - cap.boxHeight * 0.5)
        );
        ctx.drawImage(cap.canvas, boxLeft - cap.marginX, boxTop - cap.marginY);

        captionRect = {
          x: boxLeft / width,
          y: boxTop / height,
          width: cap.boxWidth / width,
          height: cap.boxHeight / height,
        };
      }
    } else {
      this.lastCaptionKey = 'EMPTY';
      this.lastRenderedCaption = null;
    }

    // 4. Channel Logo Watermark Layer
    const logoRect = renderChannelLogoOverlay(ctx, width, height, style, logoImage);

    // 5. Video Progress Bar Layer (always crisp on top edge/bottom edge)
    renderProgressBarOverlay(ctx, width, height, style, timeMs, durationMs);

    return {
      caption: captionRect,
      vocalWave: vocalWaveRect,
      logo: logoRect,
    };
  }

  public dispose(): void {
    if (this.bakedBackdropBitmap) {
      this.bakedBackdropBitmap.close();
      this.bakedBackdropBitmap = null;
    }
  }
}

function drawImageWithFitMode(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  fitMode: 'fill' | 'fit',
  zoomScale: number,
  offsetX: number,
  offsetY: number
): void {
  const bgAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
  const targetAspect = width / height;

  ctx.save();
  if (zoomScale !== 1 || offsetX !== 0 || offsetY !== 0) {
    ctx.translate(width * 0.5 + offsetX * width, height * 0.5 + offsetY * height);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-width * 0.5, -height * 0.5);
  }

  if (fitMode === 'fit') {
    let drawW = width;
    let drawH = height;
    if (bgAspect > targetAspect) {
      drawH = width / bgAspect;
    } else {
      drawW = height * bgAspect;
    }
    const dx = (width - drawW) * 0.5;
    const dy = (height - drawH) * 0.5;
    ctx.drawImage(image, dx, dy, drawW, drawH);
  } else {
    let sx = 0;
    let sy = 0;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;
    if (bgAspect > targetAspect) {
      sw = sh * targetAspect;
      sx = (image.naturalWidth - sw) * 0.5;
    } else {
      sh = sw / targetAspect;
      sy = (image.naturalHeight - sh) * 0.5;
    }
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  }

  ctx.restore();
}
