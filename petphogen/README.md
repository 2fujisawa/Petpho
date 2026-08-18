# Petpho Gen

A full-stack AI image studio that turns pet photos into Pixar-style 3D portraits — generate, edit, inpaint, and composite pets into custom scenes, all backed by permanent cloud storage.

Built with Next.js (App Router), TypeScript, and React 19, orchestrating multiple image-generation models (Flux Kontext Pro, Nano Banana Pro, GPT Image 2, Flux Fill Pro, Seedance) through the Replicate API.

## Features

- **Generate** — upload a pet photo, describe a style or scene, and get a Pixar-style render back, with a model picker across three providers.
- **Edit** — re-prompt any generated image to iterate on it without starting over.
- **Inpaint** — brush a mask over part of an image and describe what should replace it; a `<canvas>`-based tool exports the mask and sends it for targeted regeneration.
- **Scene compose** — drag-and-drop a generated pet onto a background (18 built-in scenes or your own upload) with adjustable position/scale, then blend it into a single photorealistic composite.
- **Persistent gallery** — every generation is rehosted to Vercel Blob storage, so history survives across devices and browser sessions instead of expiring with the model provider's temp URLs.
- **Password-gated access** with a cookie session, since this runs as a private admin tool rather than a public product.

## Architecture

```
src/
├── app/
│   ├── studio/page.tsx              Main UI (client-rendered, Tailwind)
│   ├── login/page.tsx               Password gate
│   └── api/
│       ├── generate/                Photo → styled render (1–4 outputs, optional background photo)
│       ├── inpaint/                 Brushed edit / outpaint to a new aspect ratio
│       ├── compose/                 Pet + background → composite scene
│       ├── remove-bg/               Grounded SAM cutout → transparent PNG
│       ├── upload-cutout/           Save a hand-refined cutout
│       ├── video/                   Start / poll a Seedance clip
│       ├── history/                 List past generations from Blob
│       ├── delete/                  Remove a generation
│       └── auth/                    Session cookie issuance
├── components/studio/               InpaintCanvas, CutoutRefiner, ImageCard, shared controls
├── hooks/                           usePersistedState, useDictation, useWheelBrushZoom
├── lib/
│   ├── models.ts                    One catalog of image models + per-role lists and resolvers
│   ├── styles.ts                    Art-style prompt recipes (Pixar, watercolor, oil)
│   ├── storage.ts                   Rehosts Replicate output to permanent Blob URLs
│   ├── replicateRun.ts              Retry on provider capacity errors, friendly error text
│   ├── cutout.ts                    Segmentation mask → clean alpha channel
│   ├── session.ts                   Hashed session cookie, timing-safe compare
│   ├── geometry.ts / browser.ts     Pure helpers (client + server) / browser-only helpers
│   └── api.ts                       Client wrappers for the app's own routes
├── types/studio.ts                  Gallery / editor / job types
└── proxy.ts                         Middleware enforcing the auth gate
```

Each image provider expects different parameter shapes and aspect-ratio formats. `models.ts` describes every model once in a single catalog and derives the generate / edit / compose lists from it, so the API routes and UI stay provider-agnostic — adding a model or a style is a one-entry change.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Replicate API · Vercel Blob

## Running locally

```bash
npm install
npm run dev
```

Requires `REPLICATE_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, and `ADMIN_PASSWORD` in `.env.local`. Optional: `DEV_ALLOWED_ORIGINS` (comma-separated LAN hosts allowed to reach the dev server, e.g. for phone testing).

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # production build
```
