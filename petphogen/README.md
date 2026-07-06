# Petpho Gen — Pixar Pet Portrait Generator

An internal admin tool that takes a photo of a pet and uses AI to transform it into a Disney Pixar 3D animated style image. Built with Next.js, React, TypeScript, and Replicate AI.

---

## What it does

1. You upload a pet photo
2. You optionally type a prompt ("wearing a chef hat") and pick a background
3. It sends everything to an AI model via the Replicate API
4. The AI generates a Pixar-style image
5. The image gets saved permanently to Vercel Blob storage
6. It appears in your gallery and stays there

You can also edit any generated image with text prompts, or use the brush tool to paint over a specific area and describe what to put there (called **inpainting**).

---

## Project Structure

```
petphogen/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root HTML shell — sets page title, global styles
│   │   ├── page.tsx            # The entire frontend UI (React, ~1000 lines)
│   │   ├── globals.css         # Global CSS resets
│   │   └── api/
│   │       ├── generate/
│   │       │   └── route.ts    # POST /api/generate — first generation from photo
│   │       ├── edit/
│   │       │   └── route.ts    # POST /api/edit — text-prompt editing
│   │       └── inpaint/
│   │           └── route.ts    # POST /api/inpaint — brush mask editing
│   └── lib/
│       ├── models.ts           # AI model configs (names, params, providers)
│       ├── backgrounds.ts      # Background options (name, CSS gradient, description)
│       └── storage.ts          # Vercel Blob uploader (rehost Replicate URLs)
├── .env.local                  # Secret keys — never commit this to git
├── package.json
└── README.md
```

---

## Tech Stack

### TypeScript
Everything is `.ts` / `.tsx`. TypeScript adds types to JavaScript — the compiler checks that you never pass the wrong shape of data to a function. It gets stripped out at build time; the browser only ever sees plain JavaScript.

### Next.js (App Router)
A full-stack framework built on top of React. Two key things:

**1. File-based routing** — the folder structure is the URL structure:
- `src/app/page.tsx` → `localhost:3000/`
- `src/app/api/generate/route.ts` → `localhost:3000/api/generate`

**2. Server + client code in one project** — the `route.ts` files run on the Node.js server. The `page.tsx` file runs in the browser (declared by `"use client"` at the top). Same repo, different runtimes.

### React
The UI library. Key concepts used in this project:

| Hook | What it does | Where used |
|------|-------------|------------|
| `useState` | Declares reactive state — UI re-renders when it changes | `loading`, `history`, `editor`, `photo`, etc. |
| `useEffect` | Runs code after render (side effects) | Loading/saving localStorage, skipping initial save |
| `useRef` | Mutable value that doesn't trigger re-renders | File input DOM node, canvas handle, skip-flag |
| `forwardRef` + `useImperativeHandle` | Expose methods from a child component to the parent | `InpaintCanvas` exposes `getMaskDataUrl()` and `clear()` |

### Tailwind CSS
No separate CSS files — all styles are utility class names written directly in the JSX. Example: `className="rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100"`. Tailwind generates only the CSS you actually use at build time.

---

## How a Generation Works (Data Flow)

```
User uploads photo
       ↓
Browser compresses image (Canvas API, max 1024px, 85% quality JPEG)
       ↓
POST /api/generate  (multipart FormData with image + prompt + settings)
       ↓                     [server-side from here]
Upload photo to Replicate temporary file storage
       ↓
Call the selected AI model on Replicate's GPU servers
       ↓
Replicate returns a temporary image URL (expires in ~24 hours)
       ↓
storage.ts: download image → upload to Vercel Blob (permanent URL)
       ↓
Return permanent Blob URL as JSON response
       ↓                     [browser-side again]
React state update → image appears in gallery
       ↓
useEffect saves updated history array to localStorage
```

---

## AI Models

The app supports 6 different image generation models, all accessed through Replicate. Each has a different strength:

