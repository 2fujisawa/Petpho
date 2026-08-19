"use client";

import { MODELS } from "@/lib/models";
import { downloadImage, formatDate } from "@/lib/browser";
import type { GeneratedImage } from "@/types/studio";
import { overlayChip } from "./ui";

export function ImageCard({
  img, index, onOpen, onEdit, onScene, onRemove, onViewOriginal, isBroken, onBroken, showDate,
  selectMode = false, selected = false, onToggleSelect,
}: {
  img: GeneratedImage;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onScene: () => void;
  onRemove: () => void;
  onViewOriginal: () => void;
  isBroken: boolean;
  onBroken: () => void;
  showDate?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  // Items recovered from storage on another device carry no model.
  const modelName =
    MODELS.find((m) => m.id === img.model)?.name ?? img.model?.split("/")[1] ?? "Unknown model";
  return (
    <div className="break-inside-avoid animate-fade-up" style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}>
      <div
        className={`group relative rounded-2xl overflow-hidden bg-white cursor-pointer transition-opacity duration-150 ${
          isBroken ? "" : "card-glow"
        } ${selectMode && !selected ? "opacity-60" : ""} ${selected ? "ring-2 ring-orange-400" : ""}`}
        onClick={() => {
          if (selectMode) { onToggleSelect?.(); return; }
          if (!isBroken) onOpen();
        }}
      >
        {selectMode && (
          <div className={`absolute top-2 right-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-orange-500 border-orange-500" : "bg-white/70 border-white backdrop-blur-sm"
          }`}>
            {selected && <span className="text-white text-[10px] leading-none">✓</span>}
          </div>
        )}
        {isBroken ? (
          <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4">
            <span className="text-3xl opacity-30">🖼️</span>
            <p className="text-xs text-zinc-500 font-medium">Expired</p>
            {!selectMode && (
              <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="text-xs bg-red-500/15 hover:bg-red-500/30 text-red-400 px-3 py-1 rounded-full transition-colors font-medium mt-1">
                Remove
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-hidden">
              {/* Plain <img>: these are user-generated remote files, so the
                  Next image optimizer has nothing to add. width/height keep a
                  1:1 slot reserved until the real aspect ratio is known. */}
              <img src={img.url} alt={img.prompt} width={512} height={512}
                className="w-full h-auto object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                loading={index === 0 ? "eager" : "lazy"} decoding="async" onError={onBroken} />
            </div>
            {/* Hover overlay */}
            {!selectMode && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
                <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                  {img.prompt}
                </p>
                <div className="flex gap-1.5 flex-wrap translate-y-2 group-hover:translate-y-0 transition-transform duration-300 delay-[40ms]">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                    ✏️ Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onScene(); }}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                    🖼️ Scene
                  </button>
                  {img.uploadUrl && (
                    <button onClick={(e) => { e.stopPropagation(); onViewOriginal(); }}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                      🐾 Original
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); downloadImage(img.url); }}
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${overlayChip}`}>
                    ↓
                  </button>
                </div>
              </div>
            )}
            {/* Badges */}
            <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
              {img.sourceUrl && !selectMode && (
                <span className="text-[10px] bg-black/45 backdrop-blur-sm text-white/85 px-2 py-0.5 rounded-full font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  Edited
                </span>
              )}
              {!selectMode && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto backdrop-blur-sm bg-black/45 text-white/85 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {modelName}
                </span>
              )}
            </div>
            {showDate && formatDate(img.createdAt) && (
              <div className="absolute bottom-2 right-2 pointer-events-none">
                <span className="text-[10px] bg-black/50 backdrop-blur-sm text-white/80 px-2 py-0.5 rounded-full font-medium">
                  {formatDate(img.createdAt)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
