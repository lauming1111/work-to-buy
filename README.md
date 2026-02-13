# Work Record Keeper
Track hours, calculate after-tax earnings, and manage weekly/monthly roster images with an offline-first UI.

## Features
- Monthly calendar with per-day start/end time tracking
- Automatic lunch deduction (per-day minutes input)
- Bi-weekly summaries and progress tracking
- Multi-job support with import/export
- Weekly/Monthly roster image upload + viewer
- Mobile-safe roster uploads (client-side resize/compress)
- Light/Dark mode and bilingual UI (EN / zh-tw)

## Getting Started
```sh
npm install
npm start
```

## Build
```sh
npm run build
```

## Test
```sh
npm test
```

## Deploy (GitHub Pages)
```sh
npm run deploy
```

## Data Storage
- Front-end only. All data stays in your browser `localStorage`.
- Export/import JSON from the UI

## Project Structure
- `src/App.tsx` main UI and logic
- `src/App.css` styles
- `public/` static assets

## Notes
- If you track `public/favicon.ico` with Git LFS, make sure Git LFS is installed on your machine.
