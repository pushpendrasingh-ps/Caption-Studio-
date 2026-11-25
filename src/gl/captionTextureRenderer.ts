import type { ActiveCaptionState, CaptionStyle, FontOption } from '../core/types';

export interface RenderedCaptionBitmap {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Extra transparent padding added for animation headroom (scale/glow/slide/shake) */
  marginX: number;
  marginY: number;
  /** Core caption box dimensions without animation margin */
  boxWidth: number;
  boxHeight: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Pick dark or white text on top of a colored pill for crisp WCAG contrast */
function contrastTextForHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.56 ? '#0A0B0E' : '#FFFFFF';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
}

function easeOutBack(t: number, overshoot = 1.65): number {
  const u = clamp01(t) - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

export function buildCaptionStyleHash(style: CaptionStyle, font: FontOption): string {
  return [
    style.fontSizePx,
    style.maxWidthPercent,
    font.id,
    font.family,
    style.textColor,
    style.highlightColor,
    style.boxColor,
    style.boxOpacity.toFixed(2),
    style.boxCornerRadius,
    style.boxPadding,
    style.outlineThickness,
    style.animation,
    style.animationIntensity.toFixed(2),
    style.wordKaraoke ? 'K1' : 'K0',
    style.uppercase ? 'U1' : 'U0',
  ].join('|');
}

interface LayoutWord {
  text: string;
  width: number;
  wordIndex: number;
  startMs: number;
  endMs: number;
  x: number;
  centerY: number;
  lineIdx: number;
}

/**
 * Deterministic 1080p Caption Renderer supporting:
 * - Custom Box Corner Radius (0px sharp rectangle .. 50px pill)
 * - Custom Box Padding
 * - All 10 smooth Caption Animations rendered identically in Live Preview & True CFR MP4 Export
 */
export function renderCaptionToTransparentCanvas(
  state: ActiveCaptionState,
  style: CaptionStyle,
  font: FontOption,
  videoWidth: number,
  videoHeight: number,
  sampleTimeMs: number,
  targetCanvas?: HTMLCanvasElement
): RenderedCaptionBitmap | null {
  if (!state.cue || state.words.length === 0) return null;

  const shortEdge = Math.min(videoWidth, videoHeight);
  const scale = shortEdge / 1080;
  const fontSizePx = Math.max(12, style.fontSizePx * scale);
  const outlinePx = Math.max(0, style.outlineThickness * scale);
  const maxTextWidth = videoWidth * Math.max(0.35, Math.min(0.95, style.maxWidthPercent / 100));
  const intensity = Math.max(0.4, Math.min(2.0, style.animationIntensity || 1.0));

  const canvas = targetCanvas ?? document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fontSpec = `${font.weight} ${fontSizePx}px ${font.family}`;
  ctx.font = fontSpec;
  const spaceWidth = ctx.measureText(' ').width;

  interface MeasuredWord {
    text: string;
    width: number;
    wordIndex: number;
    startMs: number;
    endMs: number;
  }

  const explicitLines = new Map<number, typeof state.words>();
  for (const w of state.words) {
    const arr = explicitLines.get(w.lineIndex) ?? [];
    arr.push(w);
    explicitLines.set(w.lineIndex, arr);
  }

  const wrappedLines: MeasuredWord[][] = [];
  const sortedLineKeys = Array.from(explicitLines.keys()).sort((a, b) => a - b);

  for (const lineKey of sortedLineKeys) {
    const tokens = explicitLines.get(lineKey)!;
    let currentLine: MeasuredWord[] = [];
    let currentWidth = 0;

    for (const token of tokens) {
      const w = ctx.measureText(token.text).width;
      const projected = currentLine.length === 0 ? w : currentWidth + spaceWidth + w;
      if (currentLine.length > 0 && projected > maxTextWidth) {
        wrappedLines.push(currentLine);
        currentLine = [
          {
            text: token.text,
            width: w,
            wordIndex: token.wordIndex,
            startMs: token.startMs,
            endMs: token.endMs,
          },
        ];
        currentWidth = w;
      } else {
        currentLine.push({
          text: token.text,
          width: w,
          wordIndex: token.wordIndex,
          startMs: token.startMs,
          endMs: token.endMs,
        });
        currentWidth = projected;
      }
    }
    if (currentLine.length > 0) wrappedLines.push(currentLine);
  }

  if (wrappedLines.length === 0) return null;

  const lineHeight = fontSizePx * 1.28;
  const lineWidths = wrappedLines.map(
    (line) =>
      line.reduce((sum, item) => sum + item.width, 0) +
      spaceWidth * Math.max(0, line.length - 1)
  );
  const contentWidth = Math.max(...lineWidths, 1);
  const contentHeight = lineHeight * wrappedLines.length;

  // Box Padding controlled directly by user slider (4..48px at 1080p)
  const basePad = Math.max(4, Math.min(56, style.boxPadding)) * scale;
  const padX = basePad * 1.35 + outlinePx * 1.15;
  const padY = basePad * 0.88 + outlinePx * 1.15;

  const boxWidth = Math.min(videoWidth, Math.max(16, Math.ceil(contentWidth + padX * 2)));
  const boxHeight = Math.min(videoHeight, Math.max(16, Math.ceil(contentHeight + padY * 2)));

  // Headroom margin so word-scale, pop-bounce, glow-pulse, slide-up, and punch-shake never clip
  const needsHeadroom = style.animation !== 'none';
  const marginX = needsHeadroom ? Math.ceil(fontSizePx * 0.55) : 0;
  const marginY = needsHeadroom ? Math.ceil(fontSizePx * 0.72) : 0;

  const bmpWidth = Math.min(videoWidth, boxWidth + marginX * 2);
  const bmpHeight = Math.min(videoHeight, boxHeight + marginY * 2);
  const actualMarginX = Math.max(0, Math.floor((bmpWidth - boxWidth) * 0.5));
  const actualMarginY = Math.max(0, Math.floor((bmpHeight - boxHeight) * 0.5));

  canvas.width = bmpWidth;
  canvas.height = bmpHeight;
  ctx.clearRect(0, 0, bmpWidth, bmpHeight);

  // Precompute word positions relative to caption box origin (0,0)
  const layoutWords: LayoutWord[] = [];
  wrappedLines.forEach((line, lineIdx) => {
    const centerY = padY + lineHeight * (lineIdx + 0.5);
    let cursorX = (boxWidth - lineWidths[lineIdx]) * 0.5;
    line.forEach((word, idxInLine) => {
      layoutWords.push({
        ...word,
        x: cursorX,
        centerY,
        lineIdx,
      });
      cursorX += word.width;
      if (idxInLine < line.length - 1) cursorX += spaceWidth;
    });
  });

  // Compute page-level animation timing
  const pageStartMs = state.page?.startMs ?? state.cue.startMs;
  const elapsedPageMs = Math.max(0, sampleTimeMs - pageStartMs);
  const speedFactor = Math.max(0.5, Math.min(1.8, intensity));

  let groupAlpha = 1;
  let groupScale = 1;
  let groupOffsetX = 0;
  let groupOffsetY = 0;

  if (style.animation === 'pop-bounce') {
    const dur = 240 / speedFactor;
    const t = clamp01(elapsedPageMs / dur);
    groupScale = 0.62 + 0.38 * easeOutBack(t, 1.55 * Math.min(1.35, intensity));
    groupAlpha = clamp01(t * 2.4);
  } else if (style.animation === 'slide-up') {
    const dur = 230 / speedFactor;
    const t = easeOutCubic(elapsedPageMs / dur);
    groupOffsetY = (1 - t) * fontSizePx * 0.55 * Math.min(1.4, intensity);
    groupAlpha = clamp01(t * 1.4);
  } else if (style.animation === 'fade-in') {
    const dur = 280 / speedFactor;
    groupAlpha = easeOutCubic(elapsedPageMs / dur);
  }

  // Active word timing for word-level animations
  const activeLayout =
    style.wordKaraoke && state.activeWordIndex >= 0
      ? layoutWords.find((w) => w.wordIndex === state.activeWordIndex) ?? null
      : null;
  const prevLayout =
    style.wordKaraoke && state.activeWordIndex > 0
      ? layoutWords.find((w) => w.wordIndex === state.activeWordIndex - 1) ?? null
      : null;

  const activeWordElapsedMs = activeLayout ? Math.max(0, sampleTimeMs - activeLayout.startMs) : 0;
  const activeWordDurationMs = activeLayout
    ? Math.max(40, activeLayout.endMs - activeLayout.startMs)
    : 200;

  if (style.animation === 'punch-shake' && activeLayout) {
    const shakeDur = 145 / speedFactor;
    if (activeWordElapsedMs < shakeDur) {
      const decay = 1 - activeWordElapsedMs / shakeDur;
      const amp = fontSizePx * 0.085 * intensity * decay;
      const phase = activeWordElapsedMs * 0.14;
      groupOffsetX = Math.sin(phase) * amp;
      groupOffsetY = Math.cos(phase * 1.35) * amp * 0.7;
      groupScale = 1 + 0.04 * intensity * decay;
    }
  }

  ctx.save();
  ctx.globalAlpha = groupAlpha;
  // Transform around center of the caption box
  const boxCenterX = actualMarginX + boxWidth * 0.5;
  const boxCenterY = actualMarginY + boxHeight * 0.5;
  ctx.translate(boxCenterX + groupOffsetX, boxCenterY + groupOffsetY);
  if (groupScale !== 1) {
    ctx.scale(groupScale, groupScale);
  }
  ctx.translate(-boxWidth * 0.5, -boxHeight * 0.5);

  // 1. Caption Backdrop Box with custom Corner Radius (0px sharp .. 50px pill)
  if (style.boxOpacity > 0.01) {
    const requestedRadius = Math.max(0, style.boxCornerRadius) * scale;
    const radius = Math.min(requestedRadius, boxHeight * 0.5, boxWidth * 0.5);
    ctx.fillStyle = hexToRgba(style.boxColor, style.boxOpacity);
    ctx.beginPath();
    if (radius <= 0.25) {
      ctx.rect(0, 0, boxWidth, boxHeight);
    } else {
      ctx.roundRect(0, 0, boxWidth, boxHeight, radius);
    }
    ctx.fill();
  }

  // 2. Sliding Pill background behind active word (Animation #3)
  if (style.animation === 'sliding-pill' && activeLayout) {
    const glideDur = 125 / speedFactor;
    const glideT = easeOutCubic(activeWordElapsedMs / glideDur);
    const sameLine = prevLayout && prevLayout.lineIdx === activeLayout.lineIdx;
    const fromX = sameLine ? prevLayout.x : activeLayout.x;
    const fromW = sameLine ? prevLayout.width : activeLayout.width;
    const fromY = sameLine ? prevLayout.centerY : activeLayout.centerY;

    const curX = fromX + (activeLayout.x - fromX) * glideT;
    const curW = fromW + (activeLayout.width - fromW) * glideT;
    const curY = fromY + (activeLayout.centerY - fromY) * glideT;

    const pillPadX = fontSizePx * 0.22;
    const pillH = fontSizePx * 1.12;
    const pillR = Math.min(pillH * 0.48, Math.max(6 * scale, style.boxCornerRadius * scale * 0.65));
    ctx.fillStyle = style.highlightColor;
    ctx.beginPath();
    ctx.roundRect(curX - pillPadX, curY - pillH * 0.5, curW + pillPadX * 2, pillH, pillR);
    ctx.fill();
  }

  // 3. Sliding Underline Accent Bar (Animation #9)
  if (style.animation === 'underline-slide' && activeLayout) {
    const glideDur = 125 / speedFactor;
    const glideT = easeOutCubic(activeWordElapsedMs / glideDur);
    const sameLine = prevLayout && prevLayout.lineIdx === activeLayout.lineIdx;
    const fromX = sameLine ? prevLayout.x : activeLayout.x;
    const fromW = sameLine ? prevLayout.width : activeLayout.width;
    const fromY = sameLine ? prevLayout.centerY : activeLayout.centerY;

    const curX = fromX + (activeLayout.x - fromX) * glideT;
    const curW = fromW + (activeLayout.width - fromW) * glideT;
    const curY = fromY + (activeLayout.centerY - fromY) * glideT;

    const barH = Math.max(3 * scale, fontSizePx * 0.1 * Math.min(1.5, intensity));
    const barY = curY + fontSizePx * 0.46;
    ctx.fillStyle = style.highlightColor;
    ctx.beginPath();
    ctx.roundRect(curX, barY, curW, barH, barH * 0.5);
    ctx.fill();
  }

  // 4. Render every word cleanly
  ctx.font = fontSpec;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  for (const word of layoutWords) {
    const isActiveWord = style.wordKaraoke && word.wordIndex === state.activeWordIndex;
    const isPastWord = style.wordKaraoke && state.activeWordIndex >= 0 && word.wordIndex < state.activeWordIndex;

    let wordScale = 1;
    let wordOffsetY = 0;

    if (isActiveWord && style.animation === 'word-scale') {
      const popDur = 115 / speedFactor;
      const t = easeOutBack(activeWordElapsedMs / popDur, 1.35);
      const targetScale = 1 + 0.15 * intensity;
      wordScale = 1 + (targetScale - 1) * Math.min(1.12, t);
    }

    if (isActiveWord && style.animation === 'punch-shake') {
      const punchDur = 120 / speedFactor;
      if (activeWordElapsedMs < punchDur) {
        const decay = 1 - activeWordElapsedMs / punchDur;
        wordScale = 1 + 0.1 * intensity * decay;
      }
    }

    const cx = word.x + word.width * 0.5;
    const cy = word.centerY + wordOffsetY;

    ctx.save();
    if (wordScale !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(wordScale, wordScale);
      ctx.translate(-cx, -cy);
    }

    // Active word Glow Pulse (Animation #7)
    if (isActiveWord && style.animation === 'glow-pulse') {
      const pulse = 0.72 + 0.28 * Math.sin(activeWordElapsedMs * 0.018 * speedFactor);
      ctx.shadowColor = style.highlightColor;
      ctx.shadowBlur = fontSizePx * 0.48 * intensity * pulse;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Stroke outline
    const drawOutline = outlinePx > 0.25 && !(style.animation === 'sliding-pill' && isActiveWord);
    if (drawOutline) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = outlinePx * 2;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(word.text, word.x, word.centerY);
      ctx.restore();
    }

    // Fill text (with progressive clip sweep for Karaoke Sweep #8)
    if (style.animation === 'karaoke-sweep' && style.wordKaraoke) {
      if (isActiveWord) {
        // Draw base text first
        ctx.fillStyle = style.textColor;
        ctx.fillText(word.text, word.x, word.centerY);
        // Progressive left-to-right highlight sweep
        const sweepT = clamp01(activeWordElapsedMs / activeWordDurationMs);
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          word.x - outlinePx,
          word.centerY - lineHeight * 0.65,
          word.width * sweepT + outlinePx * 2,
          lineHeight * 1.3
        );
        ctx.clip();
        ctx.fillStyle = style.highlightColor;
        ctx.fillText(word.text, word.x, word.centerY);
        ctx.restore();
      } else {
        ctx.fillStyle = isPastWord ? style.highlightColor : style.textColor;
        ctx.fillText(word.text, word.x, word.centerY);
      }
    } else if (style.animation === 'sliding-pill' && isActiveWord) {
      ctx.fillStyle = contrastTextForHex(style.highlightColor);
      ctx.fillText(word.text, word.x, word.centerY);
    } else {
      ctx.fillStyle = isActiveWord ? style.highlightColor : style.textColor;
      ctx.fillText(word.text, word.x, word.centerY);
    }

    ctx.restore();
  }

  ctx.restore();

  return {
    canvas,
    width: bmpWidth,
    height: bmpHeight,
    marginX: actualMarginX,
    marginY: actualMarginY,
    boxWidth,
    boxHeight,
  };
}
