import { useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import {
  ANDROID_PROJECT_CATEGORIES,
  ANDROID_PROJECT_FILES,
  type AndroidProjectFile,
} from '../androidProject';
import { buildZipArchive } from '../core/zipBuilder';

export function AndroidSourceViewer() {
  const [selectedPath, setSelectedPath] = useState<string>(
    'app/src/main/java/com/captionstudio/media/ZeroCopyVideoExporter.kt'
  );
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const selectedFile: AndroidProjectFile =
    ANDROID_PROJECT_FILES.find((f) => f.path === selectedPath) ?? ANDROID_PROJECT_FILES[0];

  const handleCopyFile = async () => {
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopiedPath(selectedFile.path);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Fallback for clipboard-restricted iframes
      const ta = document.createElement('textarea');
      ta.value = selectedFile.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedPath(selectedFile.path);
      setTimeout(() => setCopiedPath(null), 1800);
    }
  };

  const handleDownloadZip = () => {
    const zipBytes = buildZipArchive(
      ANDROID_PROJECT_FILES.map((file) => ({
        path: `CaptionStudio1080p/${file.path}`,
        content: file.content,
      }))
    );
    const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CaptionStudio1080p-Android.zip';
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  const lines = selectedFile.content.split('\n');

  return (
    <div className="flex flex-col gap-5">
      {/* Header Row with Primary Download Gradle Project CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div className="max-w-2xl">
          <h1 className="text-xl font-bold tracking-tight text-[#F4F5F7]">
            Native Android Kotlin + Jetpack Compose Project
          </h1>
          <p className="mt-1 text-sm text-[#9BA1AE]">
            Complete {ANDROID_PROJECT_FILES.length}-file Gradle project implementing Zero-Copy OpenGL
            ES 3.0, EGL14 + <code className="font-mono text-xs text-[#D1D5DB]">eglPresentationTimeANDROID</code>, Hardware H.264{' '}
            <code className="font-mono text-xs text-[#D1D5DB]">MediaCodec</code>, AAC pass-through &amp; PCM transcode, and MediaStore output to{' '}
            <code className="font-mono text-xs text-[#D1D5DB]">Movies/CaptionStudio/</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#F97316] px-4 text-sm font-semibold text-[#0C0D10] transition-colors hover:bg-[#FB923C] active:scale-[0.98] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]"
        >
          {downloaded ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>Downloaded .ZIP</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download Android Project (.zip)</span>
            </>
          )}
        </button>
      </div>

      {/* 2-Column Project Explorer */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* File Tree Sidebar */}
        <nav
          aria-label="Android project source files"
          className="flex flex-col gap-5 rounded-xl border border-white/[0.08] bg-[#14161B] p-4 lg:col-span-4 xl:col-span-3"
        >
          {ANDROID_PROJECT_CATEGORIES.map((category) => {
            const filesInCategory = ANDROID_PROJECT_FILES.filter(
              (f) => f.category === category
            );
            return (
              <div key={category}>
                <h2 className="px-2 text-xs font-semibold text-[#9BA1AE]">{category}</h2>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {filesInCategory.map((file) => {
                    const isSelected = file.path === selectedFile.path;
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedPath(file.path)}
                          className={`flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#F97316] ${
                            isSelected
                              ? 'bg-[#222631] text-[#F4F5F7]'
                              : 'text-[#9BA1AE] hover:bg-white/[0.04] hover:text-[#F4F5F7]'
                          }`}
                        >
                          <FileCode2
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isSelected ? 'text-[#F97316]' : 'text-[#6B7280]'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate font-mono">{file.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Source Code Viewer */}
        <section
          aria-label="Source code viewer"
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#14161B] lg:col-span-8 xl:col-span-9"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs font-semibold text-[#F4F5F7]">
                {selectedFile.path}
              </div>
              <p className="mt-0.5 text-xs text-[#9BA1AE]">{selectedFile.summary}</p>
            </div>

            <button
              type="button"
              onClick={handleCopyFile}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1C1F26] px-3 text-xs font-semibold text-[#F4F5F7] transition-colors hover:bg-[#262B35] whitespace-nowrap"
            >
              {copiedPath === selectedFile.path ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy File</span>
                </>
              )}
            </button>
          </div>

          <div className="max-h-[680px] overflow-auto bg-[#0A0B0E] p-4 font-mono text-xs leading-relaxed">
            <div className="flex min-w-max">
              <div
                aria-hidden="true"
                className="select-none pr-4 text-right text-[#525866] tabular-nums"
              >
                {lines.map((_, index) => (
                  <div key={index}>{index + 1}</div>
                ))}
              </div>
              <pre className="m-0 text-[#E2E8F0]">
                <code>{selectedFile.content}</code>
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
