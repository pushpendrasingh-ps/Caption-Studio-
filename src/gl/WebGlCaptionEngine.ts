import { computeKenBurnsTransform } from '../core/srtEngine';
import type { ActiveCaptionState, CaptionStyle, FontOption } from '../core/types';
import {
  buildCaptionStyleHash,
  renderCaptionToTransparentCanvas,
} from './captionTextureRenderer';

const VERTEX_SHADER_ES3 = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform vec2 uCropScale;
uniform float uZoomScale;
uniform vec2 uPanOffset;

out vec2 vScreenUv;
out vec2 vBgUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vScreenUv = aTexCoord;
  vec2 centered = aTexCoord - vec2(0.5);
  vBgUv = centered * (uCropScale / uZoomScale) + vec2(0.5) + uPanOffset;
}
`;

const FRAGMENT_SHADER_ES3 = `#version 300 es
precision highp float;

in vec2 vScreenUv;
in vec2 vBgUv;

uniform sampler2D uBgTexture;
uniform sampler2D uCaptionTexture;
uniform int uHasCaption;
uniform int uFitMode; // 0 = fill (cover), 1 = fit (contain with black bars)
uniform vec4 uCaptionRect;
uniform float uVignetteStrength;
uniform float uDimAmount;

out vec4 fragColor;

