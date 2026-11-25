import { sampleEnvelopeBars, type AudioEnergyEnvelope } from '../core/audioEnvelope';
import type { CaptionStyle } from '../core/types';

export interface NormalizedRect {
  /** Normalized 0..1 coordinates on the video frame */
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildWaveFillStyle(
  ctx: CanvasRenderingContext2D,
  style: CaptionStyle,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): string | CanvasGradient {
  if (!style.vocalWaveGradient) {
    return style.vocalWaveColor;
  }
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, style.vocalWaveColor);
  grad.addColorStop(1, style.vocalWaveSecondaryColor);
  return grad;
}

/**
 * Renders the live audio-reactive Vocal Wave visualizer in 6 styles:
 * 1. bottom-bars (Default podcast style — 36-48 thin rounded-top bars anchored flat along a shared bottom baseline,
 *    dropping smoothly to a crisp 2-3px flat baseline whenever audio is silent or paused)
 * 2. mirrored-wave (Symmetric center sound wave)
 * 3. smooth-line (Flowing quadratic wave curve)
 * 4. dotted-eq (Stacked LED dot equalizer)
 * 5. neon-spectrum (Luminous neon glow spectrum)
 * 6. circular-ring (Radial podcast mic pulse ring)
 *
 * Returns its normalized hit-test bounding box for touch-drag positioning.
 */
