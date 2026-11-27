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
    style.textAlign,
    style.balancedLines ? 'B1' : 'B0',
    style.lineSpacingMultiplier.toFixed(2),
    style.wordSpacingPx,
    style.letterSpacingPx,
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

/**
 * Computes a quantized animation cache bucket so that once an entrance or word-transition
 * animation has settled (or when animation === 'none'), the rendered caption bitmap is
 * 100% reused across consecutive video frames without redrawing text!
 */
export function computeCaptionAnimationCacheKey(
  state: ActiveCaptionState,
  style: CaptionStyle,
  sampleTimeMs: number
): string {
  const anim = style.animation;
  if (anim === 'none' || !state.cue) {
    return 'STATIC';
  }

  const speedFactor = Math.max(0.5, Math.min(1.8, style.animationIntensity || 1.0));
  const pageStartMs = state.page?.startMs ?? state.cue.startMs;
  const elapsedPageMs = Math.max(0, sampleTimeMs - pageStartMs);

  // Page-entrance animations: once settled past ~320ms, stay cached as 'SETTLED'!
  if (
    anim === 'pop-bounce' ||
    anim === 'slide-up' ||
    anim === 'slide-left' ||
    anim === 'fade-in' ||
    anim === 'blur-in' ||
    anim === 'zoom-out' ||
    anim === 'flip-3d' ||
    anim === 'box-wipe' ||
    anim === 'elastic-drop'
  ) {
    const settleLimitMs = 340 / speedFactor;
    if (elapsedPageMs >= settleLimitMs) {
      return 'PAGE_SETTLED';
    }
    return `P_${Math.floor(elapsedPageMs / 16)}`;
  }

  // Word-transition animations: once settled past transition window, stay cached!
  const activeWord =
    style.wordKaraoke && state.activeWordIndex >= 0
      ? state.words.find((w) => w.wordIndex === state.activeWordIndex) ?? null
      : null;

  if (!activeWord) return 'NO_ACTIVE_WORD';
  const wordElapsedMs = Math.max(0, sampleTimeMs - activeWord.startMs);

  if (
    anim === 'word-scale' ||
    anim === 'sliding-pill' ||
    anim === 'underline-slide' ||
    anim === 'punch-shake' ||
    anim === 'wave-jump' ||
    anim === 'glitch-flash' ||
    anim === 'neon-flicker' ||
    anim === 'tilt-pop'
  ) {
    const wordSettleMs = 200 / speedFactor;
    if (wordElapsedMs >= wordSettleMs) {
      return `W_SETTLED_${state.activeWordIndex}`;
    }
    return `W_${state.activeWordIndex}_${Math.floor(wordElapsedMs / 16)}`;
  }

  // Continuous active-word animations (glow-pulse, karaoke-sweep) quantized to 25ms steps
  return `C_${state.activeWordIndex}_${Math.floor(wordElapsedMs / 25)}`;
}

interface MeasuredWord {
  text: string;
  width: number;
  wordIndex: number;
  startMs: number;
  endMs: number;
}

interface LayoutWord extends MeasuredWord {
  x: number;
  centerY: number;
  lineIdx: number;
}

/**
 * Wraps words into lines either greedily (standard) or balanced (distributes words evenly
 * across the minimum required number of lines so a single orphan word never hangs alone).
 */
