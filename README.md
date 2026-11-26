# الصراط المستقيم

An Arabic-first Islamic companion web app built with React, TypeScript, and Vite. It includes the Quran, authentic Hadith, prayer times, daily worship tools, and offline support. No Flutter or Android SDK is needed.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Internet access when downloading the source datasets

## Run locally

```powershell
npm install
npm run data:fetch
npm run dev
```

Open the local URL printed by Vite. The data download is only needed once; the app reads the Quran and hadith collections from `public/data`.

## Verify and build

```powershell
npm test
npm run build
npm run preview
```

## Deploy to GitHub Pages

The GitHub Actions workflow runs tests, builds the site with the repository's Pages path, and deploys `dist` when changes are pushed to `main` or `master`. In repository settings, choose **Pages → Build and deployment → GitHub Actions**. The workflow can also be started manually.

Project pages such as `owner.github.io/repository/` are supported. User or organization pages use the root path automatically. For a custom domain on a project repository, set the Actions variable `VITE_BASE_PATH` to `/`.

GitHub Pages hosts only the static app. Local notifications work while the app is open; background Push still requires a separately hosted Push server.

The test suite checks the Quran’s 114-surah / 6,236-ayah integrity and Tanzil attribution, and validates that both downloaded hadith collections contain numbered Arabic narrations.
It also tests prayer calculations, supported settings, and scheduled notification events.
It additionally checks Qibla bearings, Hijri date formatting, and daily reading progress persistence.

## Phase 1: Quran and authentic Hadith

- Complete Uthmani Quran text, searchable by surah or Arabic verse text.
- Mushaf-page reader with page numbers, gold ayah markers, surah navigation, adjustable text size, and a switch back to the flowing surah view.
- Persistent, screen-pinned Quran audio controls with six verified reciters. Tap an ayah to start there and continue through the rest of its surah, or play a whole page/surah. Reciter choice is saved on the device.
- Recitation is streamed from the Islamic Network CDN and is not included in the app download; internet access is required.
- Verse bookmarks, daily reading goals, and last-read position.
- Arabic narrations from Sahih al-Bukhari and Sahih Muslim, with search, book filtering, pagination, sharing, and saved narrations.
- Hadith search normalizes Arabic spelling/diacritics, requires all searched words, ranks phrase matches first, and accepts Arabic or Western digits for hadith numbers.
- Reading position and bookmarks stored in the browser.

## Phase 2: Prayer times and notifications

- Daily prayer times and the next-prayer countdown, with 20 selectable cities or device geolocation.
- Five calculation methods (Egyptian, Muslim World League, Umm al-Qura, Karachi, and ISNA) and standard or Hanafi Asr calculation.
- Prayer check-ins are available from each prayer time until the next prayer begins. Completing all five records a daily streak; the check-in history is kept in this browser until its site data is cleared.
- Per-prayer reminders, notification and sound controls, vibration where supported, and an optional custom audio file stored on the device (up to 20 MB).
- Prayer settings and custom audio are stored locally in the browser. The service worker supports the installable app shell and optional background Push.

### Notification behavior and limitations

- Grant this site notification permission in the browser to use local notifications. They are scheduled while the app is open; browsers may delay timers in background tabs, and local notifications do not run after the browser is closed.
- A custom audio file is optional. Without one, the sound test plays a short tone, not an Adhan. Browser and device autoplay restrictions can prevent audio from playing automatically.
- Background Push is **not configured by default**. It requires a reachable Push server, VAPID keys, HTTPS for a deployed site, and notification permission. The Push server stores subscription data and a schedule for up to 30 days; changing settings synchronizes that schedule.
- Prayer times are calculated estimates. GPS uses the device's current coordinates and configured time zone. High latitudes where the sun does not reach the required angle may not have a calculated time. Check an official local calendar for observance.

## Optional background Push setup

Do not commit either `.env` file or share the VAPID private key. The root `.env` supplies the Vite client with the server URL and **public** key; `server/.env` holds the private key and server settings. Both are excluded from Git.

1. Generate a VAPID key pair:

   ```powershell
   Set-Location server
   npm install
   npm run keys
   Set-Location ..
   ```

2. From the repository root, copy `server/.env.example` to `server/.env`. Set `VAPID_PUBLIC`, `VAPID_PRIVATE`, and `VAPID_SUBJECT` from the generated values, and set `ORIGIN` to the exact app origin (for example `https://app.example.com`, with no path or trailing slash). Keep `HOST` and `PORT` appropriate for your deployment.
3. Copy the repository-root `.env.example` to `.env`. Set `VITE_PUSH_SERVER` to the reachable Push server URL and `VITE_VAPID_PUBLIC_KEY` to the matching public key. Restart Vite after changing these values.
4. Install and start the Push server from the `server` directory:

   ```powershell
   Set-Location server
   npm run start
   ```

5. Serve the app over HTTPS in production, open **مواقيت الصلاة**, grant notification permission, and enable background notifications. Localhost is permitted by browsers for development.

The server accepts requests only from the configured `ORIGIN`, validates Push endpoints and event schedules, limits request size and rate, and writes subscription data to `server/subscriptions.json`. Use a protected persistent filesystem and HTTPS reverse proxy in production; the included server is an optional starting point, not a hosted Push service.

## Phase 3: Reading goals and tafsir

- Daily Quran reading goals, automatic progress for verses brought into view, and a saved last-reading position. Reading history has no automatic expiry and stays on this device until its site data is cleared.
- Hadith favorites and reference bookmarks are separate lists.
- Per-ayah Tafsir al-Muyassar is fetched on demand from AlQuran Cloud; tafsir text is not bundled or stored offline. Internet access and the external provider are required. Confirm the provider's current terms before public distribution.

## Phase 4: Qibla

- Qibla bearing is calculated from the prayer page's saved city or current device location.
- An optional device-orientation sensor rotates the compass when the browser supports it and permission is granted. Without a sensor, the display gives the bearing from geographic north; magnetic compasses may differ.

## Phase 5: Daily worship and Hijri date

- Morning/evening remembrance lists keep tasbih and istighfar visible, rotate three other Quranic and sourced remembrances daily, and save per-day counters locally.
- The Hijri date uses the browser's Umm al-Qura calendar implementation. Local moon-sighting announcements may differ.

## Phase 6: Installable app and offline reading

- The service worker precaches the app shell and Quran data. Bukhari and Muslim datasets are cached after their first successful online load, then can be read offline.
- The service worker is registered in production builds; test it with `npm run build` followed by `npm run preview` (not with the Vite development server).
- The offline notice explains when the device has no connection. Remote tafsir, online audio, first-time dataset downloads, geolocation, and Push delivery still need their respective network, permission, or service.
- Browser storage quotas and eviction are controlled by the browser; this is device-local offline support, not cloud backup or cross-device synchronization.

## Project notes

- [Data sources and attribution](./DATA_SOURCES.md)
- Automated checks: `npm test` and `npm run build`.
- Prayer calculations and notification scheduling: `src/lib/prayer.ts`, `src/lib/notify.ts`, and `tests/prayer.test.ts`.
- Reading progress and Qibla calculations: `src/lib/reading.ts` and `src/lib/qibla.ts`.
- Devotion tools: `src/pages/DevotionsPage.tsx`.
- Offline cache policy: `public/sw.js`.
- Optional Push server: `server/server.mjs`.
#   S i r a t - a l - M u s t a q i m  
 