export function renderVocalWaveOverlay(
  ctx: CanvasRenderingContext2D,
  videoWidth: number,
  videoHeight: number,
  style: CaptionStyle,
  envelope: AudioEnergyEnvelope | null,
  sampleTimeMs: number,
  forceSilent = false
): NormalizedRect | null {
  if (!style.vocalWaveEnabled || style.vocalWaveOpacity <= 0.01) return null;

  const shortEdge = Math.min(videoWidth, videoHeight);
  const scale = shortEdge / 1080;
  const barCount = Math.max(16, Math.min(64, Math.round(style.vocalWaveBarCount)));
  const bars = sampleEnvelopeBars(
    envelope,
    sampleTimeMs,
    barCount,
    style.vocalWaveSensitivity,
    forceSilent
  );

  const waveWidth = videoWidth * Math.max(0.2, Math.min(0.95, style.vocalWaveWidthPercent / 100));
  const maxBarHeight = shortEdge * 0.13 * Math.max(0.3, Math.min(2.0, style.vocalWaveSensitivity));
  const baselineMinH = Math.max(2, 2.6 * scale); // crisp 2-3px flat baseline when silent/paused

  const centerX = style.vocalWaveX * videoWidth;
  const anchorY = style.vocalWaveY * videoHeight;
  const leftX = Math.max(12 * scale, Math.min(videoWidth - waveWidth - 12 * scale, centerX - waveWidth * 0.5));

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, style.vocalWaveOpacity));

  let hitX = leftX;
  let hitY = anchorY - maxBarHeight;
  let hitW = waveWidth;
  let hitH = maxBarHeight + 12 * scale;

  const slotW = waveWidth / barCount;
  const thicknessRatio = Math.max(0.25, Math.min(0.9, style.vocalWaveThickness));
  const barW = Math.max(1.5 * scale, slotW * thicknessRatio);

  if (style.vocalWaveStyle === 'bottom-bars') {
    const baselineY = Math.max(maxBarHeight + 8 * scale, Math.min(videoHeight - 10 * scale, anchorY));
    ctx.fillStyle = buildWaveFillStyle(ctx, style, leftX, baselineY - maxBarHeight, leftX + waveWidth, baselineY);

    for (let i = 0; i < barCount; i++) {
      const energy = bars[i];
      const h = baselineMinH + energy * (maxBarHeight - baselineMinH);
      const bx = leftX + i * slotW + (slotW - barW) * 0.5;
      const by = baselineY - h;
      const topR = Math.min(barW * 0.5, h * 0.5);

      ctx.beginPath();
      // Flat bottom aligned strictly along baselineY, rounded top cap
      ctx.roundRect(bx, by, barW, h, [topR, topR, 0, 0]);
      ctx.fill();
    }

    hitX = leftX;
    hitY = baselineY - Math.max(maxBarHeight, 44 * scale);
    hitW = waveWidth;
    hitH = Math.max(maxBarHeight, 44 * scale) + 12 * scale;
  } else if (style.vocalWaveStyle === 'mirrored-wave') {
    const midY = Math.max(maxBarHeight * 0.55, Math.min(videoHeight - maxBarHeight * 0.55, anchorY));
    ctx.fillStyle = buildWaveFillStyle(ctx, style, leftX, midY - maxBarHeight * 0.5, leftX + waveWidth, midY + maxBarHeight * 0.5);

    for (let i = 0; i < barCount; i++) {
      const energy = bars[i];
      const h = baselineMinH + energy * (maxBarHeight - baselineMinH);
      const bx = leftX + i * slotW + (slotW - barW) * 0.5;
      const by = midY - h * 0.5;
      const r = Math.min(barW * 0.5, h * 0.5);

      ctx.beginPath();
      ctx.roundRect(bx, by, barW, h, r);
      ctx.fill();
    }

    hitX = leftX;
    hitY = midY - Math.max(maxBarHeight * 0.55, 28 * scale);
    hitW = waveWidth;
    hitH = Math.max(maxBarHeight * 1.1, 56 * scale);
  } else if (style.vocalWaveStyle === 'smooth-line') {
    const baselineY = Math.max(maxBarHeight + 8 * scale, Math.min(videoHeight - 10 * scale, anchorY));
    const strokeStyle = buildWaveFillStyle(ctx, style, leftX, baselineY - maxBarHeight, leftX + waveWidth, baselineY);

    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < barCount; i++) {
      const x = leftX + (barCount > 1 ? (i / (barCount - 1)) * waveWidth : waveWidth * 0.5);
      const y = baselineY - (baselineMinH * 0.5 + bars[i] * maxBarHeight);
      pts.push({ x, y });
    }

    if (pts.length >= 2) {
      // Soft translucent ribbon fill under curve
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, baselineY);
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) * 0.5;
        const midY = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineTo(pts[pts.length - 1].x, baselineY);
      ctx.closePath();
      ctx.globalAlpha = Math.max(0, Math.min(1, style.vocalWaveOpacity * 0.2));
      ctx.fillStyle = strokeStyle;
      ctx.fill();
      ctx.restore();

      // Crisp flowing foreground stroke
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) * 0.5;
        const midY = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = Math.max(2.5 * scale, barW * 0.7);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    hitX = leftX;
    hitY = baselineY - Math.max(maxBarHeight, 44 * scale);
    hitW = waveWidth;
    hitH = Math.max(maxBarHeight, 44 * scale) + 12 * scale;
  } else if (style.vocalWaveStyle === 'dotted-eq') {
    const baselineY = Math.max(maxBarHeight + 8 * scale, Math.min(videoHeight - 10 * scale, anchorY));
    ctx.fillStyle = buildWaveFillStyle(ctx, style, leftX, baselineY - maxBarHeight, leftX + waveWidth, baselineY);
    const dotSize = Math.max(2.5 * scale, Math.min(barW, 9 * scale));
    const stepY = dotSize * 1.55;
    const maxDots = Math.max(3, Math.floor(maxBarHeight / stepY));

    for (let i = 0; i < barCount; i++) {
      const energy = bars[i];
      const activeDots = energy <= 0.01 ? 1 : Math.max(1, Math.min(maxDots, Math.round(1 + energy * (maxDots - 1))));
      const bx = leftX + i * slotW + (slotW - dotSize) * 0.5;
      for (let d = 0; d < activeDots; d++) {
        const by = baselineY - (d + 1) * stepY + (stepY - dotSize);
        const h = d === 0 && energy <= 0.01 ? baselineMinH : dotSize;
        const yAdj = d === 0 && energy <= 0.01 ? baselineY - baselineMinH : by;
        ctx.beginPath();
        ctx.roundRect(bx, yAdj, dotSize, h, h * 0.45);
        ctx.fill();
      }
    }

    hitX = leftX;
    hitY = baselineY - Math.max(maxBarHeight, 44 * scale);
    hitW = waveWidth;
    hitH = Math.max(maxBarHeight, 44 * scale) + 12 * scale;
  } else if (style.vocalWaveStyle === 'neon-spectrum') {
    const baselineY = Math.max(maxBarHeight + 8 * scale, Math.min(videoHeight - 10 * scale, anchorY));
    const fill = buildWaveFillStyle(ctx, style, leftX, baselineY - maxBarHeight, leftX + waveWidth, baselineY);
    ctx.shadowColor = style.vocalWaveColor;
    ctx.shadowBlur = 16 * scale;
    ctx.fillStyle = fill;

    for (let i = 0; i < barCount; i++) {
      const energy = bars[i];
      const h = baselineMinH + energy * (maxBarHeight - baselineMinH);
      const bx = leftX + i * slotW + (slotW - barW) * 0.5;
      const by = baselineY - h;
      const topR = Math.min(barW * 0.5, h * 0.5);

      ctx.beginPath();
      ctx.roundRect(bx, by, barW, h, [topR, topR, 0, 0]);
      ctx.fill();

      // Hot inner core highlight when bar is active
      if (energy > 0.12 && barW >= 3 * scale) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        const coreW = Math.max(1 * scale, barW * 0.34);
        ctx.beginPath();
        ctx.roundRect(bx + (barW - coreW) * 0.5, by + 2 * scale, coreW, Math.max(2 * scale, h - 4 * scale), coreW * 0.5);
        ctx.fill();
        ctx.restore();
      }
    }

    hitX = leftX;
    hitY = baselineY - Math.max(maxBarHeight, 44 * scale);
    hitW = waveWidth;
    hitH = Math.max(maxBarHeight, 44 * scale) + 12 * scale;
  } else if (style.vocalWaveStyle === 'circular-ring') {
    const baseRadius = Math.min(waveWidth * 0.22, shortEdge * 0.12);
    const maxSpike = maxBarHeight * 0.65;
    const cx = Math.max(baseRadius + maxSpike + 8, Math.min(videoWidth - baseRadius - maxSpike - 8, centerX));
    const cy = Math.max(baseRadius + maxSpike + 8, Math.min(videoHeight - baseRadius - maxSpike - 8, anchorY));

    const ringStroke = buildWaveFillStyle(ctx, style, cx - baseRadius, cy - baseRadius, cx + baseRadius, cy + baseRadius);

    // Subtle inner base ring
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = ringStroke;
    ctx.lineWidth = Math.max(2 * scale, 2.5 * scale);
    ctx.stroke();

    // Outward radial audio spikes
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2 * scale, (2 * Math.PI * baseRadius / barCount) * thicknessRatio * 0.72);
    ctx.strokeStyle = ringStroke;

    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI * 0.5;
      const energy = bars[i];
      const spikeLen = baselineMinH + energy * maxSpike;
      const r0 = baseRadius + 2 * scale;
      const r1 = r0 + spikeLen;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
      ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      ctx.stroke();
    }

    const totalR = baseRadius + maxSpike;
    hitX = cx - totalR;
    hitY = cy - totalR;
    hitW = totalR * 2;
    hitH = totalR * 2;
  }

  ctx.restore();

  return {
    x: hitX / videoWidth,
    y: hitY / videoHeight,
    width: hitW / videoWidth,
    height: hitH / videoHeight,
  };
}

