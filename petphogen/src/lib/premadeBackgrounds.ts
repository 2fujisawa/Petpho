export type PremadeBackground = {
  id: string;
  name: string;
  file: string;
};

// Drop image files into /public/backgrounds/ then list them here.
// `file` is the path under /public, e.g. "/backgrounds/living-room.jpg".
export const PREMADE_BACKGROUNDS: PremadeBackground[] = [
  { id: "simple", name: "Simple", file: "/backgrounds/01_simple.jpg" },
  { id: "castle-outdoor", name: "Castle (Outdoor)", file: "/backgrounds/02_castle_outdoor.jpg" },
  { id: "castle-indoor", name: "Castle (Indoor)", file: "/backgrounds/03_castle_indoor.jpg" },
  { id: "village", name: "Village", file: "/backgrounds/04_village.jpg" },
  { id: "flower-field", name: "Flower Field", file: "/backgrounds/05_flower_field.jpg" },
  { id: "grass", name: "Grass", file: "/backgrounds/06_grass.jpg" },
  { id: "fountain", name: "Fountain", file: "/backgrounds/07_fountain.jpg" },
  { id: "party", name: "Party", file: "/backgrounds/08_party.jpg" },
  { id: "apartment-indoor", name: "Apartment (Indoor)", file: "/backgrounds/09_apartment_indoor.jpg" },
  { id: "park", name: "Park", file: "/backgrounds/10_park.jpg" },
  { id: "new-york", name: "New York", file: "/backgrounds/11_new_york.jpg" },
  { id: "beach", name: "Beach", file: "/backgrounds/12_beach.jpg" },
  { id: "savannah", name: "Savannah", file: "/backgrounds/13_savannah.jpg" },
  { id: "stage", name: "Stage", file: "/backgrounds/14_stage.jpg" },
  { id: "tea-party", name: "Tea Party", file: "/backgrounds/15_tea_party.jpg" },
  { id: "sunset", name: "Sunset", file: "/backgrounds/16_sunset.jpg" },
  { id: "drive", name: "Drive", file: "/backgrounds/17_drive.jpg" },
  { id: "fridge", name: "Fridge", file: "/backgrounds/18_fridge.jpg" },
];
