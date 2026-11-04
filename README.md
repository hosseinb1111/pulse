# Pulse

> A little more feeling. A little less noise.

[![Repository](https://img.shields.io/badge/GitHub-hosseinb1111%2Fpulse-181717?logo=github)](https://github.com/hosseinb1111/pulse)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Android%20%7C%20Web-8a8a8a)

Pulse is a cross-platform local music player built with Tauri 2, vanilla TypeScript, Vite, the Web Audio API, and Canvas 2D. The Windows and Android apps use the same frontend code. There is no frontend framework or external UI library.

## Features

- Native multi-file picker on desktop and Android; browser file input fallback when running Vite outside Tauri.
- MP3, WAV, FLAC, OGG, M4A, and AAC file filtering, with graceful errors for unreadable or unsupported audio.
- Play, pause, next, previous, scrubbing, volume, shuffle, and repeat-off/all/one.
- Filename-derived track labels, per-track duration probes, active-track highlighting, and a slide-in playlist.
- Web Audio `AnalyserNode` (`fftSize = 2048`) driving a full-screen Canvas 2D visualizer. Audio analysis uses 64 log-spaced bands (30 Hz–16 kHz), automatic gain so quiet tracks still move, and spectral-flux beat/transient detection. Seven scenes: Bloom, Spectrum, Waveform, Particles, Rings, Aurora and Still.
- Live microphone input through `getUserMedia`, with permission-specific recovery guidance and a retry action. Microphone capture feeds a dedicated input-only analyser, never the speaker output.
- A redesigned Spectrum scene with rounded, theme-coloured bars around all four edges, smooth interpolation, a travelling energy contour, and a hard limit of 180 active bars. Energy blending and bar density are adjustable in Settings.
- A master intensity control, bass-reactive ECG logo with layered glow, and a lightweight SVG favicon that follows live audio level.
- Local persistence for volume and the last track name/time position.
- Responsive layout, keyboard shortcuts on desktop, accessible button labels, and reduced-motion consideration.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server in the browser (browser file picker instead of the native one). |
| `npm run build` | Type-check with `tsc`, then build the frontend into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run tauri dev` | Run the native desktop app with hot reload. |
| `npm run tauri build` | Build the Windows MSI installer. |

## Project structure

```text
pulse/
├── index.html            App shell and markup
├── public/               Favicons served as-is
├── src/
│   ├── main.ts           Wiring: player, playlist, settings, shortcuts
│   ├── audio.ts          Playback and microphone engines (Web Audio)
│   ├── analysis.ts       Bands, auto-gain, beat and transient detection
│   ├── visualizer.ts     Canvas loop that feeds the selected scene
│   ├── scenes.ts         Bloom, Spectrum, Waveform, Particles, Rings, Aurora, Still
│   ├── themes.ts         Palettes, light/dark resolution, beat-reactive Pulse theme
│   ├── pointer.ts        Mouse, touch and Tab-focus input for the background
│   ├── pointer-layer.ts  Cursor glow, trail and ripples drawn over every scene
│   ├── cursor.ts         Custom cursor (dot, ring, halo)
│   ├── settings*.ts      Settings store and the settings drawer
│   ├── playlist.ts       Queue view
│   ├── storage.ts        Volume and last-track persistence
│   └── styles/           CSS split by area
└── src-tauri/            Rust shell, capabilities and app icons
```

## App icon and favicon

The logo lives in `public/favicon.svg` (browser favicon, plus `favicon.ico`, `favicon-32.png` and `apple-touch-icon.png` for fallbacks). `app-icon.png` is the 1024×1024 source for the native app icons in `src-tauri/icons/`. To regenerate them after changing the logo:

```sh
npm run tauri icon app-icon.png
```

## Prerequisites

### All platforms

- Node.js LTS and npm.
- Rust stable installed through `rustup`. The current Tauri 2 dialog and filesystem plugins require Rust 1.90 or newer.

### Windows desktop

- Windows 10 or later with Microsoft Edge WebView2 Runtime (already included on most current Windows installs).
- Visual Studio Build Tools 2022 with **Desktop development with C++** selected, including the MSVC toolchain and Windows SDK.
- For an MSI installer, the Windows **VBScript** optional feature must be enabled. If WiX fails with an error such as `failed to run light.exe`, enable it through **Settings → Apps → Optional features → More Windows features**.

### Android

- Android Studio.
- A JDK supported by the installed Android Gradle Plugin; the JBR bundled with Android Studio is the easiest choice. Set `JAVA_HOME` to the Android Studio `jbr` directory.
- Android SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, NDK (Side by side), and CMake installed from Android Studio's SDK Manager.
- Set `ANDROID_HOME` to the SDK directory and `NDK_HOME` to the installed NDK directory. Restart your terminal after setting environment variables.
- Add Tauri's Android Rust targets:

  ```sh
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

## Install and run

Clone the repository and install the dependencies:

```sh
git clone https://github.com/hosseinb1111/pulse.git
cd pulse
npm install
npm run tauri dev
```

The first Rust build can take a few minutes. On Windows this launches the native desktop window; the Vite server is started automatically by Tauri.

To run the frontend in a browser for quick UI checks (native file picking is replaced with a standard browser file picker):

```sh
npm run dev
```

## Android development

Initialize the Android wrapper once per checkout:

```sh
npm run tauri android init
```

Then connect a device with USB debugging enabled or start an emulator in Android Studio:

```sh
npm run tauri android dev
```

Android's system document picker is used for selected audio files. The app does not request broad Android storage permission just to show the picker; the selected URI is read through the Tauri filesystem plugin.

## Production builds

### Windows MSI

Run this on Windows in a Developer PowerShell or terminal with the prerequisites installed:

```sh
npm run tauri build
```

The configured bundler target is MSI. The installer is normally written to:

```text
src-tauri/target/release/bundle/msi/
```

Depending on the CLI version and Cargo target layout, the bundle can instead be under the corresponding target-specific `release/bundle/msi/` folder. Windows MSI packaging is host-platform-specific; use Windows for the supported, straightforward MSI workflow.

### Android APK

Initialize Android once, then create a release APK:

```sh
npm run tauri android init
npm run tauri android build -- --apk
```

The universal release APK is normally located at:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

If the CLI/Gradle version emits an architecture-specific APK, look under `src-tauri/gen/android/app/build/outputs/apk/` for the matching ABI directory.

#### Debug APK versus release APK signing

- `npm run tauri android dev` installs/runs a development build. Gradle commonly uses a debug signing key for debug APKs; that key is intended for development, not public release.
- A release APK suitable for distribution must be signed with a private release keystore. Do not commit the keystore, passwords, or alias credentials to source control.
- Tauri generates the Android Gradle project during `tauri android init`. Set these environment variables in the shell used to build the app; the keystore path must be absolute:

  ```text
  PULSE_RELEASE_KEYSTORE=<absolute path to the private .jks file>
  PULSE_RELEASE_STORE_PASSWORD=<keystore password>
  PULSE_RELEASE_KEY_ALIAS=<key alias>
  PULSE_RELEASE_KEY_PASSWORD=<key password>
  ```

  Then, inside the existing `android { ... }` block in `src-tauri/gen/android/app/build.gradle.kts`, add the signing config below. Put the `val` declarations above `android { ... }`. Merge the `getByName("release")` setting into the existing `buildTypes` block rather than creating a second one:

  ```kotlin
  val pulseStoreFile = System.getenv("PULSE_RELEASE_KEYSTORE")
  val pulseStorePassword = System.getenv("PULSE_RELEASE_STORE_PASSWORD")
  val pulseKeyAlias = System.getenv("PULSE_RELEASE_KEY_ALIAS")
  val pulseKeyPassword = System.getenv("PULSE_RELEASE_KEY_PASSWORD")
  val pulseSigningAvailable = listOf(
      pulseStoreFile, pulseStorePassword, pulseKeyAlias, pulseKeyPassword
  ).all { !it.isNullOrBlank() }

  android {
      // Keep the rest of Tauri's generated Android configuration.
      signingConfigs {
          if (pulseSigningAvailable) {
              create("pulseRelease") {
                  storeFile = file(requireNotNull(pulseStoreFile))
                  storePassword = requireNotNull(pulseStorePassword)
                  keyAlias = requireNotNull(pulseKeyAlias)
                  keyPassword = requireNotNull(pulseKeyPassword)
              }
          }
      }
      buildTypes {
          getByName("release") {
              if (pulseSigningAvailable) {
                  signingConfig = signingConfigs.getByName("pulseRelease")
              }
          }
      }
  }
  ```

  In PowerShell, set the variables for the current build session with `$env:PULSE_RELEASE_KEYSTORE`, `$env:PULSE_RELEASE_STORE_PASSWORD`, `$env:PULSE_RELEASE_KEY_ALIAS`, and `$env:PULSE_RELEASE_KEY_PASSWORD`. Keep passwords out of committed `.env` files and shell history. Without these variables, a release build may be unsigned. After configuring signing, run `npm run tauri android build -- --apk` and verify the APK with Android's `apksigner verify --verbose --print-certs <apk-path>`.
- To create a local keystore, the JDK's `keytool` is available. For example:

  ```sh
  keytool -genkeypair -v -keystore pulse-release.jks -alias pulse -keyalg RSA -keysize 2048 -validity 10000
  ```

  Store `pulse-release.jks` and the credentials securely, outside the project directory. A release signature cannot be safely pre-created in this source bundle because signing credentials belong to the app owner.

For Google Play, an Android App Bundle is generally preferred:

```sh
npm run tauri android build -- --aab
```

## Usage

1. Click **Add music** and choose one or more audio files.
2. Choose a track in the **Queue** panel, or press Play to start the current track. Alternatively, select the microphone button in the top bar to listen live; allow microphone access in the browser prompt. If access is blocked, use the inline **Try again** action after updating the site permission.
3. Scrub the timeline, adjust volume, enable Shuffle, or cycle Repeat through off, all, and one.
4. In Settings, adjust **Master intensity** for the overall response. When using the Spectrum scene, tune **Energy wave blend** and **Bar density** independently.
5. On desktop, press **Space** to toggle playback and **Left/Right Arrow** to seek by five seconds. Shortcuts are ignored while a form control is focused.

## Implementation notes

- The media element is connected once to its playback analyser and audio destination. Microphone capture uses a separate analyser that is not connected to the destination, preventing mic-to-speaker feedback. Replacing a track revokes the previous object URL.
- The visualizer uses frequency-band averages over bins 0–5% (bass), 5–30% (mid), and 30–60% (treble). Bass is smoothed with a 0.15 lerp factor. The gradient radius and particle sizes both react to the smoothed pulse; hue movement follows treble energy. With no active signal the visuals return to a slow idle drift.
- Canvas backing resolution is scaled by device pixel ratio (capped at 1.5 to keep full-screen drawing within a practical GPU budget).
- The custom pointer is driven only by real mouse/pen pointer events. Keyboard focus never repositions it; viewport scroll/resize reapplies cached viewport coordinates, and coarse/touch input hides it.
- Audio data and playlists are not uploaded. The queue is intentionally session-local because persistently storing native file paths/Android content URIs is unreliable and can outlive a user's access grant. Volume and the last track's name/position are stored in `localStorage`; re-add that track in a later session for its saved position to be restored.
- The browser/WebView and operating system decide which codecs are supported. The player accepts all six requested extensions, but a given Android WebView or Windows WebView2 installation may not decode every FLAC/AAC variant. Unsupported and corrupt files generate user-facing errors rather than crashing the app.

## Known limitations

- This is a local-file player; streaming services, lyrics, metadata tagging, cover-art extraction, and background playback controls are not included.
- The audio files are read into memory to create browser object URLs. Very large lossless files or a large batch of high-resolution tracks can use substantial memory, especially on lower-end phones.
- Some Android cloud/document providers expose opaque `content://` URIs without the original filename. Pulse sniffs common audio signatures and uses a generated track name when the provider does not reveal the filename.
- Android release signing needs a user-owned keystore and configured Gradle signing settings. The source does not embed release credentials.
- The Windows MSI and Android APK must be built and smoke-tested on machines with their respective native toolchains. A successful TypeScript/Vite build alone does not prove that native packaging or every OS codec is available.

## Project structure

```text
pulse/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
├── src/
│   ├── main.ts
│   ├── audio.ts
│   ├── visualizer.ts
│   ├── playlist.ts
│   ├── storage.ts
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        └── lib.rs
```

## Themes and interactive background

- Eight themes, each with a dark and a light variant: Aurora, Ember, Forest, Ocean, Sunset, Sakura, Pulse and Mono. Forest, Ocean and Sunset also tint the app surfaces. Every text and accent pair is at least 4.5:1 against its background.
- **Pulse** is beat-reactive: each kick pushes the accent hue forward, the UI accents follow it, and a full-screen glow flashes on the beat. Scenes pick up the shifting hue too.
- The background reacts to the mouse in every scene: a glow under the cursor that swells with the music, a short trail, ripples on every click or Tab focus move, and extra ripples on each beat while the button is held. In Particles the field flees the pointer, is pulled in while the button is held, and scatters on clicks. Bloom leans toward the pointer.
- When the browser tab is hidden, drawing stops. On return the pointer state and ripples are cleared and timing restarts cleanly.

## Contributing

Issues and pull requests are welcome at [github.com/hosseinb1111/pulse](https://github.com/hosseinb1111/pulse). Before opening a pull request, run `npm run build` so the type-check passes. Line endings and indentation are set by `.gitattributes` and `.editorconfig`.

## Credits

Created with ❤️ & ☕ by Hossein Seyed Bagheri.
