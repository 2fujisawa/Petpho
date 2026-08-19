// Art styles the generator can render a pet in. Every model in MODELS can
// produce any of these — a style is purely a prompt recipe, not a different
// Replicate model, so adding one here is all it takes to offer it in the UI.
export type StyleId = "pixar" | "watercolor" | "oil-painting";

export type StyleConfig = {
  id: StyleId;
  name: string;
  emoji: string;
  description: string;
  // Leading style declaration, e.g. "Disney Pixar 3D animated style".
  prefix: string;
  // Trailing quality/texture descriptors appended after the user's scene.
  details: string;
  // How to refer to the transformed pet inside multi-image prompts.
  characterNoun: string;
};

export const STYLES: StyleConfig[] = [
  {
    id: "pixar",
    name: "Pixar 3D",
    emoji: "🎬",
    description: "Big-eyed 3D animated movie character",
    prefix: "Disney Pixar 3D animated style",
    details:
      "big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, cute and charming, Pixar movie quality",
    characterNoun:
      "Pixar 3D animated character with big expressive eyes, smooth render, and vibrant colors",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    emoji: "🎨",
    description: "Soft translucent washes on textured paper",
    prefix: "Soft watercolor painting style",
    details:
      "delicate translucent washes of color, loose expressive brushstrokes, gentle color bleeds and blooms, textured watercolor paper with white showing through, charming hand-painted feel, fine-art watercolor quality",
    characterNoun:
      "hand-painted watercolor pet with soft translucent washes and loose expressive brushstrokes",
  },
  {
    id: "oil-painting",
    name: "Oil Painting",
    emoji: "🖼️",
    description: "Rich classical brushwork on canvas",
    prefix: "Classical oil painting style",
    details:
      "rich impasto brushstrokes, visible canvas texture, warm layered colors, dramatic painterly lighting, expressive brushwork, museum-quality fine-art oil portrait",
    characterNoun:
      "classical oil-painted pet with rich impasto brushstrokes and warm layered colors",
  },
];

export const DEFAULT_STYLE: StyleId = "pixar";

export function getStyleConfig(id: string | null | undefined): StyleConfig {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

// Prompt for the single-image flow: the user's scene description slots in
// between the style declaration and its quality descriptors, exactly the
// shape the original hardcoded Pixar prompt had.
export function buildStylePrompt(style: StyleConfig, userPrompt: string): string {
  const scene = userPrompt.trim();
  return scene
    ? `${style.prefix}, ${scene}, ${style.details}`
    : `Transform into ${style.prefix}, ${style.details}`;
}

// Prompt for the two-image flow (pet photo + background photo): restyle the
// pet, place it in the scene, and pull the background into the same medium so
// the result reads as one artwork rather than a sticker on a photo.
export function buildStyleBackgroundPrompt(style: StyleConfig): string {
  return `${style.prefix}. Take the pet animal from the first image and transform it into a ${style.characterNoun}. Place the pet sitting naturally inside the scene shown in the second image, keeping the scene's layout and content, rendered in the same ${style.name.toLowerCase()} style so the whole image looks like a single cohesive artwork. ${style.details}.`;
}
