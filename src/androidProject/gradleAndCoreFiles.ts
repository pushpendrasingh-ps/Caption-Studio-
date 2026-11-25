export interface AndroidProjectFile {
  path: string;
  name: string;
  category: 'Gradle & Manifest' | 'Models & SRT' | 'OpenGL ES 3.0 & EGL' | 'MediaCodec & Audio' | 'Jetpack Compose UI';
  language: 'kotlin' | 'xml' | 'toml' | 'markdown';
  summary: string;
  content: string;
}

export const GRADLE_AND_CORE_FILES: AndroidProjectFile[] = [
  {
    path: 'settings.gradle.kts',
    name: 'settings.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'Root Gradle settings and module declaration for CaptionStudio 1080p.',
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "CaptionStudio1080p"
include(":app")
`,
  },
  {
    path: 'build.gradle.kts',
    name: 'build.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'Top-level Gradle plugins configuration.',
    content: `plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
`,
  },
  {
    path: 'gradle/libs.versions.toml',
    name: 'libs.versions.toml',
    category: 'Gradle & Manifest',
    language: 'toml',
    summary: 'Version catalog targeting Android API 35, Kotlin 2.1, Jetpack Compose BOM, and Coroutines.',
    content: `[versions]
agp = "8.7.3"
kotlin = "2.1.0"
coreKtx = "1.15.0"
lifecycle = "2.8.7"
activityCompose = "1.9.3"
composeBom = "2024.12.01"
coroutines = "1.9.0"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
kotlinx-coroutines-android = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-android", version.ref = "coroutines" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
`,
  },
  {
    path: 'app/build.gradle.kts',
    name: 'app/build.gradle.kts',
    category: 'Gradle & Manifest',
    language: 'kotlin',
    summary: 'App module config (minSdk 26 for MediaMuxer + MediaStore, targetSdk 35, Compose enabled).',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.captionstudio"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.captionstudio"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.kotlinx.coroutines.android)
}
`,
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    name: 'AndroidManifest.xml',
    category: 'Gradle & Manifest',
    language: 'xml',
    summary: 'Declares OpenGL ES 3.0 hardware requirement and scoped MediaStore permissions.',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-feature
        android:glEsVersion="0x00030000"
        android:required="true" />

    <!-- Scoped storage write for Android 9 (API 28) and below; Android 10+ uses MediaStore directly -->
    <uses-permission
        android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="28" />

    <application
        android:allowBackup="true"
        android:label="CaptionStudio 1080p"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/model/ProjectModels.kt',
    name: 'ProjectModels.kt',
    category: 'Models & SRT',
    language: 'kotlin',
    summary: 'Immutable state models for 1080p aspect ratios, SRT cues, karaoke words, caption styling, and export progress.',
    content: `package com.captionstudio.model

import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri

enum class AspectRatio(
    val label: String,
    val width: Int,
    val height: Int
) {
    LANDSCAPE_16_9("16:9", 1920, 1080),
    PORTRAIT_9_16("9:16", 1080, 1920),
    SQUARE_1_1("1:1", 1080, 1080)
}

enum class BuiltInFont(val displayName: String, val typeface: Typeface) {
    SANS_BOLD("Sans Bold", Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)),
    CONDENSED("Condensed", Typeface.create("sans-serif-condensed", Typeface.BOLD)),
    SERIF_BOLD("Editorial Serif", Typeface.create(Typeface.SERIF, Typeface.BOLD)),
    MONOSPACE("Monospace", Typeface.create(Typeface.MONOSPACE, Typeface.BOLD))
}

data class SrtCue(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val text: String
)

data class KaraokeWord(
    val text: String,
    val lineIndex: Int,
    val wordIndex: Int,
    val startMs: Long,
    val endMs: Long
)

data class ActiveCaptionState(
    val cue: SrtCue?,
    val words: List<KaraokeWord>,
    val activeWordIndex: Int,
    val stateKey: String
)

data class CaptionStyle(
    val positionX: Float = 0.5f,          // Normalized [0.05 .. 0.95]
    val positionY: Float = 0.78f,         // Normalized [0.08 .. 0.92]
    val fontSizePx: Float = 58f,          // Reference at 1080p short-edge
    val maxWidthFraction: Float = 0.78f,  // [0.35 .. 0.95]
    val builtInFont: BuiltInFont = BuiltInFont.SANS_BOLD,
    val customFontUri: Uri? = null,
    val customFontName: String? = null,
    val textColor: Int = Color.WHITE,
    val highlightColor: Int = 0xFFF97316.toInt(),
    val boxColor: Int = 0xFF0A0B0E.toInt(),
    val boxOpacity: Float = 0.62f,
    val outlineThicknessPx: Float = 4f,
    val vignetteStrength: Float = 0.45f,
    val backgroundDim: Float = 0.22f,
    val slowZoomEnabled: Boolean = false,
    val wordKaraokeEnabled: Boolean = true,
    val uppercaseEnabled: Boolean = false,
    val fps: Int = 30
)

data class ExportRequest(
    val imageUri: Uri,
    val audioUri: Uri?,
    val cues: List<SrtCue>,
    val aspectRatio: AspectRatio,
    val style: CaptionStyle,
    val outputFileName: String
)

sealed interface ExportState {
    data object Idle : ExportState
    data class Exporting(
        val progress: Float,
        val stage: String,
        val renderedFrames: Int,
        val totalFrames: Int,
        val textureUploads: Int
    ) : ExportState
    data class Completed(
        val outputUri: Uri,
        val displayPath: String,
        val elapsedMs: Long,
        val encodedFrames: Int,
        val textureUploads: Int,
        val audioMode: String
    ) : ExportState
    data class Failed(val message: String) : ExportState
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/srt/SrtParser.kt',
    name: 'SrtParser.kt',
    category: 'Models & SRT',
    language: 'kotlin',
    summary: 'SRT parser, proportional karaoke word timing splitter, and Smart Event-Frame timestamp planner.',
    content: `package com.captionstudio.srt

import com.captionstudio.model.ActiveCaptionState
import com.captionstudio.model.KaraokeWord
import com.captionstudio.model.SrtCue
import java.util.TreeSet
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

object SrtParser {

    private val TIME_REGEX = Regex(
        """(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{1,3})\\s*-->\\s*(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{1,3})"""
    )

    fun parse(raw: String): List<SrtCue> {
        val cleaned = raw.removePrefix("\\uFEFF")
            .replace("\\r\\n", "\\n")
            .replace("\\r", "\\n")
            .trim()
        if (cleaned.isEmpty()) return emptyList()

        val cues = mutableListOf<SrtCue>()
        for (block in cleaned.split(Regex("\\n{2,}"))) {
            val lines = block.lines().map { it.trim() }.filter { it.isNotEmpty() }
            val timeIdx = lines.indexOfFirst { TIME_REGEX.containsMatchIn(it) }
            if (timeIdx == -1 || timeIdx + 1 >= lines.size) continue

            val match = TIME_REGEX.find(lines[timeIdx]) ?: continue
            val startMs = toMillis(match.groupValues[1], match.groupValues[2], match.groupValues[3], match.groupValues[4])
            val endMs = toMillis(match.groupValues[5], match.groupValues[6], match.groupValues[7], match.groupValues[8])
            if (endMs <= startMs) continue

            val text = lines.drop(timeIdx + 1)
                .joinToString("\\n")
                .replace(Regex("<[^>]+>"), "")
                .trim()
            if (text.isEmpty()) continue

            cues += SrtCue(index = cues.size + 1, startMs = startMs, endMs = endMs, text = text)
        }
        return cues.sortedBy { it.startMs }.mapIndexed { idx, cue -> cue.copy(index = idx + 1) }
    }

    fun distributeKaraokeWords(cue: SrtCue, uppercase: Boolean): List<KaraokeWord> {
        val text = if (uppercase) cue.text.uppercase() else cue.text
        data class RawToken(val word: String, val lineIndex: Int, val weight: Int)

        val rawTokens = mutableListOf<RawToken>()
        text.split("\\n").forEachIndexed { lineIdx, line ->
            line.trim().split(Regex("\\\\s+")).filter { it.isNotEmpty() }.forEach { word ->
                val cleanLen = word.count { it.isLetterOrDigit() }
                rawTokens += RawToken(word, lineIdx, max(2, cleanLen))
            }
        }
        if (rawTokens.isEmpty()) return emptyList()

        val totalWeight = rawTokens.sumOf { it.weight }.toDouble()
        val cueDuration = max(1L, cue.endMs - cue.startMs)
        var cursor = cue.startMs

        return rawTokens.mapIndexed { idx, token ->
            val isLast = idx == rawTokens.lastIndex
            val slice = if (isLast) {
                cue.endMs - cursor
            } else {
                ((token.weight / totalWeight) * cueDuration).roundToLong().coerceAtLeast(1L)
            }
            val start = cursor
            val end = if (isLast) cue.endMs else min(cue.endMs, cursor + slice)
            cursor = end
            KaraokeWord(token.word, token.lineIndex, idx, start, end)
        }
    }

    fun resolveCaptionAt(
        cues: List<SrtCue>,
        timeMs: Long,
        wordKaraoke: Boolean,
        uppercase: Boolean
    ): ActiveCaptionState {
        val cue = cues.firstOrNull { timeMs in it.startMs until it.endMs }
            ?: return ActiveCaptionState(null, emptyList(), -1, "EMPTY")

        val words = distributeKaraokeWords(cue, uppercase)
        val activeWordIdx = if (wordKaraoke && words.isNotEmpty()) {
            words.indexOfFirst { timeMs in it.startMs until it.endMs }
                .takeIf { it >= 0 } ?: words.lastIndex
        } else {
            -1
        }
        val key = if (wordKaraoke) {
            "\${cue.index}|W:\$activeWordIdx|\${if (uppercase) "U" else "N"}|\${cue.text}"
        } else {
            "\${cue.index}|FULL|\${if (uppercase) "U" else "N"}|\${cue.text}"
        }
        return ActiveCaptionState(cue, words, activeWordIdx, key)
    }

    /**
     * Generates the exact presentation timestamp (PTS in microseconds) list for the GL encoder:
     * - Slow Zoom OFF: Smart Event-Frame Timestamps (only caption/word changes + 2s keyframes)
     * - Slow Zoom ON: Continuous 24 or 30 fps frame cadence for smooth Ken Burns zoom
     */
    fun buildPresentationTimestampsUs(
        cues: List<SrtCue>,
        durationMs: Long,
        slowZoomEnabled: Boolean,
        wordKaraokeEnabled: Boolean,
        fps: Int
    ): List<Long> {
        val safeDurationMs = max(1_000L, durationMs)

        if (slowZoomEnabled) {
            val frameStepUs = 1_000_000L / fps.coerceIn(24, 30)
            val totalDurationUs = safeDurationMs * 1_000L
            val timestamps = ArrayList<Long>((totalDurationUs / frameStepUs).toInt() + 2)
            var ptsUs = 0L
            while (ptsUs < totalDurationUs) {
                timestamps += ptsUs
                ptsUs += frameStepUs
            }
            timestamps += totalDurationUs
            return timestamps
        }

        // Smart Event-Frame Timestamps: emit ONLY on caption/word transitions + 2s max keyframe gap
        val eventMs = TreeSet<Long>()
        eventMs += 0L
        eventMs += safeDurationMs

        for (cue in cues) {
            if (cue.startMs in 0L..safeDurationMs) eventMs += cue.startMs
            if (cue.endMs in 0L..safeDurationMs) eventMs += cue.endMs
            if (wordKaraokeEnabled) {
                val words = distributeKaraokeWords(cue, uppercase = false)
                for (i in 1 until words.size) {
                    val wStart = words[i].startMs
                    if (wStart in 1L until safeDurationMs) eventMs += wStart
                }
            }
        }

        val resultUs = mutableListOf<Long>()
        var lastMs = -1L
        for (ms in eventMs) {
            if (lastMs >= 0L) {
                var filler = lastMs + 2_000L
                while (filler < ms) {
                    resultUs += filler * 1_000L
                    filler += 2_000L
                }
            }
            resultUs += ms * 1_000L
            lastMs = ms
        }
        return resultUs
    }

    private fun toMillis(h: String, m: String, s: String, ms: String): Long {
        val paddedMs = ms.padEnd(3, '0').take(3).toLong()
        return h.toLong() * 3_600_000L + m.toLong() * 60_000L + s.toLong() * 1_000L + paddedMs
    }
}
`,
  },
  {
    path: 'README.md',
    name: 'README.md',
    category: 'Gradle & Manifest',
    language: 'markdown',
    summary: 'Build instructions and Zero-Copy OpenGL ES 3.0 architecture overview.',
    content: `# CaptionStudio 1080p (Native Android Kotlin + Jetpack Compose)

High-speed 1080p (\`1920x1080\`, \`1080x1920\`, \`1080x1080\`) caption video exporter built with a **Zero-Copy OpenGL ES 3.0 + EGLSurface + Hardware MediaCodec H.264** pipeline.

## Architecture Highlights

1. **Zero-Copy GPU Pipeline (\`EglCore.kt\` + \`CaptionGlRenderer.kt\` + \`ZeroCopyVideoExporter.kt\`)**
   - Binds \`MediaCodec.createEncoderByType("video/avc")\` (\`COLOR_FormatSurface\`) directly to an \`EGL14\` \`EGLSurface\` configured with \`EGL_RECORDABLE_ANDROID\`.
   - Uploads the background image **once** as \`GL_TEXTURE_2D\` (\`GL_TEXTURE0\`).
   - Runs **Dark Vignette / Dim** in the GLSL ES 3.00 fragment shader and **Slow Zoom (Ken Burns)** via vertex matrix scaling directly on GPU — zero per-frame CPU bitmap scaling.
   - Renders each unique caption/karaoke state **once** into a tight transparent \`Bitmap\`, uploads as \`GL_TEXTURE1\` only when the caption state key changes, and alpha-blends in the fragment shader.
   - **Smart Event-Frame Timestamps** (\`EGLExt.eglPresentationTimeANDROID\`) when Slow Zoom is OFF: encodes only on caption/word transitions + 2s keyframes.
   - **Continuous 24/30 fps Asynchronous Pipeline** when Slow Zoom is ON: dedicated GL render \`HandlerThread\` + dedicated encoder drain thread.

2. **Audio Track Pipeline (\`AudioTrackPipeline.kt\`)**
   - Direct zero-re-encode pass-through for \`.m4a\` / AAC tracks via \`MediaExtractor\` → \`MediaMuxer\`.
   - Automatic \`MediaCodec\` decoder → PCM → AAC-LC (128 kbps) hardware transcoding for \`.mp3\`, \`.wav\`, and \`.ogg\`.
   - Saves directly to \`Movies/CaptionStudio/\` via \`MediaStore.Video.Media\`.

3. **Opening in Android Studio**
   - Extract this ZIP archive.
   - Open the folder in Android Studio Ladybug (or newer) with JDK 17.
   - Sync Gradle and run on any Android 8.0+ (API 26+) device with OpenGL ES 3.0 support.
`,
  },
];
