# Petpho Gen

A full-stack AI image studio that turns pet photos into Pixar-style 3D portraits — generate, edit, inpaint, and composite pets into custom scenes, all backed by permanent cloud storage.

Built solo with Next.js (App Router), TypeScript, and React 19, orchestrating multiple image-generation models (Flux Kontext Pro, Google Nano Banana, GPT Image) through the Replicate API.

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
│       ├── generate/                Photo → Pixar-style render
│       ├── inpaint/                 Masked region regeneration
│       ├── compose/                 Pet + background → composite scene
│       ├── history/                 List past generations from Blob
│       ├── delete/                  Remove a generation
│       └── auth/                    Session cookie issuance
├── lib/
│   ├── models.ts                    Normalizes divergent model APIs into one interface
│   └── storage.ts                   Rehosts Replicate output to permanent Blob URLs
└── proxy.ts                         Middleware enforcing the auth gate
```

Each image provider (Replicate-hosted Flux, Nano Banana, GPT Image) expects different parameter shapes and aspect-ratio formats. `models.ts` abstracts these behind a single `ModelConfig`, so the API routes and UI stay provider-agnostic.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Replicate API · Vercel Blob

## Running locally

```bash
npm install
npm run dev
```

Requires `REPLICATE_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, and `ADMIN_PASSWORD` in `.env.local`.