/**
 * Renders the Channel Logo / Watermark overlay and returns its normalized hit-test rect.
 */
export function renderChannelLogoOverlay(
  ctx: CanvasRenderingContext2D,
  videoWidth: number,
  videoHeight: number,
  style: CaptionStyle,
  logoImage: HTMLImageElement | null
): NormalizedRect | null {
  if (!style.logoEnabled || !logoImage || logoImage.naturalWidth <= 0 || style.logoOpacity <= 0.01) {
    return null;
  }

  const shortEdge = Math.min(videoWidth, videoHeight);
  const targetMaxDim = shortEdge * (Math.max(5, Math.min(35, style.logoSizePercent)) / 100);
  const imgAspect = logoImage.naturalWidth / Math.max(1, logoImage.naturalHeight);

  let drawW = targetMaxDim;
  let drawH = targetMaxDim;
  if (imgAspect >= 1) {
    drawH = targetMaxDim / imgAspect;
  } else {
    drawW = targetMaxDim * imgAspect;
  }

  const margin = shortEdge * 0.02;
  const cx = style.logoX * videoWidth;
  const cy = style.logoY * videoHeight;
  const x = Math.max(margin, Math.min(videoWidth - drawW - margin, cx - drawW * 0.5));
  const y = Math.max(margin, Math.min(videoHeight - drawH - margin, cy - drawH * 0.5));

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, style.logoOpacity));
  ctx.drawImage(logoImage, x, y, drawW, drawH);
  ctx.restore();

  return {
    x: x / videoWidth,
    y: y / videoHeight,
    width: drawW / videoWidth,
    height: drawH / videoHeight,
  };
}

/**
 * Renders the Video Progress Bar (Top or Bottom anchored, 2..12px thickness at 1080p).
 */
export function renderProgressBarOverlay(
  ctx: CanvasRenderingContext2D,
  videoWidth: number,
  videoHeight: number,
  style: CaptionStyle,
  timeMs: number,
  durationMs: number
): void {
  if (!style.progressBarEnabled) return;

  const scale = Math.min(videoWidth, videoHeight) / 1080;
  const thickness = Math.max(2, Math.round(style.progressBarThickness * scale));
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, timeMs / durationMs)) : 0;
  const y = style.progressBarPosition === 'top' ? 0 : videoHeight - thickness;

  ctx.save();
  // Subtle full-width track
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(0, y, videoWidth, thickness);

  // Active filled progress bar
  ctx.fillStyle = style.progressBarColor;
  ctx.fillRect(0, y, Math.round(videoWidth * progress), thickness);
  ctx.restore();
}
