# Pulse

> A little more feeling. A little less noise.

**Pulse** is a local-first music player and interactive audio experience. It combines a Vite + vanilla TypeScript frontend, the Web Audio API, a Canvas 2D visualizer, and an interactive Three.js character. The same frontend is used by the browser build and the Tauri 2 desktop/mobile shells.

<p align="left">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5.9" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white"></a>
  <a href="https://vite.dev/"><img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white"></a>
  <a href="https://tauri.app/"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white"></a>
  <a href="https://github.com/hosseinb1111/pulse/actions/workflows/deploy-cloudflare-worker.yml"><img alt="Cloudflare Workers deployment status" src="https://img.shields.io/github/actions/workflow/status/hosseinb1111/pulse/deploy-cloudflare-worker.yml?branch=main&label=Cloudflare%20Workers&logo=cloudflare&logoColor=F38020"></a>
  <a href="LICENSE"><img alt="Apache 2.0 License" src="https://img.shields.io/badge/License-Apache--2.0-blue.svg"></a>
</p>

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Run locally](#run-locally)
- [Build and preview](#build-and-preview)
- [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers)
  - [How deployment works](#how-deployment-works)
  - [Wrangler configuration](#wrangler-configuration)
  - [GitHub Actions workflow](#github-actions-workflow)
  - [Cloudflare API token](#cloudflare-api-token)
  - [GitHub repository secrets](#github-repository-secrets)
  - [First deployment](#first-deployment)
  - [Custom domain](#custom-domain-optional)
- [Project structure](#project-structure)
- [Tauri desktop and Android builds](#tauri-desktop-and-android-builds)
- [Privacy and browser requirements](#privacy-and-browser-requirements)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

### Music player

- Add local audio files using the browser file picker or the native Tauri picker.
- Play, pause, skip, seek, shuffle, and repeat (off, all, or one).
- Adjust volume with the slider and read the current numeric percentage beside it.
- Keep volume and the last track name/position in local browser storage. The playlist itself is session-local; audio files are not uploaded to a server.
- Use keyboard shortcuts on desktop. Form controls retain their normal keyboard behavior.

### Audio-reactive visualizer

The Canvas 2D visualizer uses the same audio-analysis pipeline for playback and live microphone input. Its seven scenes are:

| Scene | Description |
| --- | --- |
| **Bloom** | A soft central orb that responds to bass, with satellites and expanding shockwaves. |
| **Frequency Grid** | A perspective field of rounded frequency columns with adjustable density and smoothing. |
| **Soft Halo** | A restrained, clean light form with a gentle response instead of dense waveform detail. |
| **Constellation** | A connected field of drifting points. |
| **Orbit Engine** | Concentric orbital forms with audio-reactive movement. |
| **Calm** | An intentionally empty visualizer background, with the ambient canvas effects suppressed. |
| **Moonlight** | A minimal, atmospheric visual scene. |

Settings include master visualizer intensity. Frequency Grid also exposes its own blend and density controls.

### Themes and interface

Eight themes are included, each with system, dark, and light mode support: **Aurora, Ember, Forest, Ocean, Sunset, Sakura, Pulse, and Mono**. Each theme has its own surface and accent palette. Pulse is beat-reactive and can shift its accents with the music.

The interface also includes responsive layouts, a custom pointer style selector, cursor glow/trails/ripples, reduced-motion handling, and local preference persistence.

### Interactive character

- A procedural full-body 3D character rendered with Three.js.
- Gaze follows pointer movement; drag to rotate the character.
- Natural blinking, breathing, idle glances, and subtle movement.
- Tap or click directly on the character to trigger a greeting wave. Press **Enter** while the character canvas is focused to trigger the same response.
- Music-reactive movement shares the visualizer's existing audio frame; it does not create a second audio analyser.
- Character movement presets: Auto, Ambient, Lo-fi, Funk, Pop, Rock, Classical, and Electronic. Auto estimates broad energy/rhythm behavior; it does not claim to identify a track's genre.

## Tech stack

- **Frontend:** vanilla TypeScript, HTML, CSS, Vite 7.
- **Audio:** Web Audio API, `AnalyserNode`, local `MediaElementAudioSourceNode`, and microphone capture via `getUserMedia`.
- **Visualizer:** Canvas 2D.
- **Character:** Three.js 0.160.0, loaded from jsDelivr.
- **Desktop/mobile shell:** Tauri 2 + Rust.
- **Web hosting:** Cloudflare Workers with Static Assets, deployed by Wrangler.
- **CI/CD:** GitHub Actions + Cloudflare Wrangler Action.

## Run locally

### Requirements

- Node.js 22 (the repository includes `.nvmrc`) and npm.
- For native Tauri builds: Rust stable via `rustup` and the platform-specific toolchains described in [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

### Install dependencies

Run commands from the repository root — the folder containing `package.json`:

```bash
npm ci
```

### Run the web version

```bash
npm run dev
```

Vite prints the local development URL (normally `http://localhost:5173`). The browser build uses a standard browser file picker rather than the native Tauri picker.

## Build and preview

Create the production web build:

```bash
npm run build
```

The build runs the strict TypeScript check first and then creates the static production site in `dist/`.

Preview that production output locally:

```bash
npm run preview
```

## Deploy to Cloudflare Workers

Pulse is deployed to **Cloudflare Workers using Static Assets**. It is not deployed to Cloudflare Pages. Vite creates the production files in `dist/`, and Wrangler uploads that directory as the Worker's static assets.

You do not need to create a Cloudflare Pages project, configure a Pages project name, or use the `wrangler pages deploy` command.

### How deployment works

The repository uses GitHub Actions and the official Cloudflare Wrangler Action:

| Event | Result |
| --- | --- |
| Push to `main` | Builds Pulse and deploys the production Worker. |
| Pull request targeting `main` | Runs the build and checks the output, but does not deploy. |
| Pull request from a fork | Runs the build without requiring Cloudflare secrets. |
| Manual `workflow_dispatch` | Builds and deploys the selected branch. |

The deployment job runs `npm ci`, `npm run build`, verifies `dist/index.html`, and then runs `wrangler deploy`.

### Wrangler configuration

Create `wrangler.jsonc` in the repository root, next to `package.json`:

```jsonc
{
  "name": "pulse",
  "compatibility_date": "2026-11-04",
  "workers_dev": true,
  "assets": {
    "directory": "./dist/",
    "not_found_handling": "single-page-application"
  }
}
```

What these settings do:

- `name` is the Cloudflare Worker name. Change it only if you want a different Worker name.
- `compatibility_date` pins the Worker runtime compatibility date. Update it deliberately when you want to adopt newer runtime behavior.
- `workers_dev: true` enables the Worker's `workers.dev` URL, provided the account has a workers.dev subdomain configured.
- `assets.directory` points Wrangler to Vite's build output.
- `not_found_handling: "single-page-application"` serves `index.html` for unmatched navigation requests, which is appropriate for a client-side single-page app.

The `public/` directory is copied into `dist/` by Vite. Workers Static Assets supports `_headers` and `_redirects` files when they are included in the static asset directory, so `public/_headers` can be used for static response headers.

See the Cloudflare documentation for [Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/) and [single-page application routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

### GitHub Actions workflow

Create `.github/workflows/deploy-cloudflare-worker.yml` with the following contents:

```yaml
name: Deploy Pulse to Cloudflare Workers

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pulse-worker-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build Pulse
        run: npm run build

      - name: Verify build output
        run: test -f dist/index.html

      - name: Deploy to Cloudflare Workers
        if: github.event_name != 'pull_request'
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

This workflow deliberately builds pull requests without deploying them. It avoids exposing Cloudflare credentials to forked pull requests and prevents an ordinary PR check from changing the production Worker.

Cloudflare's [GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) documents the required account ID, API token, and Wrangler deployment approach. The [Wrangler Action](https://github.com/cloudflare/wrangler-action) runs Wrangler from GitHub Actions.

### Cloudflare API token

GitHub Actions needs a Cloudflare API token and the Cloudflare account ID. Do not put either value in the source code or commit them to Git.

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Open **Manage Account → Account API Tokens** (the dashboard wording may vary) and create an account-owned API token.
3. Scope the token to the account that will own the `pulse` Worker.
4. Give the token the minimum Workers permissions required for your deployment.

For an **already-created Worker**, Cloudflare's current permission model uses **Workers → Editor** access. For a first deployment that must create the Worker named `pulse`, Cloudflare requires **Workers → Admin** at the Workers product scope because Editor cannot create new resources. You can create the Worker once in the dashboard first, then use Editor for subsequent deployments. If your token-creation screen uses the older permission labels, the corresponding legacy permission is **Workers Scripts: Edit** for updating existing Workers.

Do not use a Pages-only token such as **Cloudflare Pages: Edit**; it does not grant the Workers permissions needed by `wrangler deploy`. See Cloudflare's [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/) and [Workers-specific permissions](https://developers.cloudflare.com/workers/authorization/workers/).

### GitHub repository secrets

Open the repository on GitHub, then go to **Settings → Secrets and variables → Actions → Secrets**.

Create these two repository secrets:

| Secret name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The Cloudflare API token created above. |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID for the Cloudflare account that owns the Worker. |

There are **no Pages project variables** required for this workflow. In particular, remove any dependency on `CLOUDFLARE_PAGES_PROJECT_NAME` from the Worker workflow.

Never paste your API token into an issue, commit, workflow YAML file, README, or chat. If a token is accidentally exposed, revoke it in Cloudflare and create a replacement.

### First deployment

1. Confirm `wrangler.jsonc` and `.github/workflows/deploy-cloudflare-worker.yml` are committed to the repository.
2. Confirm the two GitHub repository secrets are set.
3. Push the project to the `main` branch.
4. Open the repository's **Actions** tab.
5. Select **Deploy Pulse to Cloudflare Workers** and open the latest run.
6. Confirm the install, build, output verification, and deployment steps all succeed.

With `workers_dev` enabled and the account's workers.dev subdomain configured, the site is normally available at:

```text
https://pulse.<your-workers-subdomain>.workers.dev
```

The exact subdomain is account-specific. Find the deployed Worker and its available URL in **Cloudflare Dashboard → Workers & Pages → pulse**. A Pages `pages.dev` URL is not created by this deployment.

### Deploy manually from your computer

After installing dependencies and building the app, authenticate Wrangler and deploy from the repository root:

```bash
npm ci
npm run build
npx wrangler login
npx wrangler deploy
```

`wrangler login` opens a browser-based Cloudflare authentication flow. In CI, use the GitHub secrets instead of interactive login.

### Custom domain (optional)

After the Worker is deployed, open it in the Cloudflare dashboard and add a custom domain under its **Settings → Domains & Routes** area. Follow the DNS instructions shown by Cloudflare. For a Worker custom domain, the domain must be active on Cloudflare; deploying the Worker does not automatically configure a custom domain.

If you later add or change a custom domain or route through Wrangler, the API token also needs the applicable **Workers Routes: Write** permission for the relevant zone. A normal deployment to an already-configured Worker does not need to recreate that route/domain connection.

## Project structure

```text
pulse/
├── .github/
│   └── workflows/
│       └── deploy-cloudflare-worker.yml  # GitHub Actions CI/CD
├── public/
│   ├── _headers                         # Optional Workers Static Assets headers
│   └── favicon.*
├── src/
│   ├── character/
│   │   ├── experience.ts                # Three.js character and interactions
│   │   └── music-behavior.ts             # Shared-audio character behavior
│   ├── styles/                          # UI styles split by feature
│   ├── analysis.ts                      # FFT bands and beat/transient detection
│   ├── audio.ts                         # Playback and microphone inputs
│   ├── main.ts                          # Application wiring
│   ├── pointer-layer.ts                 # Background pointer trails/ripples
│   ├── pointer.ts                       # Pointer input state
│   ├── playlist.ts                      # Session playlist
│   ├── scenes.ts                        # Seven visualizer scenes
│   ├── settings-panel.ts                # Settings UI
│   ├── settings.ts                      # Settings store and defaults
│   ├── storage.ts                       # Local persistence
│   ├── themes.ts                        # Theme palettes
│   └── visualizer.ts                    # Shared Canvas render loop
├── src-tauri/                           # Tauri Rust shell and native assets
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc                       # Cloudflare Workers configuration
├── .nvmrc
├── .gitignore
├── LICENSE                              # Apache License 2.0
└── README.md
```

## Tauri desktop and Android builds

The Cloudflare workflow deploys the **web frontend only**. It does not create a Windows installer or an Android package. Native builds need the relevant platform toolchains.

### Tauri desktop development

```bash
npm run tauri dev
```

### Windows MSI

On Windows, install the prerequisites listed in [Tauri's Windows setup guide](https://v2.tauri.app/start/prerequisites/#windows), then run:

```bash
npm run tauri build
```

The configured bundle target is MSI. The installer is normally written under:

```text
src-tauri/target/release/bundle/msi/
```

### Android development

Install Android Studio, the Android SDK/NDK, and a supported JDK. Set `ANDROID_HOME` and `NDK_HOME`, then add Tauri's Android Rust targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init
npm run tauri android dev
```

To build an APK or Android App Bundle after configuring the Android project:

```bash
npm run tauri android build -- --apk
# or
npm run tauri android build -- --aab
```

A release build intended for distribution should be signed with your own Android release keystore. Do not commit a keystore, its passwords, or signing credentials to GitHub. Keep those values in a secure local environment or CI secrets and follow the [Tauri Android signing guide](https://v2.tauri.app/distribute/sign/android/).

## Privacy and browser requirements

- Audio files are selected locally and analyzed in the browser. Pulse does not upload tracks or microphone audio to a Pulse backend.
- The playlist is session-local. Volume and the last track's name/position are stored in browser `localStorage`.
- Microphone input requires permission and a secure context. Cloudflare Workers serves over HTTPS, so the browser can request microphone access after the user enables **Listen live**.
- The browser must support the selected audio codec, Web Audio API, and WebGL for the full experience. Codec support varies between browsers and operating systems.
- The character loads Three.js 0.160.0 from jsDelivr, so the first character load requires network access. If WebGL or the CDN is unavailable, the player controls and artwork fallback remain usable.
- The deployed site is static. It has no server-side account system, database, track upload API, or streaming catalog.

## Troubleshooting

### The GitHub workflow cannot find `wrangler.jsonc`

Make sure `wrangler.jsonc` is in the repository root, alongside `package.json`, and that the file is committed to the branch being deployed.

### The build succeeds but Wrangler cannot find `dist/`

Run `npm ci` and `npm run build` from the directory containing `package.json`. Confirm that `dist/index.html` exists. The Worker serves `dist/`; it does not deploy the repository root.

### Wrangler reports an authentication or authorization error

Check that `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured as GitHub repository secrets and refer to the same Cloudflare account. Confirm that the token is active and has Workers permissions. A Pages-only token is not sufficient.

If the Worker does not exist yet, the first deployment needs product-level Workers Admin permission to create it. For an existing Worker, Workers Editor is sufficient for normal deployments. Never share the token in a log or support request.

### Wrangler says the Worker already exists or the name is wrong

The `name` in `wrangler.jsonc` is the Worker name. Check the Cloudflare account selected by `CLOUDFLARE_ACCOUNT_ID` and confirm that the intended Worker is named `pulse`. If you intentionally use another Worker name, update the config and the documentation consistently.

### The workflow deploys to Pages instead of Workers

Check that the workflow runs `wrangler deploy`, not `wrangler pages deploy`. The workflow file should be `deploy-cloudflare-worker.yml`, and the repository should contain `wrangler.jsonc`. The Pages project name variable is not used by this setup.

### The site returns 404 for nested routes

Check that `assets.directory` points to `./dist/` and that `assets.not_found_handling` is set to `single-page-application`. This setting makes unmatched navigation requests resolve to `index.html`.

### The Worker URL is unavailable

Check that `workers_dev` is set to `true` and that a workers.dev subdomain is configured for the Cloudflare account. The deployed URL is shown on the Worker's dashboard page. A `pages.dev` address does not belong to a Workers deployment.

### Microphone access is unavailable

Use the HTTPS `workers.dev` URL or configured custom domain, not an insecure HTTP address. Allow microphone permission in the browser's site settings, then reload the page and select **Listen live** again.

### The character does not appear

Check that WebGL is enabled and that the browser can access jsDelivr. The player remains usable without the 3D character, but the character requires its Three.js module and a WebGL-capable browser.

## Contributing

Before opening a pull request, run:

```bash
npm ci
npm run build
```

The GitHub workflow repeats these checks automatically. Pull requests are build-checked but do not deploy to the production Worker.

Keep generated `dist/`, `node_modules/`, Rust build output, local audio, private signing files, and all credentials out of source control. The repository's `.gitignore` should exclude generated and sensitive files.

## License

Pulse is licensed under the **Apache License, Version 2.0**. The complete license text is included in the [`LICENSE`](LICENSE) file. You may use, modify, and distribute the project under the terms stated there.

Copyright 2026 Hossein Seyed Bagheri.

Third-party libraries, tools, fonts, icons, and other assets remain subject to their own licenses and notices. The project license does not replace or override those third-party terms.

---

<p align="center">
  Created with ❤️ &amp; ☕ by <strong>Hossein Seyed Bagheri</strong>
</p>
