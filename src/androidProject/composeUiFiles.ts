import type { AndroidProjectFile } from './gradleAndCoreFiles';

export const COMPOSE_UI_FILES: AndroidProjectFile[] = [
  {
    path: 'app/src/main/java/com/captionstudio/MainActivity.kt',
    name: 'MainActivity.kt',
    category: 'Jetpack Compose UI',
    language: 'kotlin',
    summary: 'Edge-to-edge ComponentActivity hosting CaptionStudioTheme and CaptionStudioScreen.',
    content: `package com.captionstudio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.captionstudio.ui.CaptionStudioScreen
import com.captionstudio.ui.theme.CaptionStudioTheme
import com.captionstudio.viewmodel.StudioViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CaptionStudioTheme {
                val vm: StudioViewModel = viewModel()
                CaptionStudioScreen(viewModel = vm)
            }
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/ui/theme/Theme.kt',
    name: 'Theme.kt',
    category: 'Jetpack Compose UI',
    language: 'kotlin',
    summary: 'Obsidian dark Material 3 studio color scheme with tactile warm amber primary accent.',
    content: `package com.captionstudio.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val StudioDarkColors = darkColorScheme(
    primary = Color(0xFFF97316),
    onPrimary = Color(0xFF0C0D10),
    background = Color(0xFF0C0D10),
    onBackground = Color(0xFFF4F5F7),
    surface = Color(0xFF14161B),
    onSurface = Color(0xFFF4F5F7),
    surfaceVariant = Color(0xFF1C1F26),
    onSurfaceVariant = Color(0xFF9BA1AE),
    outline = Color(0xFF2B303B)
)

@Composable
fun CaptionStudioTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = StudioDarkColors,
        content = content
    )
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/viewmodel/StudioViewModel.kt',
    name: 'StudioViewModel.kt',
    category: 'Jetpack Compose UI',
    language: 'kotlin',
    summary: 'StateFlow ViewModel managing Image/Audio/SRT/Font imports, D-pad & touch positioning, styling controls, and ZeroCopyVideoExporter coroutines.',
    content: `package com.captionstudio.viewmodel

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.captionstudio.media.ZeroCopyVideoExporter
import com.captionstudio.model.AspectRatio
import com.captionstudio.model.BuiltInFont
import com.captionstudio.model.CaptionStyle
import com.captionstudio.model.ExportRequest
import com.captionstudio.model.ExportState
import com.captionstudio.model.SrtCue
import com.captionstudio.srt.SrtParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StudioUiState(
    val imageUri: Uri? = null,
    val imageName: String? = null,
    val audioUri: Uri? = null,
    val audioName: String? = null,
    val srtName: String? = null,
    val cues: List<SrtCue> = emptyList(),
    val aspectRatio: AspectRatio = AspectRatio.LANDSCAPE_16_9,
    val style: CaptionStyle = CaptionStyle(),
    val previewTimeMs: Long = 1_500L,
    val exportState: ExportState = ExportState.Idle
)

class StudioViewModel(application: Application) : AndroidViewModel(application) {

    private val exporter = ZeroCopyVideoExporter(application.applicationContext)
    private val _uiState = MutableStateFlow(StudioUiState())
    val uiState: StateFlow<StudioUiState> = _uiState.asStateFlow()

    fun setImage(uri: Uri) {
        _uiState.update { it.copy(imageUri = uri, imageName = queryDisplayName(uri)) }
    }

    fun setAudio(uri: Uri) {
        _uiState.update { it.copy(audioUri = uri, audioName = queryDisplayName(uri)) }
    }

    fun importSrt(uri: Uri) {
        val raw = getApplication<Application>().contentResolver.openInputStream(uri)
            ?.bufferedReader()
            ?.use { it.readText() }
            .orEmpty()
        val parsed = SrtParser.parse(raw)
        _uiState.update {
            it.copy(
                srtName = queryDisplayName(uri),
                cues = parsed,
                previewTimeMs = parsed.firstOrNull()?.startMs?.plus(250L) ?: 0L
            )
        }
    }

    fun importCustomFont(uri: Uri) {
        val fontName = queryDisplayName(uri)
        updateStyle { copy(customFontUri = uri, customFontName = fontName) }
    }

    fun selectBuiltInFont(font: BuiltInFont) {
        updateStyle { copy(builtInFont = font, customFontUri = null, customFontName = null) }
    }

    fun setAspectRatio(ratio: AspectRatio) {
        _uiState.update { it.copy(aspectRatio = ratio) }
    }

    fun nudgePosition(dx: Float, dy: Float) {
        updateStyle {
            copy(
                positionX = (positionX + dx).coerceIn(0.05f, 0.95f),
                positionY = (positionY + dy).coerceIn(0.08f, 0.92f)
            )
        }
    }

    fun setPosition(x: Float, y: Float) {
        updateStyle {
            copy(
                positionX = x.coerceIn(0.05f, 0.95f),
                positionY = y.coerceIn(0.08f, 0.92f)
            )
        }
    }

    fun centerPosition() {
        updateStyle { copy(positionX = 0.5f, positionY = 0.5f) }
    }

    fun adjustFontSize(deltaPx: Float) {
        updateStyle { copy(fontSizePx = (fontSizePx + deltaPx).coerceIn(24f, 140f)) }
    }

    fun updateStyle(transform: CaptionStyle.() -> CaptionStyle) {
        _uiState.update { it.copy(style = it.style.transform()) }
    }

    fun setPreviewTimeMs(timeMs: Long) {
        _uiState.update { it.copy(previewTimeMs = timeMs.coerceAtLeast(0L)) }
    }

    fun dismissExportStatus() {
        _uiState.update { it.copy(exportState = ExportState.Idle) }
    }

    fun startExport() {
        val snapshot = _uiState.value
        val imageUri = snapshot.imageUri ?: run {
            _uiState.update { it.copy(exportState = ExportState.Failed("Select a background image first.")) }
            return
        }

        val timestamp = System.currentTimeMillis()
        val request = ExportRequest(
            imageUri = imageUri,
            audioUri = snapshot.audioUri,
            cues = snapshot.cues,
            aspectRatio = snapshot.aspectRatio,
            style = snapshot.style,
            outputFileName = "CaptionStudio_\${snapshot.aspectRatio.width}x\${snapshot.aspectRatio.height}_\$timestamp.mp4"
        )

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    exportState = ExportState.Exporting(
                        progress = 0.02f,
                        stage = "Initializing EGL14 & MediaCodec H.264",
                        renderedFrames = 0,
                        totalFrames = 1,
                        textureUploads = 0
                    )
                )
            }
            val result = exporter.export(request) { progressState ->
                _uiState.update { it.copy(exportState = progressState) }
            }
            _uiState.update { it.copy(exportState = result) }
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        val resolver = getApplication<Application>().contentResolver
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        return uri.lastPathSegment ?: "Selected file"
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/captionstudio/ui/CaptionStudioScreen.kt',
    name: 'CaptionStudioScreen.kt',
    category: 'Jetpack Compose UI',
    language: 'kotlin',
    summary: 'Complete Jetpack Compose mobile editor: 1. Image / 2. Audio / 3. SRT pickers, touch-drag preview, Arrow D-pad + Center + A-/A+, custom TTF/OTF font upload, colors, opacity, outline, vignette, Slow Zoom, Karaoke, UPPERCASE, and Export dialog.',
    content: `package com.captionstudio.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.captionstudio.gl.CaptionBitmapRenderer
import com.captionstudio.model.AspectRatio
import com.captionstudio.model.BuiltInFont
import com.captionstudio.model.ExportState
import com.captionstudio.srt.SrtParser
import com.captionstudio.viewmodel.StudioViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptionStudioScreen(viewModel: StudioViewModel) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Activity Result Launchers for 1. Image, 2. Audio, 3. SRT, and Custom .TTF/.OTF Font
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.setImage(it) }
    }
    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { viewModel.setAudio(it) }
    }
    val srtPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { viewModel.importSrt(it) }
    }
    val fontPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { viewModel.importCustomFont(it) }
    }

    val previewBgBitmap = remember(state.imageUri) {
        state.imageUri?.let { uri ->
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        }
    }

    val captionRenderer = remember { CaptionBitmapRenderer(context) }
    val activeCaption = remember(state.cues, state.previewTimeMs, state.style.wordKaraokeEnabled, state.style.uppercaseEnabled) {
        SrtParser.resolveCaptionAt(
            cues = state.cues,
            timeMs = state.previewTimeMs,
            wordKaraoke = state.style.wordKaraokeEnabled,
            uppercase = state.style.uppercaseEnabled
        )
    }
    val captionBitmap = remember(activeCaption.stateKey, state.style, state.aspectRatio) {
        captionRenderer.renderToBitmap(
            state = activeCaption,
            style = state.style,
            videoWidth = state.aspectRatio.width,
            videoHeight = state.aspectRatio.height
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("CaptionStudio 1080p", fontWeight = FontWeight.Bold) },
                actions = {
                    Button(
                        onClick = { viewModel.startExport() },
                        enabled = state.imageUri != null && state.exportState !is ExportState.Exporting,
                        modifier = Modifier.padding(end = 12.dp)
                    ) {
                        Text("Export MP4")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Aspect Ratio Switcher: 16:9 / 9:16 / 1:1
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                AspectRatio.entries.forEach { ratio ->
                    val selected = state.aspectRatio == ratio
                    FilterChip(
                        selected = selected,
                        onClick = { viewModel.setAspectRatio(ratio) },
                        label = { Text("\${ratio.label} (\${ratio.width}×\${ratio.height})", maxLines = 1) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Interactive Preview Viewport with Touch-Drag Caption Positioning
            var previewBoxSize by remember { mutableStateOf(IntSize(1, 1)) }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(260.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF090A0D))
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center
            ) {
                val targetRatio = state.aspectRatio.width.toFloat() / state.aspectRatio.height.toFloat()
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .aspectRatio(targetRatio, matchHeightConstraintsFirst = true)
                        .onSizeChanged { previewBoxSize = it }
                        .pointerInput(Unit) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                val dx = dragAmount.x / previewBoxSize.width.coerceAtLeast(1)
                                val dy = dragAmount.y / previewBoxSize.height.coerceAtLeast(1)
                                viewModel.nudgePosition(dx, dy)
                            }
                        }
                ) {
                    if (previewBgBitmap != null) {
                        Image(
                            bitmap = previewBgBitmap.asImageBitmap(),
                            contentDescription = "Background preview",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("1. Upload Background Image", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    // Live Vignette + Dim approximation in Compose preview
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color.Black.copy(alpha = state.style.backgroundDim.coerceIn(0f, 0.8f)))
                            .background(
                                Brush.radialGradient(
                                    colors = listOf(
                                        Color.Transparent,
                                        Color.Black.copy(alpha = state.style.vignetteStrength * 0.85f)
                                    )
                                )
                            )
                    )

                    // Touch-draggable rendered caption Bitmap preview
                    captionBitmap?.let { bmp ->
                        val normW = bmp.width.toFloat() / state.aspectRatio.width.toFloat()
                        val normH = bmp.height.toFloat() / state.aspectRatio.height.toFloat()
                        val leftFrac = (state.style.positionX - normW * 0.5f).coerceIn(0f, 1f - normW)
                        val topFrac = (state.style.positionY - normH * 0.5f).coerceIn(0f, 1f - normH)
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "Caption overlay preview",
                            modifier = Modifier
                                .fillMaxWidth(normW)
                                .fillMaxHeight(normH)
                                .offset(
                                    x = (previewBoxSize.width * leftFrac / context.resources.displayMetrics.density).dp,
                                    y = (previewBoxSize.height * topFrac / context.resources.displayMetrics.density).dp
                                )
                        )
                    }
                }
            }

            // 1. Image / 2. Audio / 3. SRT Upload Buttons
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(
                    onClick = { imagePicker.launch("image/*") },
                    modifier = Modifier.weight(1f)
                ) {
                    Text(state.imageName ?: "1. Image", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                OutlinedButton(
                    onClick = { audioPicker.launch(arrayOf("audio/*")) },
                    modifier = Modifier.weight(1f)
                ) {
                    Text(state.audioName ?: "2. Audio", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                OutlinedButton(
                    onClick = { srtPicker.launch(arrayOf("*/*")) },
                    modifier = Modifier.weight(1f)
                ) {
                    Text(state.srtName ?: "3. SRT", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }

            // Arrow D-Pad (◀ ▲ ▼ ▶, Center) + A- / A+ Size Controls
            SectionCard("Position & Size") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilledTonalButton(onClick = { viewModel.nudgePosition(0f, -0.02f) }) { Text("▲") }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilledTonalButton(onClick = { viewModel.nudgePosition(-0.02f, 0f) }) { Text("◀") }
                            Button(onClick = { viewModel.centerPosition() }) { Text("Center") }
                            FilledTonalButton(onClick = { viewModel.nudgePosition(0.02f, 0f) }) { Text("▶") }
                        }
                        FilledTonalButton(onClick = { viewModel.nudgePosition(0f, 0.02f) }) { Text("▼") }
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("\${state.style.fontSizePx.toInt()} px", fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { viewModel.adjustFontSize(-4f) }) { Text("A-") }
                            OutlinedButton(onClick = { viewModel.adjustFontSize(4f) }) { Text("A+") }
                        }
                    }
                }

                LabeledSlider(
                    label = "Max Text Width",
                    valueText = "\${(state.style.maxWidthFraction * 100).toInt()}%",
                    value = state.style.maxWidthFraction,
                    range = 0.35f..0.95f,
                    onValueChange = { viewModel.updateStyle { copy(maxWidthFraction = it) } }
                )
            }

            // Built-in + Custom .TTF / .OTF Font Upload
            SectionCard("Fonts & Text Transforms") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    BuiltInFont.entries.forEach { font ->
                        val isSelected = state.style.customFontUri == null && state.style.builtInFont == font
                        FilterChip(
                            selected = isSelected,
                            onClick = { viewModel.selectBuiltInFont(font) },
                            label = { Text(font.displayName, fontSize = 12.sp, maxLines = 1) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
                OutlinedButton(
                    onClick = { fontPicker.launch(arrayOf("font/ttf", "font/otf", "application/octet-stream", "*/*")) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(state.style.customFontName?.let { "Custom Font: \$it" } ?: "Upload Custom .TTF / .OTF Font")
                }

                ToggleRow("Word Karaoke Highlight", state.style.wordKaraokeEnabled) {
                    viewModel.updateStyle { copy(wordKaraokeEnabled = it) }
                }
                ToggleRow("UPPERCASE Captions", state.style.uppercaseEnabled) {
                    viewModel.updateStyle { copy(uppercaseEnabled = it) }
                }
            }

            // Colors, Box Opacity & Outline Thickness
            SectionCard("Colors, Box & Outline") {
                ColorSwatchRow(
                    label = "Text Color",
                    swatches = listOf(0xFFFFFFFF.toInt(), 0xFFFDE047.toInt(), 0xFF38BDF8.toInt(), 0xFFF43F5E.toInt()),
                    selected = state.style.textColor,
                    onSelect = { c -> viewModel.updateStyle { copy(textColor = c) } }
                )
                ColorSwatchRow(
                    label = "Highlight Color",
                    swatches = listOf(0xFFF97316.toInt(), 0xFFFACC15.toInt(), 0xFF22C55E.toInt(), 0xFF38BDF8.toInt()),
                    selected = state.style.highlightColor,
                    onSelect = { c -> viewModel.updateStyle { copy(highlightColor = c) } }
                )
                ColorSwatchRow(
                    label = "Box Color",
                    swatches = listOf(0xFF0A0B0E.toInt(), 0xFF1E293B.toInt(), 0xFF7C2D12.toInt(), 0xFFFFFFFF.toInt()),
                    selected = state.style.boxColor,
                    onSelect = { c -> viewModel.updateStyle { copy(boxColor = c) } }
                )

                LabeledSlider(
                    label = "Box Opacity",
                    valueText = "\${(state.style.boxOpacity * 100).toInt()}%",
                    value = state.style.boxOpacity,
                    range = 0f..1f,
                    onValueChange = { viewModel.updateStyle { copy(boxOpacity = it) } }
                )
                LabeledSlider(
                    label = "Outline Thickness",
                    valueText = "\${state.style.outlineThicknessPx.toInt()} px",
                    value = state.style.outlineThicknessPx,
                    range = 0f..12f,
                    onValueChange = { viewModel.updateStyle { copy(outlineThicknessPx = it) } }
                )
            }

            // GPU Shaders & Frame Mode
            SectionCard("OpenGL ES 3.0 Effects") {
                LabeledSlider(
                    label = "Dark Vignette",
                    valueText = "\${(state.style.vignetteStrength * 100).toInt()}%",
                    value = state.style.vignetteStrength,
                    range = 0f..1f,
                    onValueChange = { viewModel.updateStyle { copy(vignetteStrength = it) } }
                )
                LabeledSlider(
                    label = "Background Dim",
                    valueText = "\${(state.style.backgroundDim * 100).toInt()}%",
                    value = state.style.backgroundDim,
                    range = 0f..0.8f,
                    onValueChange = { viewModel.updateStyle { copy(backgroundDim = it) } }
                )
                ToggleRow("Slow Zoom (Ken Burns GPU)", state.style.slowZoomEnabled) {
                    viewModel.updateStyle { copy(slowZoomEnabled = it) }
                }
                Text(
                    text = if (state.style.slowZoomEnabled) {
                        "Continuous \${state.style.fps} fps async GL + MediaCodec pipeline"
                    } else {
                        "Smart Event-Frame Timestamps via eglPresentationTimeANDROID"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    // Export Progress / Result Modal
    when (val export = state.exportState) {
        is ExportState.Exporting -> {
            AlertDialog(
                onDismissRequest = {},
                title = { Text("Exporting 1080p MP4") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LinearProgressIndicator(progress = { export.progress }, modifier = Modifier.fillMaxWidth())
                        Text(export.stage)
                        Text("Frames: \${export.renderedFrames} / \${export.totalFrames} · Texture uploads: \${export.textureUploads}")
                    }
                },
                confirmButton = {}
            )
        }
        is ExportState.Completed -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismissExportStatus() },
                title = { Text("Saved to Movies/CaptionStudio") },
                text = {
                    Text(
                        "\${export.displayPath}\\n" +
                            "Time: \${export.elapsedMs} ms · Frames: \${export.encodedFrames} · " +
                            "Caption uploads: \${export.textureUploads}\\nAudio: \${export.audioMode}"
                    )
                },
                confirmButton = {
                    Button(onClick = { viewModel.dismissExportStatus() }) { Text("Done") }
                }
            )
        }
        is ExportState.Failed -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismissExportStatus() },
                title = { Text("Export Error") },
                text = { Text(export.message) },
                confirmButton = {
                    Button(onClick = { viewModel.dismissExportStatus() }) { Text("OK") }
                }
            )
        }
        ExportState.Idle -> Unit
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        content()
    }
}

@Composable
private fun LabeledSlider(
    label: String,
    valueText: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit
) {
    Column {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(valueText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Slider(value = value, onValueChange = onValueChange, valueRange = range)
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ColorSwatchRow(
    label: String,
    swatches: List<Int>,
    selected: Int,
    onSelect: (Int) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            swatches.forEach { argb ->
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(Color(argb))
                        .border(
                            width = if (selected == argb) 2.5.dp else 1.dp,
                            color = if (selected == argb) MaterialTheme.colorScheme.primary else Color.Gray,
                            shape = CircleShape
                        )
                        .clickable { onSelect(argb) }
                )
            }
        }
    }
}
`,
  },
];
