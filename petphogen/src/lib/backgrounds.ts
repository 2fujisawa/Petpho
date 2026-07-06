export type Background = {
  id: string;
  name: string;
  description: string;
  gradient: string;
};

export const BACKGROUNDS: Background[] = [
  {
    id: "living-room",
    name: "Living Room",
    description: "cozy Pixar living room with armchairs, fireplace, bay window and vintage decor",
    gradient: "linear-gradient(135deg, #c9a87c 0%, #e8c99a 50%, #f5e6d0 100%)",
  },
  {
    id: "garden",
    name: "Garden",
    description: "lush green garden with blooming flowers and soft sunlight",
    gradient: "linear-gradient(135deg, #2d6a2d 0%, #52b452 50%, #a8e6a8 100%)",
  },
  {
    id: "beach",
    name: "Beach",
    description: "sunny tropical beach with turquoise water and golden sand",
    gradient: "linear-gradient(180deg, #4db8d4 0%, #7dd4e8 40%, #f5d87a 70%, #e8c97a 100%)",
  },
  {
    id: "forest",
    name: "Enchanted Forest",
    description: "enchanted magical forest with dappled light and glowing fireflies",
    gradient: "linear-gradient(135deg, #1a3a1a 0%, #2d6b3a 50%, #4a9b4a 100%)",
  },
  {
    id: "space",
    name: "Outer Space",
    description: "vibrant outer space with colorful nebulae and glowing stars",
    gradient: "linear-gradient(135deg, #0a0a2e 0%, #1a1a5e 40%, #6b2fa0 70%, #c75db0 100%)",
  },
  {
    id: "snow",
    name: "Winter Snow",
    description: "peaceful snowy winter landscape with soft falling snowflakes",
    gradient: "linear-gradient(180deg, #9ec8e8 0%, #c8e4f5 40%, #e8f4fb 70%, #f5fbff 100%)",
  },
  {
    id: "city",
    name: "City at Night",
    description: "glittering city skyline at night with bokeh lights",
    gradient: "linear-gradient(180deg, #0a0a1e 0%, #1a1a4e 40%, #2a2a6e 70%, #ff8c00 100%)",
  },
  {
    id: "kitchen",
    name: "Kitchen",
    description: "bright cheerful kitchen with warm lighting and colorful decor",
    gradient: "linear-gradient(135deg, #f5e6c8 0%, #fad690 50%, #f5c842 100%)",
  },
];
