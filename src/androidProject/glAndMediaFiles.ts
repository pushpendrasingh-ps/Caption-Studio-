import type { AndroidProjectFile } from './gradleAndCoreFiles';

export const GL_AND_MEDIA_FILES: AndroidProjectFile[] = [
  {
    path: 'app/src/main/java/com/captionstudio/gl/EglCore.kt',
    name: 'EglCore.kt',
    category: 'OpenGL ES 3.0 & EGL',
    language: 'kotlin',
    summary: 'EGL14 context + EGL_RECORDABLE_ANDROID window surface bridge to MediaCodec input Surface with EGLExt.eglPresentationTimeANDROID.',
    content: `package com.captionstudio.gl

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.view.Surface

/**
 * Manages an OpenGL ES 3.0 EGL14 context attached directly to a MediaCodec
 * COLOR_FormatSurface input Surface for zero-copy GPU-to-encoder rendering.
 */
class EglCore(encoderInputSurface: Surface) : AutoCloseable {

    private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE

    init {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        require(eglDisplay != EGL14.EGL_NO_DISPLAY) { "Unable to acquire EGL14 display" }

        val version = IntArray(2)
        require(EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
            "Unable to initialize EGL14"
        }

        val attribList = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR,
            EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_NONE
        )

        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        require(
            EGL14.eglChooseConfig(
                eglDisplay, attribList, 0, configs, 0, configs.size, numConfigs, 0
            ) && numConfigs[0] > 0
        ) { "Unable to find RGB8888 ES3 recordable EGLConfig" }

        val config = configs[0]!!
        val contextAttribs = intArrayOf(
            EGL14.EGL_CONTEXT_CLIENT_VERSION, 3,
            EGL14.EGL_NONE
        )
        eglContext = EGL14.eglCreateContext(
            eglDisplay, config, EGL14.EGL_NO_CONTEXT, contextAttribs, 0
        )
        checkEglError("eglCreateContext")

        val surfaceAttribs = intArrayOf(EGL14.EGL_NONE)
        eglSurface = EGL14.eglCreateWindowSurface(
            eglDisplay, config, encoderInputSurface, surfaceAttribs, 0
        )
        checkEglError("eglCreateWindowSurface")
    }

    fun makeCurrent() {
        if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) {
            throw RuntimeException("eglMakeCurrent failed: 0x\${Integer.toHexString(EGL14.eglGetError())}")
        }
    }

    /**
     * Stamps the exact nanosecond presentation timestamp onto the hardware encoder surface.
     * Enables Smart Event-Frame encoding when Slow Zoom is OFF (only submit frames on changes + 2s keyframes).
     */
    fun setPresentationTimeNs(presentationTimeNs: Long) {
        EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, presentationTimeNs)
        checkEglError("eglPresentationTimeANDROID")
    }

    fun swapBuffers(): Boolean {
        return EGL14.eglSwapBuffers(eglDisplay, eglSurface)
    }

    override fun close() {
        if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(
                eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT
            )
            if (eglSurface != EGL14.EGL_NO_SURFACE) {
                EGL14.eglDestroySurface(eglDisplay, eglSurface)
            }
            if (eglContext != EGL14.EGL_NO_CONTEXT) {
                EGL14.eglDestroyContext(eglDisplay, eglContext)
            }
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(eglDisplay)
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY
        eglContext = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
    }

    private fun checkEglError(op: String) {
        val error = EGL14.eglGetError()
        if (error != EGL14.EGL_SUCCESS) {
            throw RuntimeException("\$op failed with EGL error 0x\${Integer.toHexString(error)}")
        }
    }

    companion object {
        private const val EGL_RECORDABLE_ANDROID = 0x3142
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/gl/CaptionGlRenderer.kt',
    name: 'CaptionGlRenderer.kt',
    category: 'OpenGL ES 3.0 & EGL',
    language: 'kotlin',
    summary: 'OpenGL ES 3.0 (#version 300 es) renderer: single background GL_TEXTURE_2D upload, Ken Burns vertex matrix, Vignette/Dim fragment shader, cached caption GL_TEXTURE_2D alpha-blend.',
    content: `package com.captionstudio.gl

import android.graphics.Bitmap
import android.opengl.GLES30
import android.opengl.GLUtils
import android.opengl.Matrix
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.max

/**
 * Zero-copy OpenGL ES 3.0 compositor:
 * 1. Background image uploaded ONCE as GL_TEXTURE0 (center-cropped via UV matrix).
 * 2. Slow Zoom (Ken Burns) computed purely in the vertex shader via a 4x4 MVP/UV matrix.
 * 3. Dark Vignette + Background Dim computed per-pixel in the GLSL ES 3.00 fragment shader.
 * 4. Caption Bitmap uploaded as GL_TEXTURE1 ONLY when the caption/word state changes,
 *    then alpha-blended cleanly in the fragment shader.
 */
class CaptionGlRenderer(
    private val outputWidth: Int,
    private val outputHeight: Int
) : AutoCloseable {

    private var programId = 0
    private var bgTextureId = 0
    private var captionTextureId = 0
    private var bgAspectRatio = 16f / 9f
    private var hasCaptionTexture = false

    // Normalized caption overlay quad bounds in [0..1] screen UV space (x0, y0, width, height)
    private val captionBounds = FloatArray(4)

    // Uniform locations
    private var uKenBurnsMatrixLoc = -1
    private var uBgTextureLoc = -1
    private var uCaptionTextureLoc = -1
    private var uHasCaptionLoc = -1
    private var uCaptionRectLoc = -1
    private var uVignetteStrengthLoc = -1
    private var uDimAmountLoc = -1

    private val quadBuffer: FloatBuffer = ByteBuffer
        .allocateDirect(FULLSCREEN_QUAD.size * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .put(FULLSCREEN_QUAD)
        .apply { position(0) }

    private val uvMatrix = FloatArray(16)

    fun initialize(backgroundBitmap: Bitmap) {
        programId = buildProgram(VERTEX_SHADER_ES3, FRAGMENT_SHADER_ES3)
        GLES30.glUseProgram(programId)

        uKenBurnsMatrixLoc = GLES30.glGetUniformLocation(programId, "uKenBurnsMatrix")
        uBgTextureLoc = GLES30.glGetUniformLocation(programId, "uBgTexture")
        uCaptionTextureLoc = GLES30.glGetUniformLocation(programId, "uCaptionTexture")
        uHasCaptionLoc = GLES30.glGetUniformLocation(programId, "uHasCaption")
        uCaptionRectLoc = GLES30.glGetUniformLocation(programId, "uCaptionRect")
        uVignetteStrengthLoc = GLES30.glGetUniformLocation(programId, "uVignetteStrength")
        uDimAmountLoc = GLES30.glGetUniformLocation(programId, "uDimAmount")

        val textures = IntArray(2)
        GLES30.glGenTextures(2, textures, 0)
        bgTextureId = textures[0]
        captionTextureId = textures[1]

        // Upload background image ONCE for the entire export session
        bgAspectRatio = backgroundBitmap.width.toFloat() / max(1, backgroundBitmap.height).toFloat()
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, bgTextureId)
        configureLinearClampTexture()
        GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, backgroundBitmap, 0)

        // Prepare caption overlay texture unit (populated lazily on caption state change)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, captionTextureId)
        configureLinearClampTexture()
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0)

        GLES30.glViewport(0, 0, outputWidth, outputHeight)
    }

    /**
     * Uploads a tightly cropped transparent caption Bitmap into GL_TEXTURE1.
     * Called ONLY when ActiveCaptionState.stateKey changes (dirty-flag cached by exporter).
     */
    fun uploadCaptionBitmap(
        bitmap: Bitmap?,
        anchorX: Float,
        anchorY: Float
    ) {
        if (bitmap == null) {
            hasCaptionTexture = false
            return
        }
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, captionTextureId)
        GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, bitmap, 0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0)

        val normW = bitmap.width.toFloat() / outputWidth.toFloat()
        val normH = bitmap.height.toFloat() / outputHeight.toFloat()
        captionBounds[0] = (anchorX - normW * 0.5f).coerceIn(0f, 1f - normW)
        captionBounds[1] = (anchorY - normH * 0.5f).coerceIn(0f, 1f - normH)
        captionBounds[2] = normW
        captionBounds[3] = normH
        hasCaptionTexture = true
    }

    fun drawFrame(
        progress: Float,
        slowZoomEnabled: Boolean,
        vignetteStrength: Float,
        backgroundDim: Float
    ) {
        GLES30.glClearColor(0f, 0f, 0f, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        GLES30.glUseProgram(programId)

        // Compute center-crop + smooth Ken Burns Slow Zoom UV matrix directly on GPU
        computeBackgroundUvMatrix(progress, slowZoomEnabled)
        GLES30.glUniformMatrix4fv(uKenBurnsMatrixLoc, 1, false, uvMatrix, 0)

        GLES30.glUniform1f(uVignetteStrengthLoc, vignetteStrength.coerceIn(0f, 1f))
        GLES30.glUniform1f(uDimAmountLoc, backgroundDim.coerceIn(0f, 0.85f))
        GLES30.glUniform1i(uHasCaptionLoc, if (hasCaptionTexture) 1 else 0)
        GLES30.glUniform4fv(uCaptionRectLoc, 1, captionBounds, 0)

        // Bind TEXTURE0 = Background, TEXTURE1 = Cached Caption Bitmap
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, bgTextureId)
        GLES30.glUniform1i(uBgTextureLoc, 0)

        GLES30.glActiveTexture(GLES30.GL_TEXTURE1)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, captionTextureId)
        GLES30.glUniform1i(uCaptionTextureLoc, 1)

        // Interleaved position (vec2) + UV (vec2)
        quadBuffer.position(0)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 16, quadBuffer)

        quadBuffer.position(2)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 16, quadBuffer)

        GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)

        GLES30.glDisableVertexAttribArray(0)
        GLES30.glDisableVertexAttribArray(1)
    }

    private fun computeBackgroundUvMatrix(progress: Float, slowZoomEnabled: Boolean) {
        val targetAspect = outputWidth.toFloat() / outputHeight.toFloat()
        var cropScaleX = 1f
        var cropScaleY = 1f
        if (bgAspectRatio > targetAspect) {
            cropScaleX = targetAspect / bgAspectRatio
        } else {
            cropScaleY = bgAspectRatio / targetAspect
        }

        val p = progress.coerceIn(0f, 1f)
        val eased = p * p * (3f - 2f * p)
        val zoomFactor = if (slowZoomEnabled) 1f / (1f + 0.12f * eased) else 1f
        val panX = if (slowZoomEnabled) (eased - 0.5f) * 0.025f else 0f
        val panY = if (slowZoomEnabled) (0.5f - eased) * 0.018f else 0f

        Matrix.setIdentityM(uvMatrix, 0)
        Matrix.translateM(uvMatrix, 0, 0.5f + panX, 0.5f + panY, 0f)
        Matrix.scaleM(uvMatrix, 0, cropScaleX * zoomFactor, cropScaleY * zoomFactor, 1f)
        Matrix.translateM(uvMatrix, 0, -0.5f, -0.5f, 0f)
    }

    private fun configureLinearClampTexture() {
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    }

    override fun close() {
        val textures = intArrayOf(bgTextureId, captionTextureId)
        GLES30.glDeleteTextures(2, textures, 0)
        if (programId != 0) GLES30.glDeleteProgram(programId)
        programId = 0
    }

    private fun buildProgram(vsSource: String, fsSource: String): Int {
        val vs = compileShader(GLES30.GL_VERTEX_SHADER, vsSource)
        val fs = compileShader(GLES30.GL_FRAGMENT_SHADER, fsSource)
        val program = GLES30.glCreateProgram()
        GLES30.glAttachShader(program, vs)
        GLES30.glAttachShader(program, fs)
        GLES30.glLinkProgram(program)
        val status = IntArray(1)
        GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, status, 0)
        if (status[0] == 0) {
            val log = GLES30.glGetProgramInfoLog(program)
            GLES30.glDeleteProgram(program)
            throw RuntimeException("GLSL link failed: \$log")
        }
        GLES30.glDeleteShader(vs)
        GLES30.glDeleteShader(fs)
        return program
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES30.glCreateShader(type)
        GLES30.glShaderSource(shader, source)
        GLES30.glCompileShader(shader)
        val status = IntArray(1)
        GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) {
            val log = GLES30.glGetShaderInfoLog(shader)
            GLES30.glDeleteShader(shader)
            throw RuntimeException("GLSL compile failed: \$log")
        }
        return shader
    }

    companion object {
        // Screen quad: (x, y, u, v) with top-left UV origin matching Android Bitmaps
        private val FULLSCREEN_QUAD = floatArrayOf(
            -1f, -1f, 0f, 1f,
             1f, -1f, 1f, 1f,
            -1f,  1f, 0f, 0f,
             1f,  1f, 1f, 0f
        )

        private const val VERTEX_SHADER_ES3 = """#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uKenBurnsMatrix;

out vec2 vScreenUv;
out vec2 vBgUv;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vScreenUv = aTexCoord;
    vBgUv = (uKenBurnsMatrix * vec4(aTexCoord, 0.0, 1.0)).xy;
}
"""

        private const val FRAGMENT_SHADER_ES3 = """#version 300 es
precision highp float;

in vec2 vScreenUv;
in vec2 vBgUv;

uniform sampler2D uBgTexture;
uniform sampler2D uCaptionTexture;
uniform int uHasCaption;
uniform vec4 uCaptionRect;      // (x, y, width, height) in normalized [0..1] screen UV
uniform float uVignetteStrength;
uniform float uDimAmount;

out vec4 fragColor;

void main() {
    vec4 bg = texture(uBgTexture, vBgUv);

    // Dark Vignette + Dim computed directly on mobile GPU
    vec2 centered = vScreenUv - vec2(0.5);
    float dist = length(centered * vec2(1.18, 1.0));
    float vignette = smoothstep(0.28, 0.92, dist) * uVignetteStrength;
    float shade = clamp((1.0 - uDimAmount) * (1.0 - vignette * 0.85), 0.0, 1.0);
    vec3 color = bg.rgb * shade;

    // Alpha-blend cached caption GL_TEXTURE_2D overlay inside its tight bounding rect
    if (uHasCaption == 1) {
        vec2 localUv = (vScreenUv - uCaptionRect.xy) / uCaptionRect.zw;
        if (localUv.x >= 0.0 && localUv.x <= 1.0 && localUv.y >= 0.0 && localUv.y <= 1.0) {
            vec4 cap = texture(uCaptionTexture, localUv);
            color = mix(color, cap.rgb, cap.a);
        }
    }

    fragColor = vec4(color, 1.0);
}
"""
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/gl/CaptionBitmapRenderer.kt',
    name: 'CaptionBitmapRenderer.kt',
    category: 'OpenGL ES 3.0 & EGL',
    language: 'kotlin',
    summary: 'Renders each unique caption/karaoke state ONCE into a tightly cropped transparent Android Bitmap with outline stroke, rounded backdrop box, custom TTF/OTF Typeface, and word highlighting.',
    content: `package com.captionstudio.gl

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.text.TextPaint
import com.captionstudio.model.ActiveCaptionState
import com.captionstudio.model.CaptionStyle
import java.io.File
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Renders a single caption/karaoke state into a small, tightly-cropped transparent ARGB_8888 Bitmap.
 * Cached by stateKey so identical frames reuse the same GL_TEXTURE_2D with zero CPU redraws.
 */
class CaptionBitmapRenderer(private val context: Context) {

    private var cachedCustomUri: Uri? = null
    private var cachedCustomTypeface: Typeface? = null

    fun renderToBitmap(
        state: ActiveCaptionState,
        style: CaptionStyle,
        videoWidth: Int,
        videoHeight: Int
    ): Bitmap? {
        if (state.cue == null || state.words.isEmpty()) return null

        val shortEdge = min(videoWidth, videoHeight).toFloat()
        val scale = shortEdge / 1080f
        val fontSizePx = style.fontSizePx * scale
        val outlinePx = style.outlineThicknessPx * scale
        val maxTextWidth = (videoWidth * style.maxWidthFraction.coerceIn(0.35f, 0.95f))

        val typeface = resolveTypeface(style)
        val fillPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            this.typeface = typeface
            textSize = fontSizePx
            color = style.textColor
            textAlign = Paint.Align.LEFT
        }
        val strokePaint = TextPaint(fillPaint).apply {
            this.style = Paint.Style.STROKE
            strokeWidth = outlinePx * 2f
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
            color = Color.BLACK
        }

        val spaceWidth = fillPaint.measureText(" ")

        // Word-wrap while preserving explicit SRT line breaks and karaoke word indices
        data class MeasuredWord(val text: String, val width: Float, val wordIndex: Int)
        val wrappedLines = mutableListOf<List<MeasuredWord>>()

        val explicitLineGroups = state.words.groupBy { it.lineIndex }.toSortedMap()
        for ((_, lineWords) in explicitLineGroups) {
            var currentLine = mutableListOf<MeasuredWord>()
            var currentWidth = 0f

            for (token in lineWords) {
                val w = fillPaint.measureText(token.text)
                val projected = if (currentLine.isEmpty()) w else currentWidth + spaceWidth + w
                if (currentLine.isNotEmpty() && projected > maxTextWidth) {
                    wrappedLines += currentLine
                    currentLine = mutableListOf(MeasuredWord(token.text, w, token.wordIndex))
                    currentWidth = w
                } else {
                    currentLine += MeasuredWord(token.text, w, token.wordIndex)
                    currentWidth = projected
                }
            }
            if (currentLine.isNotEmpty()) wrappedLines += currentLine
        }

        if (wrappedLines.isEmpty()) return null

        val fm = fillPaint.fontMetrics
        val lineHeight = (fm.descent - fm.ascent) * 1.18f
        val lineWidths = wrappedLines.map { line ->
            line.sumOf { it.width.toDouble() }.toFloat() + spaceWidth * max(0, line.size - 1)
        }
        val contentWidth = lineWidths.maxOrNull() ?: 1f
        val contentHeight = lineHeight * wrappedLines.size

        val padX = (fontSizePx * 0.48f) + outlinePx
        val padY = (fontSizePx * 0.30f) + outlinePx
        val bmpWidth = ceil(contentWidth + padX * 2f).toInt().coerceIn(8, videoWidth)
        val bmpHeight = ceil(contentHeight + padY * 2f).toInt().coerceIn(8, videoHeight)

        val bitmap = Bitmap.createBitmap(bmpWidth, bmpHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        // Optional translucent rounded caption box
        if (style.boxOpacity > 0.01f) {
            val boxAlpha = (style.boxOpacity.coerceIn(0f, 1f) * 255f).roundToInt()
            val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = (style.boxColor and 0x00FFFFFF) or (boxAlpha shl 24)
            }
            val radius = fontSizePx * 0.28f
            canvas.drawRoundRect(
                RectF(0f, 0f, bmpWidth.toFloat(), bmpHeight.toFloat()),
                radius,
                radius,
                boxPaint
            )
        }

        // Draw centered wrapped lines with stroke outline + active karaoke word highlight
        var baselineY = padY - fm.ascent + (lineHeight - (fm.descent - fm.ascent)) * 0.5f
        wrappedLines.forEachIndexed { lineIdx, line ->
            var cursorX = (bmpWidth - lineWidths[lineIdx]) * 0.5f
            line.forEachIndexed { idxInLine, word ->
                if (outlinePx > 0.25f) {
                    canvas.drawText(word.text, cursorX, baselineY, strokePaint)
                }
                val isHighlighted = style.wordKaraokeEnabled && word.wordIndex == state.activeWordIndex
                fillPaint.color = if (isHighlighted) style.highlightColor else style.textColor
                canvas.drawText(word.text, cursorX, baselineY, fillPaint)

                cursorX += word.width
                if (idxInLine < line.lastIndex) cursorX += spaceWidth
            }
            baselineY += lineHeight
        }

        return bitmap
    }

    private fun resolveTypeface(style: CaptionStyle): Typeface {
        val uri = style.customFontUri ?: return style.builtInFont.typeface
        if (uri == cachedCustomUri && cachedCustomTypeface != null) {
            return cachedCustomTypeface!!
        }
        return runCatching {
            val cacheFile = File(context.cacheDir, "custom_font_\${uri.hashCode()}.ttf")
            context.contentResolver.openInputStream(uri)?.use { input ->
                cacheFile.outputStream().use { output -> input.copyTo(output) }
            }
            Typeface.createFromFile(cacheFile).also {
                cachedCustomUri = uri
                cachedCustomTypeface = it
            }
        }.getOrElse { style.builtInFont.typeface }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/media/AudioTrackPipeline.kt',
    name: 'AudioTrackPipeline.kt',
    category: 'MediaCodec & Audio',
    language: 'kotlin',
    summary: 'Zero-re-encode AAC/.m4a pass-through via MediaExtractor→MediaMuxer + automatic MediaCodec PCM→AAC-LC 128 kbps transcoder for .mp3/.wav/.ogg.',
    content: `package com.captionstudio.media

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import java.nio.ByteBuffer

/**
 * Handles audio ingestion for MediaMuxer:
 * - .m4a / audio/mp4a-latm: Direct zero-re-encode compressed packet pass-through.
 * - .mp3 / .wav / .ogg / FLAC: Automatic MediaCodec decode -> PCM -> AAC-LC (128 kbps) encode.
 */
object AudioTrackPipeline {

    private const val AAC_MIME = MediaFormat.MIMETYPE_AUDIO_AAC
    private const val TARGET_BITRATE_BPS = 128_000
    private const val TIMEOUT_US = 10_000L

    data class AudioPrepResult(
        val audioFormat: MediaFormat,
        val isPassThrough: Boolean,
        val durationMs: Long
    )

    fun inspectAudio(context: Context, audioUri: Uri): AudioPrepResult? {
        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(context, audioUri, null)
            val trackIdx = findAudioTrack(extractor) ?: return null
            val inputFormat = extractor.getTrackFormat(trackIdx)
            val mime = inputFormat.getString(MediaFormat.KEY_MIME).orEmpty()
            val durationUs = if (inputFormat.containsKey(MediaFormat.KEY_DURATION)) {
                inputFormat.getLong(MediaFormat.KEY_DURATION)
            } else {
                0L
            }
            val isAacPassThrough = mime.equals(AAC_MIME, ignoreCase = true)
            val muxerFormat = if (isAacPassThrough) {
                inputFormat
            } else {
                val sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                val channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                buildAacOutputFormat(sampleRate, channels)
            }
            AudioPrepResult(muxerFormat, isAacPassThrough, durationUs / 1_000L)
        } finally {
            extractor.release()
        }
    }

    /**
     * Zero-re-encode copy of AAC packets directly from MediaExtractor into MediaMuxer.
     */
    fun copyAacPassThrough(
        context: Context,
        audioUri: Uri,
        muxer: MediaMuxer,
        muxerAudioTrackIndex: Int,
        maxDurationUs: Long
    ) {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(context, audioUri, null)
            val trackIdx = findAudioTrack(extractor) ?: return
            extractor.selectTrack(trackIdx)

            val buffer = ByteBuffer.allocateDirect(256 * 1024)
            val info = MediaCodec.BufferInfo()

            while (true) {
                val sampleSize = extractor.readSampleData(buffer, 0)
                if (sampleSize < 0) break

                val ptsUs = extractor.sampleTime
                if (maxDurationUs > 0 && ptsUs > maxDurationUs) break

                info.offset = 0
                info.size = sampleSize
                info.presentationTimeUs = ptsUs
                info.flags = extractor.sampleFlags
                muxer.writeSampleData(muxerAudioTrackIndex, buffer, info)
                extractor.advance()
            }
        } finally {
            extractor.release()
        }
    }

    /**
     * Transcodes .mp3 / .wav / .ogg -> PCM via MediaCodec decoder -> AAC-LC 128 kbps encoder
     * and writes encoded frames directly into MediaMuxer.
     */
    fun transcodeToAacAndMux(
        context: Context,
        audioUri: Uri,
        muxer: MediaMuxer,
        muxerAudioTrackIndex: Int,
        maxDurationUs: Long
    ) {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null

        try {
            extractor.setDataSource(context, audioUri, null)
            val trackIdx = findAudioTrack(extractor) ?: return
            extractor.selectTrack(trackIdx)

            val inputFormat = extractor.getTrackFormat(trackIdx)
            val inputMime = inputFormat.getString(MediaFormat.KEY_MIME)!!
            val sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val channelCount = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

            decoder = MediaCodec.createDecoderByType(inputMime).apply {
                configure(inputFormat, null, null, 0)
                start()
            }

            val aacFormat = buildAacOutputFormat(sampleRate, channelCount)
            encoder = MediaCodec.createEncoderByType(AAC_MIME).apply {
                configure(aacFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }

            val decInfo = MediaCodec.BufferInfo()
            val encInfo = MediaCodec.BufferInfo()
            var extractorDone = false
            var decoderDone = false
            var encoderDone = false

            while (!encoderDone) {
                // 1. Feed compressed source audio into decoder
                if (!extractorDone) {
                    val inIdx = decoder.dequeueInputBuffer(TIMEOUT_US)
                    if (inIdx >= 0) {
                        val inBuf = decoder.getInputBuffer(inIdx)!!
                        val size = extractor.readSampleData(inBuf, 0)
                        val ptsUs = extractor.sampleTime
                        if (size < 0 || (maxDurationUs > 0 && ptsUs > maxDurationUs)) {
                            decoder.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            extractorDone = true
                        } else {
                            decoder.queueInputBuffer(inIdx, 0, size, ptsUs, 0)
                            extractor.advance()
                        }
                    }
                }

                // 2. Drain decoded PCM from decoder -> feed into AAC-LC encoder
                if (!decoderDone) {
                    val decOutIdx = decoder.dequeueOutputBuffer(decInfo, TIMEOUT_US)
                    if (decOutIdx >= 0) {
                        val pcmBuf = decoder.getOutputBuffer(decOutIdx)!!
                        val isEos = (decInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0

                        var remaining = decInfo.size
                        var offset = decInfo.offset
                        while (remaining > 0 || isEos) {
                            val encInIdx = encoder.dequeueInputBuffer(TIMEOUT_US)
                            if (encInIdx >= 0) {
                                val encInBuf = encoder.getInputBuffer(encInIdx)!!
                                encInBuf.clear()
                                val toCopy = minOf(remaining, encInBuf.remaining())
                                if (toCopy > 0) {
                                    pcmBuf.position(offset)
                                    pcmBuf.limit(offset + toCopy)
                                    encInBuf.put(pcmBuf)
                                    offset += toCopy
                                    remaining -= toCopy
                                }
                                val flags = if (isEos && remaining == 0) {
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                } else 0
                                encoder.queueInputBuffer(encInIdx, 0, toCopy, decInfo.presentationTimeUs, flags)
                                if (remaining == 0) break
                            }
                            drainAacEncoder(encoder, encInfo, muxer, muxerAudioTrackIndex)
                        }

                        decoder.releaseOutputBuffer(decOutIdx, false)
                        if (isEos) decoderDone = true
                    }
                }

                // 3. Drain AAC-LC frames to MediaMuxer
                if (drainAacEncoder(encoder, encInfo, muxer, muxerAudioTrackIndex)) {
                    encoderDone = true
                }
            }
        } finally {
            runCatching { decoder?.stop(); decoder?.release() }
            runCatching { encoder?.stop(); encoder?.release() }
            extractor.release()
        }
    }

    private fun drainAacEncoder(
        encoder: MediaCodec,
        info: MediaCodec.BufferInfo,
        muxer: MediaMuxer,
        trackIndex: Int
    ): Boolean {
        while (true) {
            val outIdx = encoder.dequeueOutputBuffer(info, 0)
            when {
                outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
                outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> Unit
                outIdx >= 0 -> {
                    val outBuf = encoder.getOutputBuffer(outIdx)!!
                    val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                    if (!isConfig && info.size > 0) {
                        outBuf.position(info.offset)
                        outBuf.limit(info.offset + info.size)
                        muxer.writeSampleData(trackIndex, outBuf, info)
                    }
                    encoder.releaseOutputBuffer(outIdx, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        return true
                    }
                }
            }
        }
    }

    private fun buildAacOutputFormat(sampleRate: Int, channelCount: Int): MediaFormat {
        return MediaFormat.createAudioFormat(AAC_MIME, sampleRate, channelCount).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, TARGET_BITRATE_BPS)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
    }

    private fun findAudioTrack(extractor: MediaExtractor): Int? {
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME).orEmpty()
            if (mime.startsWith("audio/")) return i
        }
        return null
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/media/ZeroCopyVideoExporter.kt',
    name: 'ZeroCopyVideoExporter.kt',
    category: 'MediaCodec & Audio',
    language: 'kotlin',
    summary: 'Zero-Copy Hardware H.264 MediaCodec + dedicated GL HandlerThread + async encoder drain thread + MediaStore Movies/CaptionStudio/ writer.',
    content: `package com.captionstudio.media

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import com.captionstudio.gl.CaptionBitmapRenderer
import com.captionstudio.gl.CaptionGlRenderer
import com.captionstudio.gl.EglCore
import com.captionstudio.model.ExportRequest
import com.captionstudio.model.ExportState
import com.captionstudio.srt.SrtParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max

/**
 * CapCut-style Zero-Copy 1080p MP4 Exporter:
 * - Dedicated GL Render HandlerThread owning EGL14 + OpenGL ES 3.0 textures.
 * - Dedicated Hardware MediaCodec Drain Thread piping H.264 NALUs straight to MediaMuxer.
 * - Smart Event-Frame Timestamps via EGLExt.eglPresentationTimeANDROID when Slow Zoom is OFF.
 * - Continuous 24/30 fps asynchronous GPU loop when Slow Zoom is ON.
 * - Direct MediaStore output into Movies/CaptionStudio/.
 */
class ZeroCopyVideoExporter(private val context: Context) {

    suspend fun export(
        request: ExportRequest,
        onProgress: (ExportState.Exporting) -> Unit
    ): ExportState = withContext(Dispatchers.IO) {
        val startWallMs = System.currentTimeMillis()
        val width = request.aspectRatio.width
        val height = request.aspectRatio.height

        val audioPrep = request.audioUri?.let { AudioTrackPipeline.inspectAudio(context, it) }
        val lastCueMs = request.cues.maxOfOrNull { it.endMs } ?: 0L
        val durationMs = max(max(lastCueMs + 500L, audioPrep?.durationMs ?: 0L), 5_000L)

        val timestampsUs = SrtParser.buildPresentationTimestampsUs(
            cues = request.cues,
            durationMs = durationMs,
            slowZoomEnabled = request.style.slowZoomEnabled,
            wordKaraokeEnabled = request.style.wordKaraokeEnabled,
            fps = request.style.fps
        )

        val backgroundBitmap = decodeScaledBackground(request.imageUri, width, height)
            ?: return@withContext ExportState.Failed("Unable to decode background image")

        val tempMp4 = File(context.cacheDir, "captionstudio_export_\${System.currentTimeMillis()}.mp4")
        val muxer = MediaMuxer(tempMp4.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        val videoFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000) // Crisp 8 Mbps 1080p H.264
            setInteger(MediaFormat.KEY_FRAME_RATE, request.style.fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        }

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = encoder.createInputSurface()
        encoder.start()

        val muxerLock = Any()
        var videoTrackIndex = -1
        var audioTrackIndex = -1
        var muxerStarted = false

        val drainError = AtomicReference<Throwable?>(null)
        val drainDoneLatch = CountDownLatch(1)

        // Thread 1: Asynchronous Hardware Encoder Drain Thread
        val drainThread = Thread({
            val info = MediaCodec.BufferInfo()
            try {
                while (true) {
                    val outIdx = encoder.dequeueOutputBuffer(info, 10_000L)
                    when {
                        outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                        outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            synchronized(muxerLock) {
                                videoTrackIndex = muxer.addTrack(encoder.outputFormat)
                                if (audioPrep != null) {
                                    audioTrackIndex = muxer.addTrack(audioPrep.audioFormat)
                                }
                                muxer.start()
                                muxerStarted = true
                            }
                        }
                        outIdx >= 0 -> {
                            val encodedData = encoder.getOutputBuffer(outIdx)!!
                            val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            if (!isConfig && info.size > 0) {
                                encodedData.position(info.offset)
                                encodedData.limit(info.offset + info.size)
                                synchronized(muxerLock) {
                                    if (muxerStarted) {
                                        muxer.writeSampleData(videoTrackIndex, encodedData, info)
                                    }
                                }
                            }
                            encoder.releaseOutputBuffer(outIdx, false)
                            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                                break
                            }
                        }
                    }
                }
            } catch (t: Throwable) {
                drainError.set(t)
            } finally {
                drainDoneLatch.countDown()
            }
        }, "CaptionStudio-H264-Drain")
        drainThread.start()

        // Thread 2: Dedicated OpenGL ES 3.0 Render HandlerThread
        val glThread = HandlerThread("CaptionStudio-GLES3-Render").apply { start() }
        val glError = AtomicReference<Throwable?>(null)
        val glDoneLatch = CountDownLatch(1)
        var textureUploads = 0

        Handler(glThread.looper).post {
            var eglCore: EglCore? = null
            var glRenderer: CaptionGlRenderer? = null
            val bitmapRenderer = CaptionBitmapRenderer(context)
            var lastCaptionStateKey: String? = null

            try {
                eglCore = EglCore(inputSurface)
                eglCore.makeCurrent()

                glRenderer = CaptionGlRenderer(width, height).apply {
                    initialize(backgroundBitmap)
                }

                val totalFrames = timestampsUs.size
                val durationUs = max(1L, durationMs * 1_000L)

                timestampsUs.forEachIndexed { idx, ptsUs ->
                    val timeMs = ptsUs / 1_000L
                    val activeCaption = SrtParser.resolveCaptionAt(
                        cues = request.cues,
                        timeMs = timeMs,
                        wordKaraoke = request.style.wordKaraokeEnabled,
                        uppercase = request.style.uppercaseEnabled
                    )

                    // Dirty-flag texture cache: render & upload caption Bitmap ONLY on text/word state change
                    if (activeCaption.stateKey != lastCaptionStateKey) {
                        val captionBitmap = bitmapRenderer.renderToBitmap(
                            state = activeCaption,
                            style = request.style,
                            videoWidth = width,
                            videoHeight = height
                        )
                        glRenderer.uploadCaptionBitmap(
                            bitmap = captionBitmap,
                            anchorX = request.style.positionX,
                            anchorY = request.style.positionY
                        )
                        captionBitmap?.recycle()
                        lastCaptionStateKey = activeCaption.stateKey
                        textureUploads++
                    }

                    val progress = ptsUs.toFloat() / durationUs.toFloat()
                    glRenderer.drawFrame(
                        progress = progress,
                        slowZoomEnabled = request.style.slowZoomEnabled,
                        vignetteStrength = request.style.vignetteStrength,
                        backgroundDim = request.style.backgroundDim
                    )

                    // Stamp exact presentation timestamp onto EGLSurface and swap straight to H.264 encoder
                    eglCore.setPresentationTimeNs(ptsUs * 1_000L)
                    eglCore.swapBuffers()

                    if (idx % 4 == 0 || idx == totalFrames - 1) {
                        onProgress(
                            ExportState.Exporting(
                                progress = (idx + 1).toFloat() / totalFrames.toFloat() * 0.85f,
                                stage = if (request.style.slowZoomEnabled) {
                                    "GPU Ken Burns \${request.style.fps} fps render"
                                } else {
                                    "Smart Event-Frame GPU render"
                                },
                                renderedFrames = idx + 1,
                                totalFrames = totalFrames,
                                textureUploads = textureUploads
                            )
                        )
                    }
                }

                encoder.signalEndOfInputStream()
            } catch (t: Throwable) {
                glError.set(t)
            } finally {
                runCatching { glRenderer?.close() }
                runCatching { eglCore?.close() }
                glDoneLatch.countDown()
            }
        }

        glDoneLatch.await()
        drainDoneLatch.await()
        glThread.quitSafely()
        backgroundBitmap.recycle()

        runCatching { encoder.stop(); encoder.release() }
        runCatching { inputSurface.release() }

        val pipelineError = glError.get() ?: drainError.get()
        if (pipelineError != null) {
            runCatching { muxer.release() }
            tempMp4.delete()
            return@withContext ExportState.Failed(pipelineError.message ?: "GPU export error")
        }

        // Phase 2: Mux Audio Track (Pass-through AAC or Automatic PCM->AAC-LC 128 kbps transcode)
        val audioModeLabel = if (request.audioUri != null && audioPrep != null && audioTrackIndex >= 0) {
            onProgress(
                ExportState.Exporting(
                    progress = 0.90f,
                    stage = if (audioPrep.isPassThrough) {
                        "Muxing direct AAC pass-through"
                    } else {
                        "Transcoding audio to AAC-LC 128 kbps"
                    },
                    renderedFrames = timestampsUs.size,
                    totalFrames = timestampsUs.size,
                    textureUploads = textureUploads
                )
            )
            val maxDurationUs = durationMs * 1_000L
            if (audioPrep.isPassThrough) {
                AudioTrackPipeline.copyAacPassThrough(context, request.audioUri, muxer, audioTrackIndex, maxDurationUs)
                "Direct AAC Pass-through"
            } else {
                AudioTrackPipeline.transcodeToAacAndMux(context, request.audioUri, muxer, audioTrackIndex, maxDurationUs)
                "Transcoded PCM → AAC-LC 128 kbps"
            }
        } else {
            "Video only (no audio track)"
        }

        runCatching {
            if (muxerStarted) muxer.stop()
            muxer.release()
        }

        // Phase 3: Publish to Movies/CaptionStudio/ via MediaStore
        val savedUri = saveToMoviesCaptionStudio(tempMp4, request.outputFileName)
        tempMp4.delete()

        if (savedUri == null) {
            return@withContext ExportState.Failed("Failed to save MP4 to Movies/CaptionStudio/")
        }

        ExportState.Completed(
            outputUri = savedUri,
            displayPath = "Movies/CaptionStudio/\${request.outputFileName}",
            elapsedMs = System.currentTimeMillis() - startWallMs,
            encodedFrames = timestampsUs.size,
            textureUploads = textureUploads,
            audioMode = audioModeLabel
        )
    }

    private fun decodeScaledBackground(uri: Uri, targetW: Int, targetH: Int): Bitmap? {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        if (opts.outWidth <= 0 || opts.outHeight <= 0) return null

        var sample = 1
        while (opts.outWidth / (sample * 2) >= targetW && opts.outHeight / (sample * 2) >= targetH) {
            sample *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, decodeOpts)
        }
    }

    private fun saveToMoviesCaptionStudio(sourceFile: File, fileName: String): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, "\${Environment.DIRECTORY_MOVIES}/CaptionStudio")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        resolver.openOutputStream(uri)?.use { out ->
            sourceFile.inputStream().use { input -> input.copyTo(out) }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }
        return uri
    }
}
`,
  },
];
