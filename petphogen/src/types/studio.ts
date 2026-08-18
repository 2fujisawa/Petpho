import type { ModelId, VideoModelId } from "@/lib/models";

export type GeneratedImage = {
  url: string;
  prompt: string;
  // Absent on items recovered from Blob storage on another device — storage
  // holds the pixels but not the metadata the browser that made them kept.
  model?: ModelId;
  sourceUrl?: string;
  uploadUrl?: string;
  createdAt?: number;
  // Present only on results produced by the inpaint editor — lets reopening
  // this image restore the ratio/resolution/model it was made with, instead
  // of falling back to whatever the editor currently defaults to.
  editSettings?: { aspectRatio: string; resolution: string; model: ModelId };
};

export type EditorState = {
  sourceImage: GeneratedImage;
  editPrompt: string;
  model: ModelId;
  aspectRatio: string; // "original" or e.g. "16:9" — non-original outpaints the canvas
  resolution: string; // "original" or e.g. "2K" — non-original upscales the result
  loading: boolean;
  error: string | null;
};

// One in-flight (or failed) "Apply Edit" call. Tracked outside EditorState so
// firing another edit — even against a different photo or model — never has
// to wait on this one, and switching away from the editor doesn't lose track
// of it: it keeps running and lands in history regardless.
export type EditJob = {
  id: string;
  thumbnailUrl: string;
  model: ModelId;
  error?: string;
};

export type GeneratedVideo = {
  url: string;
  prompt: string;
  model?: VideoModelId;
  // The still it was animated from, when it wasn't plain text-to-video.
  sourceUrl?: string;
  createdAt?: number;
};

// Same shape and reasoning as EditJob — a clip takes minutes, so it has to keep
// running while you queue more, switch tabs, or go back to editing.
export type VideoJob = {
  id: string;
  thumbnailUrl?: string;
  model: VideoModelId;
  error?: string;
};
