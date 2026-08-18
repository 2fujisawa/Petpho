import { parseAspectRatio } from "./geometry";

export type ModelId =
  | "black-forest-labs/flux-kontext-pro"
  | "black-forest-labs/flux-fill-pro"
  | "google/nano-banana-pro"
  | "openai/gpt-image-2";

export type ModelConfig = {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  imageParam: string;
  imageIsArray: boolean;
  outputFormat: string;
  extraInput?: Record<string, unknown>;
  // Enum of aspect_ratio values this model actually accepts (edit/compose flows).
  // Include "match_input_image" if the model supports it as a literal value.
  supportedAspectRatios?: string[];
  // Enum of resolution values this model accepts (e.g. ["1K", "2K", "4K"]).
  // Omitted for models with no resolution control.
  supportedResolutions?: string[];
  // Input field the resolution choice is sent as. Defaults to "resolution";
  // gpt-image-2 exposes its equivalent knob as "quality" (low/medium/high).
  resolutionParam?: string;
  // True only for models that take a real black-and-white mask and repaint
  // exactly that region. Everything else is an instruction editor: it rewrites
  // the whole image from the prompt, so the brushed region can only be passed
  // as a visual hint, never enforced.
  usesMask?: boolean;
};

// The three places a model can be offered. A model's technical shape (input
// param names, output format, supported ratios) is the same everywhere; only
// the one-line pitch differs by role.
type ModelRole = "generate" | "edit" | "compose";

type CatalogEntry = Omit<ModelConfig, "description"> & {
  // Description shown for each role the model is offered in. A role that is
  // absent here means the model isn't offered there.
  roles: Partial<Record<ModelRole, string>>;
};

// Single source of truth for every image model. Order here is the order the
// UI lists them in, within each role.
const CATALOG: CatalogEntry[] = [
  {
    id: "black-forest-labs/flux-kontext-pro",
    name: "Flux Kontext Pro",
    provider: "Black Forest Labs",
    imageParam: "input_image",
    imageIsArray: false,
    outputFormat: "jpg",
    roles: {
      generate: "Best identity preservation & instruction-following edits",
    },
  },
  {
    id: "black-forest-labs/flux-fill-pro",
    name: "Flux Fill Pro",
    provider: "Black Forest Labs",
    imageParam: "image",
    imageIsArray: false,
    outputFormat: "jpg",
    usesMask: true,
    roles: {
      edit: "Repaints exactly inside your brush — best for touch-ups & removals",
    },
  },
  {
    id: "google/nano-banana-pro",
    name: "Nano Banana Pro",
    provider: "Google (Gemini 3 Pro)",
    imageParam: "image_input",
    imageIsArray: true,
    outputFormat: "jpg",
    supportedAspectRatios: ["match_input_image", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    supportedResolutions: ["1K", "2K", "4K"],
    roles: {
      generate: "Highest quality — the only model with 1K/2K/4K output",
      edit: "Much better at adding new objects — edits the whole frame from your description",
      compose: "Best overall — strongest lighting & shadow matching",
    },
  },
  {
    id: "openai/gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    imageParam: "input_images",
    imageIsArray: true,
    outputFormat: "jpeg",
    extraInput: { background: "opaque" },
    supportedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    supportedResolutions: ["low", "medium", "high"],
    resolutionParam: "quality",
    roles: {
      generate: "Excellent instruction-following & multi-image compositing",
      edit: "Strong instruction-following for complex object edits",
      compose: "Strong instruction-following for complex scene placement",
    },
  },
];

function modelsFor(role: ModelRole): ModelConfig[] {
  return CATALOG.flatMap(({ roles, ...base }) => {
    const description = roles[role];
    return description ? [{ ...base, description }] : [];
  });
}

// Models offered in the generator.
export const MODELS: ModelConfig[] = modelsFor("generate");
export const DEFAULT_MODEL: ModelId = "black-forest-labs/flux-kontext-pro";

// Models offered in the inpaint editor. Only Flux Fill Pro repaints strictly
// inside the brushed mask; the others are far stronger at inventing new objects
// but rewrite the whole frame, so the brush is passed to them as a marked-up
// reference image instead of an enforced boundary.
export const EDIT_MODELS: ModelConfig[] = modelsFor("edit");
export const DEFAULT_EDIT_MODEL: ModelId = "black-forest-labs/flux-fill-pro";

// Models capable of blending two distinct images (subject + background) into one scene.
export const COMPOSE_MODELS: ModelConfig[] = modelsFor("compose");
export const DEFAULT_COMPOSE_MODEL: ModelId = "google/nano-banana-pro";

function pick(list: ModelConfig[], id: string): ModelConfig {
  return list.find((m) => m.id === id) ?? list[0];
}
export const getModelConfig = (id: string) => pick(MODELS, id);
export const getEditModelConfig = (id: string) => pick(EDIT_MODELS, id);
export const getComposeModelConfig = (id: string) => pick(COMPOSE_MODELS, id);

export function buildImageInput(
  config: ModelConfig,
  imageValue: string
): Record<string, string | string[]> {
  return {
    [config.imageParam]: config.imageIsArray ? [imageValue] : imageValue,
  };
}

export function buildComposeImageInput(
  config: ModelConfig,
  images: string[]
): Record<string, string[]> {
  return { [config.imageParam]: images };
}

// ── Video ────────────────────────────────────────────────────────────────
// Seedance animates outward from a still it's given as the first frame, which
// is exactly the shape of this app — every Pixar pet already in history is a
// candidate first frame. All three variants share one input schema; the values
// below are taken from Replicate's published schema for the model, not guessed.
export type VideoModelId =
  | "bytedance/seedance-2.0"
  | "bytedance/seedance-2.0-fast"
  | "bytedance/seedance-2.0-mini";

export type VideoModelConfig = {
  id: VideoModelId;
  name: string;
  provider: string;
  description: string;
};

export const VIDEO_MODELS: VideoModelConfig[] = [
  {
    id: "bytedance/seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    provider: "ByteDance",
    description: "Quicker and cheaper per clip — the sensible default",
  },
  {
    id: "bytedance/seedance-2.0",
    name: "Seedance 2.0",
    provider: "ByteDance",
    description: "Best quality motion and audio, slowest of the three",
  },
  {
    id: "bytedance/seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    provider: "ByteDance",
    description: "Lowest cost — good for trying an idea before committing",
  },
];

export const DEFAULT_VIDEO_MODEL: VideoModelId = "bytedance/seedance-2.0-fast";

export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p", "4k"];
export const VIDEO_ASPECT_RATIOS = [
  "adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21",
];
// -1 is the model's "intelligent duration" — it picks the length that suits
// the prompt. The schema accepts anything from -1 to 15 seconds.
export const VIDEO_DURATIONS = [-1, 5, 10, 15];
export const MAX_VIDEO_DURATION = 15;

export function getVideoModelConfig(id: string): VideoModelConfig {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[0];
}

function snapAspectRatio(targetRatio: number, options: string[]): string {
  let best = options[0];
  let bestDiff = Infinity;
  for (const option of options) {
    const [w, h] = option.split(":").map(Number);
    if (!w || !h) continue; // skip non-numeric entries like "match_input_image"
    const diff = Math.abs(Math.log(w / h) - Math.log(targetRatio));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = option;
    }
  }
  return best;
}

