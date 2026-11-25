import test from 'node:test';
import assert from 'node:assert/strict';
import { ANDROID_PROJECT_FILES } from '../androidProject';
import { buildZipArchive, crc32 } from './zipBuilder';

test('crc32 matches standard IEEE 802.3 test vector for "123456789"', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('buildZipArchive produces valid PKZIP headers and EOCD for full Android project', () => {
  const zip = buildZipArchive(
    ANDROID_PROJECT_FILES.map((f) => ({
      path: `CaptionStudio1080p/${f.path}`,
      content: f.content,
    }))
  );

  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Local File Header signature at byte 0: PK\x03\x04
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // End of Central Directory signature at tail - 22: PK\x05\x06
  const eocdOffset = zip.byteLength - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50);
  assert.equal(view.getUint16(eocdOffset + 8, true), ANDROID_PROJECT_FILES.length);
  assert.equal(view.getUint16(eocdOffset + 10, true), ANDROID_PROJECT_FILES.length);
});

test('native Android Kotlin project contains all required Zero-Copy GLES3, EGL, MediaCodec, Audio, and Compose features', () => {
  const combined = ANDROID_PROJECT_FILES.map((f) => f.content).join('\n');
  const requiredTokens = [
    'EGL14',
    'EGLExt.eglPresentationTimeANDROID',
    'COLOR_FormatSurface',
    'MediaFormat.MIMETYPE_VIDEO_AVC',
    '#version 300 es',
    'GL_TEXTURE_2D',
    'uVignetteStrength',
    'uKenBurnsMatrix',
    'MediaMuxer',
    'Movies/CaptionStudio',
    '128_000',
    'copyAacPassThrough',
    'transcodeToAacAndMux',
    'HandlerThread',
    'CaptionStudioScreen',
    'detectDragGestures',
    'Center',
    'A-',
    'A+',
  ];

  for (const token of requiredTokens) {
    assert.ok(combined.includes(token), `Missing required Android implementation token: ${token}`);
  }
});