function wrapWordsIntoLines(
  tokens: MeasuredWord[],
  maxTextWidth: number,
  spaceWidth: number,
  balanced: boolean
): MeasuredWord[][] {
  if (tokens.length === 0) return [];

  // First compute greedy line count
  const greedyLines: MeasuredWord[][] = [];
  let curLine: MeasuredWord[] = [];
  let curW = 0;

  for (const tok of tokens) {
    const projected = curLine.length === 0 ? tok.width : curW + spaceWidth + tok.width;
    if (curLine.length > 0 && projected > maxTextWidth) {
      greedyLines.push(curLine);
      curLine = [tok];
      curW = tok.width;
    } else {
      curLine.push(tok);
      curW = projected;
    }
  }
  if (curLine.length > 0) greedyLines.push(curLine);

  if (!balanced || greedyLines.length <= 1 || tokens.length <= 2) {
    return greedyLines;
  }

  const targetLineCount = greedyLines.length;
  const totalWordWidth =
    tokens.reduce((s, t) => s + t.width, 0) + spaceWidth * Math.max(0, tokens.length - 1);
  const idealLineWidth = Math.min(maxTextWidth, totalWordWidth / targetLineCount);

  const balancedResult: MeasuredWord[][] = [];
  let idx = 0;

  for (let lineNo = 0; lineNo < targetLineCount && idx < tokens.length; lineNo++) {
    const remainingLines = targetLineCount - lineNo;
    if (remainingLines === 1) {
      balancedResult.push(tokens.slice(idx));
      break;
    }

    const line: MeasuredWord[] = [];
    let lineW = 0;

    while (idx < tokens.length) {
      const nextTok = tokens[idx];
      const nextW = line.length === 0 ? nextTok.width : lineW + spaceWidth + nextTok.width;
      const remainingWordsAfter = tokens.length - (idx + 1);

      if (line.length > 0 && nextW > maxTextWidth) {
        break;
      }

      // Ensure at least 1 word per remaining line
      if (line.length > 0 && remainingWordsAfter < remainingLines - 1) {
        break;
      }

      if (line.length === 0) {
        line.push(nextTok);
        lineW = nextW;
        idx++;
      } else {
        const distBefore = Math.abs(idealLineWidth - lineW);
        const distAfter = Math.abs(idealLineWidth - nextW);
        if (nextW <= idealLineWidth || distAfter <= distBefore) {
          line.push(nextTok);
          lineW = nextW;
          idx++;
        } else {
          break;
        }
      }
    }
    balancedResult.push(line);
  }

  // Verify no line in balancedResult exceeds maxTextWidth (fallback to greedy if a huge word overflowed last line)
  const anyOverflow = balancedResult.some((line) => {
    const w = line.reduce((s, t) => s + t.width, 0) + spaceWidth * Math.max(0, line.length - 1);
    return line.length > 1 && w > maxTextWidth * 1.04;
  });

  return anyOverflow ? greedyLines : balancedResult;
}