// Resolve the aspect_ratio value to send for a compose model.
// - userChoice (e.g. "16:9") wins if the model supports it directly, or gets
//   snapped to the closest ratio the model does support.
// - "auto" (or no choice) matches the real shape of the background photo,
//   using the model's literal "match_input_image" value when available.
export function resolveComposeAspectRatio(
  config: ModelConfig,
  userChoice: string | undefined,
  bgWidth: number,
  bgHeight: number
): string | undefined {
  const options = config.supportedAspectRatios;
  if (!options || options.length === 0) return undefined;

  if (userChoice && userChoice !== "auto") {
    if (options.includes(userChoice)) return userChoice;
    return snapAspectRatio(parseAspectRatio(userChoice), options);
  }

  if (options.includes("match_input_image")) return "match_input_image";
  return snapAspectRatio(bgWidth / bgHeight, options);
}

// Resolve the resolution value to send for a model. Returns undefined when the
// model has no resolution control, or the choice isn't one of its supported
// values — the model then falls back to its own default.
export function resolveResolution(
  config: ModelConfig,
  userChoice: string | undefined
): string | undefined {
  const options = config.supportedResolutions;
  if (!options || !userChoice) return undefined;
  return options.includes(userChoice) ? userChoice : undefined;
}

// Some models (e.g. gpt-image-2) always return an array of image URLs even
// for a single output, while others (nano-banana, flux-kontext-pro) return a
// bare URL string. Normalize both shapes and surface an explicit error if the
// model came back with nothing (e.g. silently refused by content moderation)
// instead of letting an empty/garbage URL pass through unnoticed.
export function extractImageUrl(output: unknown): string {
  const value = Array.isArray(output) ? output[0] : output;
  const url = value == null ? "" : String(value);
  if (!url) {
    throw new Error("The model returned no image — it may have declined the request.");
  }
  return url;
}