void main() {
  vec3 bgRgb = vec3(0.03, 0.035, 0.045);
  bool inBgBounds = vBgUv.x >= 0.0 && vBgUv.x <= 1.0 && vBgUv.y >= 0.0 && vBgUv.y <= 1.0;

  if (uFitMode == 0 || inBgBounds) {
    bgRgb = texture(uBgTexture, clamp(vBgUv, 0.0, 1.0)).rgb;
  }

  // Dark Vignette + Dim directly in GLSL ES 3.00 fragment shader
  vec2 centered = vScreenUv - vec2(0.5);
  float dist = length(centered * vec2(1.18, 1.0));
  float vignette = smoothstep(0.28, 0.92, dist) * uVignetteStrength;
  float shade = clamp((1.0 - uDimAmount) * (1.0 - vignette * 0.85), 0.0, 1.0);
  vec3 color = bgRgb * shade;

  // Alpha-blend cached caption GL_TEXTURE_2D inside its tight bounding rect
  if (uHasCaption == 1) {
    vec2 localUv = (vScreenUv - uCaptionRect.xy) / uCaptionRect.zw;
    if (localUv.x >= 0.0 && localUv.x <= 1.0 && localUv.y >= 0.0 && localUv.y <= 1.0) {
      vec4 cap = texture(uCaptionTexture, localUv);
      color = mix(color, cap.rgb, cap.a);
    }
  }

  fragColor = vec4(color, 1.0);
}
`;

export interface RenderFrameParams {
  timeMs: number;
  durationMs: number;
  captionState: ActiveCaptionState;
  style: CaptionStyle;
  font: FontOption;
}

export interface EngineTelemetry {
  backend: 'webgl2' | 'canvas2d';
  bgUploads: number;
  captionUploads: number;
  framesDrawn: number;
}

/**
 * Browser-side mirror of Android's CaptionGlRenderer.kt:
 * - Runs identical GLSL ES 3.00 shaders on WebGL2 (with automatic Canvas2D fallback).
 * - Uploads background image ONCE as GL_TEXTURE0.
 * - Supports Fill (cover) and Fit (contain) background geometry directly on GPU.
 * - Uploads transparent caption Bitmap as GL_TEXTURE1 ONLY when (stateKey + styleHash + dims) changes.
 * - Renders strictly on-demand (zero idle RAF spin).
 */
export class WebGlCaptionEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;

  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private bgTexture: WebGLTexture | null = null;
  private captionTexture: WebGLTexture | null = null;

  private locations: Record<string, WebGLUniformLocation | null> = {};

  private bgImage: HTMLImageElement | null = null;
  private bgAspect = 16 / 9;

  private captionCanvas: HTMLCanvasElement;
  private lastCaptionCacheKey = '';
  private hasCaption = false;
  private captionSize = { width: 0, height: 0 };

  public telemetry: EngineTelemetry = {
    backend: 'webgl2',
    bgUploads: 0,
    captionUploads: 0,
    framesDrawn: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.captionCanvas = document.createElement('canvas');

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    if (gl && this.initWebGl2(gl)) {
      this.gl = gl;
      this.telemetry.backend = 'webgl2';
    } else {
      this.ctx2d = canvas.getContext('2d');
      this.telemetry.backend = 'canvas2d';
    }
  }

  private initWebGl2(gl: WebGL2RenderingContext): boolean {
    try {
      const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_ES3);
      const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_ES3);
      const program = gl.createProgram();
      if (!program) return false;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return false;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      this.program = program;

      const uniformNames = [
        'uCropScale',
        'uZoomScale',
        'uPanOffset',
        'uBgTexture',
        'uCaptionTexture',
        'uHasCaption',
        'uFitMode',
        'uCaptionRect',
        'uVignetteStrength',
        'uDimAmount',
      ];
      for (const name of uniformNames) {
        this.locations[name] = gl.getUniformLocation(program, name);
      }

      const vertices = new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
         1,  1, 1, 0,
      ]);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);

      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);

      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

      gl.bindVertexArray(null);

      this.bgTexture = this.createLinearTexture(gl);
      this.captionTexture = this.createLinearTexture(gl);

      gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([16, 18, 24, 255])
      );

      return true;
    } catch {
      return false;
    }
  }

  private createLinearTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'Shader compile error';
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  public setBackgroundImage(image: HTMLImageElement): void {
    this.bgImage = image;
    this.bgAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    this.telemetry.bgUploads += 1;

    if (this.gl && this.bgTexture) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  public resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.lastCaptionCacheKey = '';
    }
  }

  public render(params: RenderFrameParams): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) return;

    const styleHash = buildCaptionStyleHash(params.style, params.font);
    const cacheKey = `${params.captionState.stateKey}#${styleHash}#${width}x${height}`;

    if (cacheKey !== this.lastCaptionCacheKey) {
      const rendered = renderCaptionToTransparentCanvas(
        params.captionState,
        params.style,
        params.font,
        width,
        height,
        params.timeMs,
        this.captionCanvas
      );

      if (rendered) {
        this.hasCaption = true;
        this.captionSize = { width: rendered.width, height: rendered.height };
        if (this.gl && this.captionTexture) {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this.captionTexture);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rendered.canvas);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
        this.telemetry.captionUploads += 1;
      } else {
        this.hasCaption = false;
      }
      this.lastCaptionCacheKey = cacheKey;
    }

    this.telemetry.framesDrawn += 1;

    if (this.gl && this.program) {
      this.renderWebGl2(params, width, height);
    } else if (this.ctx2d) {
      this.renderCanvas2dFallback(params, width, height);
    }
  }

  private renderWebGl2(params: RenderFrameParams, width: number, height: number): void {
    const gl = this.gl!;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.04, 0.045, 0.055, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    const targetAspect = width / height;
    const isFit = params.style.bgFitMode === 'fit';
    let cropScaleX = 1;
    let cropScaleY = 1;

    if (isFit) {
      // Contain / Fit inside viewport (letterbox/pillarbox)
      if (this.bgAspect > targetAspect) {
        cropScaleY = this.bgAspect / targetAspect;
      } else {
        cropScaleX = targetAspect / this.bgAspect;
      }
    } else {
      // Cover / Fill entire viewport
      if (this.bgAspect > targetAspect) {
        cropScaleX = targetAspect / this.bgAspect;
      } else {
        cropScaleY = this.bgAspect / targetAspect;
      }
    }

    const kb = computeKenBurnsTransform(params.timeMs, params.durationMs, params.style.slowZoom);
    gl.uniform2f(this.locations.uCropScale, cropScaleX, cropScaleY);
    gl.uniform1f(this.locations.uZoomScale, kb.scale);
    gl.uniform2f(this.locations.uPanOffset, kb.offsetX, kb.offsetY);
    gl.uniform1i(this.locations.uFitMode, isFit ? 1 : 0);
    gl.uniform1f(this.locations.uVignetteStrength, params.style.vignetteStrength);
    gl.uniform1f(this.locations.uDimAmount, params.style.backgroundDim);
    gl.uniform1i(this.locations.uHasCaption, this.hasCaption ? 1 : 0);

    if (this.hasCaption) {
      const normW = this.captionSize.width / width;
      const normH = this.captionSize.height / height;
      const x0 = Math.max(0, Math.min(1 - normW, params.style.positionX - normW * 0.5));
      const y0 = Math.max(0, Math.min(1 - normH, params.style.positionY - normH * 0.5));
      gl.uniform4f(this.locations.uCaptionRect, x0, y0, normW, normH);
    } else {
      gl.uniform4f(this.locations.uCaptionRect, 0, 0, 1, 1);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.uniform1i(this.locations.uBgTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.captionTexture);
    gl.uniform1i(this.locations.uCaptionTexture, 1);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private renderCanvas2dFallback(params: RenderFrameParams, width: number, height: number): void {
    const ctx = this.ctx2d!;
    ctx.fillStyle = '#090A0D';
    ctx.fillRect(0, 0, width, height);

    if (this.bgImage) {
      const targetAspect = width / height;
      const kb = computeKenBurnsTransform(params.timeMs, params.durationMs, params.style.slowZoom);

      if (params.style.bgFitMode === 'fit') {
        let drawW = width;
        let drawH = height;
        if (this.bgAspect > targetAspect) {
          drawH = width / this.bgAspect;
        } else {
          drawW = height * this.bgAspect;
        }
        drawW *= kb.scale;
        drawH *= kb.scale;
        const dx = (width - drawW) * 0.5 - kb.offsetX * width;
        const dy = (height - drawH) * 0.5 - kb.offsetY * height;
        ctx.drawImage(this.bgImage, dx, dy, drawW, drawH);
      } else {
        let sx = 0;
        let sy = 0;
        let sw = this.bgImage.naturalWidth;
        let sh = this.bgImage.naturalHeight;
        if (this.bgAspect > targetAspect) {
          sw = sh * targetAspect;
          sx = (this.bgImage.naturalWidth - sw) * 0.5;
        } else {
          sh = sw / targetAspect;
          sy = (this.bgImage.naturalHeight - sh) * 0.5;
        }
        const zW = sw / kb.scale;
        const zH = sh / kb.scale;
        const zX = sx + (sw - zW) * 0.5 + kb.offsetX * sw;
        const zY = sy + (sh - zH) * 0.5 + kb.offsetY * sh;
        ctx.drawImage(this.bgImage, zX, zY, zW, zH, 0, 0, width, height);
      }
    }

    if (params.style.backgroundDim > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${params.style.backgroundDim})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (params.style.vignetteStrength > 0) {
      const grad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.25,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${params.style.vignetteStrength * 0.85})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    if (this.hasCaption) {
      const x = Math.max(
        0,
        Math.min(width - this.captionSize.width, params.style.positionX * width - this.captionSize.width * 0.5)
      );
      const y = Math.max(
        0,
        Math.min(height - this.captionSize.height, params.style.positionY * height - this.captionSize.height * 0.5)
      );
      ctx.drawImage(this.captionCanvas, x, y);
    }
  }

  public dispose(): void {
    if (this.gl) {
      const gl = this.gl;
      if (this.bgTexture) gl.deleteTexture(this.bgTexture);
      if (this.captionTexture) gl.deleteTexture(this.captionTexture);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.ctx2d = null;
  }
}