/**
 * Deterministic Multi-Resolution Caption Renderer supporting:
 * - 4 Text Alignments: Left, Center, Right, Justify
 * - Balanced Lines toggle
 * - Typography Spacing Sliders: Line Height (0.9x..2.2x), Word Gap (0..32px), Letter Gap (-2..16px)
 * - Custom Box Corner Radius (0..50px) & Box Padding
 * - All 20 smooth Caption & Word Animations rendered identically in Live Preview & True CFR MP4 Export
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
  const fontSizePx = Math.max(10, style.fontSizePx * scale);
  const outlinePx = Math.max(0, style.outlineThickness * scale);
  const maxTextWidth = videoWidth * Math.max(0.35, Math.min(0.95, style.maxWidthPercent / 100));
  const intensity = Math.max(0.4, Math.min(2.0, style.animationIntensity || 1.0));

  const letterSpacingScaled = (style.letterSpacingPx || 0) * scale;
  const extraWordGapScaled = Math.max(0, (style.wordSpacingPx || 0) * scale);
  const lineMultiplier = Math.max(0.9, Math.min(2.2, style.lineSpacingMultiplier || 1.28));

  const canvas = targetCanvas ?? document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fontSpec = `${font.weight} ${fontSizePx}px ${font.family}`;
  ctx.font = fontSpec;
  if ('letterSpacing' in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${letterSpacingScaled}px`;
  }

  const baseSpaceWidth = ctx.measureText(' ').width;
  const spaceWidth = Math.max(2 * scale, baseSpaceWidth + extraWordGapScaled);

  const measureWordWidth = (text: string): number => {
    const rawW = ctx.measureText(text).width;
    if (!('letterSpacing' in ctx) && letterSpacingScaled !== 0) {
      return Math.max(1, rawW + Math.max(0, text.length - 1) * letterSpacingScaled);
    }
    return Math.max(1, rawW);
  };

  const explicitLines = new Map<number, typeof state.words>();
  for (const w of state.words) {
    const arr = explicitLines.get(w.lineIndex) ?? [];
    arr.push(w);
    explicitLines.set(w.lineIndex, arr);
  }

  const wrappedLines: MeasuredWord[][] = [];
  const sortedLineKeys = Array.from(explicitLines.keys()).sort((a, b) => a - b);

  for (const lineKey of sortedLineKeys) {
    const tokens = explicitLines.get(lineKey)!.map((token) => ({
      text: token.text,
      width: measureWordWidth(token.text),
      wordIndex: token.wordIndex,
      startMs: token.startMs,
      endMs: token.endMs,
    }));
    const linesForGroup = wrapWordsIntoLines(
      tokens,
      maxTextWidth,
      spaceWidth,
      Boolean(style.balancedLines)
    );
    wrappedLines.push(...linesForGroup);
  }

  if (wrappedLines.length === 0) return null;

  const lineHeight = fontSizePx * lineMultiplier;
  const lineWidths = wrappedLines.map(
    (line) =>
      line.reduce((sum, item) => sum + item.width, 0) +
      spaceWidth * Math.max(0, line.length - 1)
  );
  const contentWidth = Math.max(...lineWidths, 1);
  const contentHeight = lineHeight * wrappedLines.length;

  const basePad = Math.max(4, Math.min(56, style.boxPadding)) * scale;
  const padX = basePad * 1.35 + outlinePx * 1.15;
  const padY = basePad * 0.88 + outlinePx * 1.15;

  const boxWidth = Math.min(videoWidth, Math.max(16, Math.ceil(contentWidth + padX * 2)));
  const boxHeight = Math.min(videoHeight, Math.max(16, Math.ceil(contentHeight + padY * 2)));

  const needsHeadroom = style.animation !== 'none';
  const marginX = needsHeadroom ? Math.ceil(fontSizePx * 0.65) : 0;
  const marginY = needsHeadroom ? Math.ceil(fontSizePx * 0.85) : 0;

  const bmpWidth = Math.min(videoWidth, boxWidth + marginX * 2);
  const bmpHeight = Math.min(videoHeight, boxHeight + marginY * 2);
  const actualMarginX = Math.max(0, Math.floor((bmpWidth - boxWidth) * 0.5));
  const actualMarginY = Math.max(0, Math.floor((bmpHeight - boxHeight) * 0.5));

  canvas.width = bmpWidth;
  canvas.height = bmpHeight;
  ctx.clearRect(0, 0, bmpWidth, bmpHeight);
  if ('letterSpacing' in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${letterSpacingScaled}px`;
  }

  // Compute word layout coordinates inside caption box (0..boxWidth) honoring Text Alignment
  const layoutWords: LayoutWord[] = [];
  const innerLeft = (boxWidth - contentWidth) * 0.5;
  const align = style.textAlign || 'center';

  wrappedLines.forEach((line, lineIdx) => {
    const centerY = padY + lineHeight * (lineIdx + 0.5);
    const lineW = lineWidths[lineIdx];
    const isLastLine = lineIdx === wrappedLines.length - 1;

    let cursorX = innerLeft;
    let effectiveSpace = spaceWidth;

    if (align === 'left') {
      cursorX = innerLeft;
    } else if (align === 'right') {
      cursorX = innerLeft + (contentWidth - lineW);
    } else if (align === 'justify') {
      cursorX = innerLeft;
      if (!isLastLine && line.length > 1) {
        const wordsOnlyW = line.reduce((s, item) => s + item.width, 0);
        effectiveSpace = Math.max(spaceWidth, (contentWidth - wordsOnlyW) / (line.length - 1));
      }
    } else {
      // center
      cursorX = (boxWidth - lineW) * 0.5;
    }

    line.forEach((word, idxInLine) => {
      layoutWords.push({
        ...word,
        x: cursorX,
        centerY,
        lineIdx,
      });
      cursorX += word.width;
      if (idxInLine < line.length - 1) cursorX += effectiveSpace;
    });
  });

  // Compute page-level & word-level animation parameters
  const pageStartMs = state.page?.startMs ?? state.cue.startMs;
  const elapsedPageMs = Math.max(0, sampleTimeMs - pageStartMs);
  const speedFactor = Math.max(0.5, Math.min(1.8, intensity));

  let groupAlpha = 1;
  let groupScaleX = 1;
  let groupScaleY = 1;
  let groupOffsetX = 0;
  let groupOffsetY = 0;
  let groupBlurPx = 0;
  let boxWipeProgress = 1;

  if (style.animation === 'pop-bounce') {
    const dur = 240 / speedFactor;
    const t = clamp01(elapsedPageMs / dur);
    const s = 0.62 + 0.38 * easeOutBack(t, 1.55 * Math.min(1.35, intensity));
    groupScaleX = s;
    groupScaleY = s;
    groupAlpha = clamp01(t * 2.4);
  } else if (style.animation === 'slide-up') {
    const dur = 230 / speedFactor;
    const t = easeOutCubic(elapsedPageMs / dur);
    groupOffsetY = (1 - t) * fontSizePx * 0.55 * Math.min(1.4, intensity);
    groupAlpha = clamp01(t * 1.4);
  } else if (style.animation === 'slide-left') {
    const dur = 240 / speedFactor;
    const t = easeOutCubic(elapsedPageMs / dur);
    groupOffsetX = (1 - t) * fontSizePx * 0.85 * Math.min(1.4, intensity);
    groupAlpha = clamp01(t * 1.5);
  } else if (style.animation === 'fade-in') {
    const dur = 280 / speedFactor;
    groupAlpha = easeOutCubic(elapsedPageMs / dur);
  } else if (style.animation === 'blur-in') {
    const dur = 270 / speedFactor;
    const t = easeOutCubic(elapsedPageMs / dur);
    groupAlpha = clamp01(0.2 + 0.8 * t);
    groupBlurPx = (1 - t) * 10 * scale * Math.min(1.5, intensity);
  } else if (style.animation === 'zoom-out') {
    const dur = 240 / speedFactor;
    const t = easeOutCubic(elapsedPageMs / dur);
    const s = 1 + (1 - t) * 0.36 * Math.min(1.4, intensity);
    groupScaleX = s;
    groupScaleY = s;
    groupAlpha = clamp01(t * 1.8);
  } else if (style.animation === 'flip-3d') {
    const dur = 260 / speedFactor;
    const t = easeOutBack(elapsedPageMs / dur, 1.25);
    groupScaleY = Math.max(0.08, t);
    groupOffsetY = (1 - clamp01(elapsedPageMs / dur)) * fontSizePx * 0.25;
    groupAlpha = clamp01((elapsedPageMs / dur) * 2.2);
  } else if (style.animation === 'box-wipe') {
    const dur = 270 / speedFactor;
    boxWipeProgress = easeOutCubic(elapsedPageMs / dur);
  } else if (style.animation === 'elastic-drop') {
    const dur = 290 / speedFactor;
    const t = clamp01(elapsedPageMs / dur);
    const bounce = easeOutBack(t, 2.1 * Math.min(1.3, intensity));
    groupOffsetY = -(1 - bounce) * fontSizePx * 0.72;
    groupAlpha = clamp01(t * 2.5);
  }

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
      groupScaleX = 1 + 0.04 * intensity * decay;
      groupScaleY = groupScaleX;
    }
  }

  ctx.save();
  ctx.globalAlpha = groupAlpha;
  if (groupBlurPx > 0.3 && 'filter' in ctx) {
    ctx.filter = `blur(${groupBlurPx.toFixed(1)}px)`;
  }

  const boxCenterX = actualMarginX + boxWidth * 0.5;
  const boxCenterY = actualMarginY + boxHeight * 0.5;
  ctx.translate(boxCenterX + groupOffsetX, boxCenterY + groupOffsetY);
  if (groupScaleX !== 1 || groupScaleY !== 1) {
    ctx.scale(groupScaleX, groupScaleY);
  }
  ctx.translate(-boxWidth * 0.5, -boxHeight * 0.5);

  if (style.animation === 'box-wipe' && boxWipeProgress < 0.999) {
    ctx.beginPath();
    ctx.rect(-marginX, -marginY, boxWidth * boxWipeProgress + marginX * 2, boxHeight + marginY * 2);
    ctx.clip();
  }

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

  // 2. Sliding Pill background behind active word
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

  // 3. Sliding Underline Accent Bar
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
    const isPastWord =
      style.wordKaraoke && state.activeWordIndex >= 0 && word.wordIndex < state.activeWordIndex;

    let wordScale = 1;
    let wordOffsetY = 0;
    let wordRotationRad = 0;
    let wordAlpha = 1;

    if (isActiveWord && style.animation === 'word-scale') {
      const popDur = 115 / speedFactor;
      const t = easeOutBack(activeWordElapsedMs / popDur, 1.35);
      const targetScale = 1 + 0.15 * intensity;
      wordScale = 1 + (targetScale - 1) * Math.min(1.12, t);
    } else if (isActiveWord && style.animation === 'punch-shake') {
      const punchDur = 120 / speedFactor;
      if (activeWordElapsedMs < punchDur) {
        const decay = 1 - activeWordElapsedMs / punchDur;
        wordScale = 1 + 0.1 * intensity * decay;
      }
    } else if (isActiveWord && style.animation === 'wave-jump') {
      const jumpDur = 180 / speedFactor;
      const u = clamp01(activeWordElapsedMs / jumpDur);
      wordOffsetY = -Math.sin(u * Math.PI) * fontSizePx * 0.28 * intensity;
      wordScale = 1 + Math.sin(u * Math.PI) * 0.08 * intensity;
    } else if (isActiveWord && style.animation === 'tilt-pop') {
      const tiltDur = 150 / speedFactor;
      const t = easeOutBack(activeWordElapsedMs / tiltDur, 1.4);
      const dir = word.wordIndex % 2 === 0 ? -1 : 1;
      wordRotationRad = dir * 0.065 * intensity * Math.min(1.1, t);
      wordScale = 1 + 0.12 * intensity * Math.min(1.1, t);
    } else if (isActiveWord && style.animation === 'neon-flicker') {
      const flickDur = 160 / speedFactor;
      if (activeWordElapsedMs < flickDur) {
        const step = Math.floor(activeWordElapsedMs / 22);
        wordAlpha = step % 2 === 0 ? 0.35 : 1.0;
      }
    }

    const cx = word.x + word.width * 0.5;
    const cy = word.centerY + wordOffsetY;

    ctx.save();
    if (wordAlpha !== 1) {
      ctx.globalAlpha = groupAlpha * wordAlpha;
    }
    if (wordScale !== 1 || wordRotationRad !== 0 || wordOffsetY !== 0) {
      ctx.translate(cx, cy);
      if (wordRotationRad !== 0) ctx.rotate(wordRotationRad);
      if (wordScale !== 1) ctx.scale(wordScale, wordScale);
      ctx.translate(-cx, -word.centerY);
    }

    // Glitch Flash chromatic RGB split on active word
    if (isActiveWord && style.animation === 'glitch-flash') {
      const glitchDur = 140 / speedFactor;
      if (activeWordElapsedMs < glitchDur) {
        const decay = 1 - activeWordElapsedMs / glitchDur;
        const shift = fontSizePx * 0.09 * intensity * decay;
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.fillText(word.text, word.x - shift, word.centerY);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.85)';
        ctx.fillText(word.text, word.x + shift, word.centerY);
        ctx.restore();
      }
    }

    // Active word Glow Pulse or Neon Flicker bloom
    if (
      isActiveWord &&
      (style.animation === 'glow-pulse' || style.animation === 'neon-flicker')
    ) {
      const pulse = 0.72 + 0.28 * Math.sin(activeWordElapsedMs * 0.018 * speedFactor);
      ctx.shadowColor = style.highlightColor;
      ctx.shadowBlur = fontSizePx * 0.5 * intensity * pulse;
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

    // Fill text
    if (style.animation === 'karaoke-sweep' && style.wordKaraoke) {
      if (isActiveWord) {
        ctx.fillStyle = style.textColor;
        ctx.fillText(word.text, word.x, word.centerY);
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
