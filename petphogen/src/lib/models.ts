export type ModelId =
  | "black-forest-labs/flux-kontext-pro"
  | "black-forest-labs/flux-fill-pro"
  | "google/nano-banana"
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
  // Enum of aspect_ratio values this model actually accepts (compose models only).
  // Include "match_input_image" if the model supports it as a literal value.
  supportedAspectRatios?: string[];
};

export const MODELS: ModelConfig[] = [
  {
    id: "black-forest-labs/flux-kontext-pro",
    name: "Flux Kontext Pro",
    provider: "Black Forest Labs",
    description: "Best identity preservation & instruction-following edits",
    imageParam: "input_image",
    imageIsArray: false,
    outputFormat: "jpg",
  },
  {
    id: "google/nano-banana",
    name: "Nano Banana",
    provider: "Google (Gemini 2.5)",
    description: "Conversational editing — great at following natural language",
    imageParam: "image_input",
    imageIsArray: true,
    outputFormat: "jpg",
  },
  {
    id: "openai/gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    description: "Excellent instruction-following & multi-image compositing",
    imageParam: "input_images",
    imageIsArray: true,
    outputFormat: "jpeg",
    extraInput: { background: "opaque" },
  },
];

export const DEFAULT_MODEL: ModelId = "black-forest-labs/flux-kontext-pro";

export function getModelConfig(id: string): ModelConfig {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function buildImageInput(
  config: ModelConfig,
  imageValue: string
): Record<string, string | string[]> {
  return {
    [config.imageParam]: config.imageIsArray ? [imageValue] : imageValue,
  };
}

// Models capable of blending two distinct images (subject + background) into one scene
export const COMPOSE_MODELS: ModelConfig[] = [
  {
    id: "google/nano-banana-pro",
    name: "Nano Banana Pro",
    provider: "Google (Gemini 3 Pro)",
    description: "Best overall — strongest lighting & shadow matching",
    imageParam: "image_input",
    imageIsArray: true,
    outputFormat: "jpg",
    supportedAspectRatios: ["match_input_image", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  },
  {
    id: "google/nano-banana",
    name: "Nano Banana",
    provider: "Google (Gemini 2.5)",
    description: "Faster & cheaper, slightly less polished blending",
    imageParam: "image_input",
    imageIsArray: true,
    outputFormat: "jpg",
    supportedAspectRatios: ["match_input_image", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
  },
  {
    id: "openai/gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    description: "Strong instruction-following for complex scene placement",
    imageParam: "input_images",
    imageIsArray: true,
    outputFormat: "jpeg",
    extraInput: { background: "opaque" },
    supportedAspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16"],
  },
];

export const DEFAULT_COMPOSE_MODEL: ModelId = "google/nano-banana-pro";

export function getComposeModelConfig(id: string): ModelConfig {
  return COMPOSE_MODELS.find((m) => m.id === id) ?? COMPOSE_MODELS[0];
}

export function buildComposeImageInput(
  config: ModelConfig,
  images: string[]
): Record<string, string[]> {
  return { [config.imageParam]: images };
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

function parseAspectRatio(value: string): number {
  const [w, h] = value.split(":").map(Number);
  return w && h ? w / h : 1;
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
