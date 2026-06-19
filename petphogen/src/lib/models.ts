export type ModelId =
  | "black-forest-labs/flux-kontext-pro"
  | "black-forest-labs/flux-kontext-max"
  | "black-forest-labs/flux-kontext-dev"
  | "google/nano-banana"
  | "qwen/qwen-image-edit-plus"
  | "bytedance/seedream-4";

export type ModelConfig = {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  imageParam: string;
  imageIsArray: boolean;
};

export const MODELS: ModelConfig[] = [
  {
    id: "black-forest-labs/flux-kontext-pro",
    name: "Flux Kontext Pro",
    provider: "Black Forest Labs",
    description: "Best identity preservation & instruction-following edits",
    imageParam: "input_image",
    imageIsArray: false,
  },
  {
    id: "black-forest-labs/flux-kontext-max",
    name: "Flux Kontext Max",
    provider: "Black Forest Labs",
    description: "Highest quality output — slower but premium results",
    imageParam: "input_image",
    imageIsArray: false,
  },
  {
    id: "black-forest-labs/flux-kontext-dev",
    name: "Flux Kontext Dev",
    provider: "Black Forest Labs",
    description: "Fast & affordable — great for rapid iteration",
    imageParam: "input_image",
    imageIsArray: false,
  },
  {
    id: "google/nano-banana",
    name: "Nano Banana",
    provider: "Google (Gemini 2.5)",
    description: "Conversational editing — great at following natural language",
    imageParam: "image_input",
    imageIsArray: true,
  },
  {
    id: "qwen/qwen-image-edit-plus",
    name: "Qwen Image Edit Plus",
    provider: "Alibaba Qwen",
    description: "Strong at object removal, perspective changes & style edits",
    imageParam: "image",
    imageIsArray: true,
  },
  {
    id: "bytedance/seedream-4",
    name: "Seedream 4",
    provider: "ByteDance",
    description: "Reference-based generation — reimagines the pet in new scenes",
    imageParam: "image_input",
    imageIsArray: true,
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
