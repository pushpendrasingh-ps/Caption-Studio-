import { COMPOSE_UI_FILES } from './composeUiFiles';
import { GL_AND_MEDIA_FILES } from './glAndMediaFiles';
import { GRADLE_AND_CORE_FILES, type AndroidProjectFile } from './gradleAndCoreFiles';

export type { AndroidProjectFile };

export const ANDROID_PROJECT_FILES: AndroidProjectFile[] = [
  ...GL_AND_MEDIA_FILES,
  ...COMPOSE_UI_FILES,
  ...GRADLE_AND_CORE_FILES,
];

export const ANDROID_PROJECT_CATEGORIES: AndroidProjectFile['category'][] = [
  'OpenGL ES 3.0 & EGL',
  'MediaCodec & Audio',
  'Jetpack Compose UI',
  'Models & SRT',
  'Gradle & Manifest',
];