| Model | Provider | Best for |
|-------|----------|---------|
| Flux Kontext Pro | Black Forest Labs | Best identity preservation (keeps the dog recognizable) |
| Stable Diffusion 3.5 Large | Stability AI | Rich textures and detail |
| Ideogram v2 Turbo | Ideogram | Fast, strong Pixar illustration style |
| Nano Banana | Google (Gemini 2.5) | Following natural language instructions |
| Qwen Image Edit Plus | Alibaba | Object removal, perspective changes |
| Seedream 4 | ByteDance | Reimagining the pet in new scenes |

`models.ts` normalizes the differences between model APIs (some take `image` as a string, others expect an array, they use different parameter names). The `buildImageInput()` function handles this so the API routes don't need to know the specifics.

---

## Three Edit Modes

### 1. Generate (`/api/generate`)
Upload a new pet photo → AI transforms it into Pixar style. You can add a text prompt and pick a background. Uses `FormData` to send the image file.

### 2. Text Edit (`/api/edit`)
Pick any generated image from your gallery → describe what to change. The AI edits the image while keeping the same character. You can generate up to 4 variants at once.

### 3. Brush Inpaint (`/api/inpaint`)
Paint a mask over a specific area of an image, then describe what to put there. The AI fills only that region. Uses an HTML `<canvas>` element to track what you've painted.

The inpaint flow specifically:
- Two canvases are stacked: a **display canvas** (shows the orange brush overlay you see) and a **mask canvas** (hidden, pure black/white — white = "change this area")
- When you hit Apply, the mask is exported as a base64 PNG and sent to the server
- The server uploads both the source image and the mask to Replicate, which uses FLUX Fill Pro to regenerate only the masked region

---

## Storage Layers

| Layer | Stores | Lifetime |
|-------|--------|---------|
| `localStorage` (browser) | History array: URLs, prompts, model names | Until browser storage is cleared |
| Vercel Blob (cloud) | The actual image files | Permanent |
| Replicate CDN | Temporary output files | ~24 hours (free tier) |

The `rehost()` function in `storage.ts` runs on every generation: it downloads the Replicate output and re-uploads it to Vercel Blob before returning the URL to the frontend. This means even if Replicate deletes their copy, your image survives.

If `BLOB_READ_WRITE_TOKEN` is not set in `.env.local`, `rehost()` silently falls back to the Replicate URL — it won't break, it just won't persist past 24 hours.

---

## Environment Variables

Stored in `.env.local` — never commit this file to git.

| Variable | What it's for |
|----------|--------------|
| `REPLICATE_API_TOKEN` | Authenticates your Replicate API calls |
| `BLOB_READ_WRITE_TOKEN` | Authenticates your Vercel Blob uploads |

---

## Running Locally

```bash
npm install          # install dependencies
npm run dev          # start dev server at localhost:3000 (runs at lower CPU priority)
npm run local        # production build + start (zero overhead, no hot reload)
```

The `dev` script uses `nice -n 15` which tells the OS to give the process lower CPU priority, preventing it from making the rest of your machine laggy.

---

## Deployment

The app is designed to deploy to Vercel. Push to GitHub and connect the repo in Vercel's dashboard. Set the two environment variables in the Vercel project settings (not in `.env.local` — that's only for local development).

---

## Known Quirks

**History localStorage bug (already fixed):** Next.js renders components on the server before sending them to the browser (SSR). A naive `useState(() => JSON.parse(localStorage.getItem(...)))` would crash on the server because `localStorage` doesn't exist there. The fix is to load from localStorage in a `useEffect` (which only runs client-side), and use a ref flag to prevent the save effect from running before the load effect has finished — otherwise it would overwrite your history with an empty array.

**Image expiry:** If `BLOB_READ_WRITE_TOKEN` is not configured, images expire after ~24 hours. The gallery detects broken image URLs via the `onError` event on `<Image>` and shows an "Expired" placeholder with a Remove button.
