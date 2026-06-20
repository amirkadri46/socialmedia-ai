"use client";

import { useRef, type RefObject, type CSSProperties } from "react";
import type { ClipEdit, Word } from "@/lib/types";
import { editedToWindow, layoutAt } from "@/lib/clip/edit-timeline";
import { CaptionLayer } from "./caption-render";

function aspectRatioValue(aspect: string): number {
  switch (aspect) {
    case "1:1": return 1;
    case "16:9": return 16 / 9;
    case "9:16":
    default: return 9 / 16;
  }
}

/**
 * Live preview: base <video> (seeked by the shell), framed per the active LayoutSegment,
 * with the caption layer and draggable text/media overlays on top. Pure render of `edit`.
 */
export function PreviewCanvas({
  jobId,
  edit,
  words,
  playhead,
  videoRef,
  onUpdate,
  selectedTextId,
  onSelectText,
}: {
  jobId: string;
  edit: ClipEdit;
  words: Word[];
  playhead: number; // edited-timeline seconds
  videoRef: RefObject<HTMLVideoElement | null>;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  selectedTextId?: string | null;
  onSelectText?: (id: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const windowT = editedToWindow(edit, playhead);
  const seg = layoutAt(edit, playhead);
  const ar = aspectRatioValue(edit.aspectRatio);

  // Source-time words rebased to window coords (caption renderer expects window time).
  const windowedWords = words
    .filter((w) => w.end > edit.sourceInSec && w.start < edit.sourceOutSec)
    .map((w) => ({ text: w.text, start: w.start - edit.sourceInSec, end: w.end - edit.sourceInSec }));

  // Framing: Fit = contain (letterbox); Fill = cover; Fill+crop = exact crop→canvas map
  // (the same mapping editRender uses, so preview matches export).
  const crop = seg?.crop;
  // NOTE: maxWidth/maxHeight "none" override Tailwind preflight's `video { max-width:100% }`,
  // which would otherwise cap the >100% sizes used to map a crop region onto the canvas.
  let videoStyle: CSSProperties;
  if (seg?.mode === "fit") {
    videoStyle = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", maxWidth: "none", maxHeight: "none", objectFit: "contain" };
  } else if (crop && crop.w > 0 && crop.h > 0) {
    videoStyle = {
      position: "absolute",
      width: `${100 / crop.w}%`,
      height: `${100 / crop.h}%`,
      left: `${-(crop.x / crop.w) * 100}%`,
      top: `${-(crop.y / crop.h) * 100}%`,
      maxWidth: "none",
      maxHeight: "none",
      objectFit: "fill",
    };
  } else {
    videoStyle = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", maxWidth: "none", maxHeight: "none", objectFit: "cover" };
  }

  // Drag handler factory for caption / text overlays (normalized coords).
  function startDrag(onMove: (nx: number, ny: number) => void) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const nx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const ny = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
        onMove(nx, ny);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Estimate rendered canvas height for caption font scaling.
  const canvasH = boxRef.current?.clientHeight ?? 640;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-lg bg-black shadow-2xl"
        style={{ aspectRatio: String(ar), height: "min(70vh, 100%)", maxWidth: "100%" }}
      >
        <video
          ref={videoRef}
          src={`/api/clip/${jobId}/source`}
          playsInline
          muted={false}
          preload="auto"
          onLoadedMetadata={(e) => {
            // Open on the clip's first frame, not the start of the whole source.
            e.currentTarget.currentTime = edit.sourceInSec + windowT;
          }}
          style={videoStyle}
        />

        {/* Caption layer — draggable to set caption.offset */}
        <CaptionLayer
          config={edit.caption}
          words={windowedWords}
          windowT={windowT}
          canvasH={canvasH}
          onPointerDown={startDrag((nx, ny) =>
            onUpdate((d) => {
              d.caption.offset = { x: nx, y: ny };
            })
          )}
        />

        {/* Text overlays (hook chip, titles) — draggable + selectable */}
        {edit.textOverlays
          .filter((o) => playhead >= o.start && playhead <= o.end)
          .map((o) => {
            const selected = selectedTextId === o.id;
            return (
              <div
                key={o.id}
                onPointerDown={(e) => {
                  onSelectText?.(o.id);
                  startDrag((nx, ny) =>
                    onUpdate((d) => {
                      const t = d.textOverlays.find((x) => x.id === o.id);
                      if (t) { t.x = nx; t.y = ny; }
                    })
                  )(e);
                }}
                className={`absolute z-30 cursor-move select-none whitespace-pre-wrap font-semibold ${selected ? "ring-2 ring-foreground" : ""}`}
                style={{
                  left: `${o.x * 100}%`,
                  top: `${o.y * 100}%`,
                  transform: "translate(-50%,-50%)",
                  background: o.style.bg,
                  color: o.style.color,
                  fontFamily: o.style.font,
                  fontSize: (o.style.sizePx * canvasH) / 1920,
                  fontWeight: o.style.bold ? 700 : 400,
                  fontStyle: o.style.italic ? "italic" : undefined,
                  textDecoration: o.style.underline ? "underline" : undefined,
                  textAlign: o.style.align ?? "center",
                  borderRadius: o.style.radiusPx,
                  padding: o.style.bg ? "4px 10px" : undefined,
                  maxWidth: `${o.style.widthPct ?? 80}%`,
                }}
              >
                {o.text}
              </div>
            );
          })}

        {/* Media overlays — draggable, corner-resizable */}
        {edit.mediaOverlays
          .filter((m) => playhead >= m.start && playhead <= m.end)
          .map((m) => (
            <div
              key={m.id}
              onPointerDown={startDrag((nx, ny) =>
                onUpdate((d) => {
                  const t = d.mediaOverlays.find((x) => x.id === m.id);
                  if (t) { t.x = Math.min(1 - t.w, Math.max(0, nx - t.w / 2)); t.y = Math.min(1 - t.h, Math.max(0, ny - t.h / 2)); }
                })
              )}
              className="group absolute z-10 cursor-move"
              style={{
                left: `${m.x * 100}%`,
                top: `${m.y * 100}%`,
                width: `${m.w * 100}%`,
                height: `${m.h * 100}%`,
                opacity: m.opacity ?? 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.kind === "image" ? (
                <img src={m.src} alt="" className="pointer-events-none h-full w-full object-contain" />
              ) : (
                <video src={m.src} className="pointer-events-none h-full w-full object-contain" muted loop autoPlay />
              )}
              {/* resize handle (bottom-right) */}
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const box = boxRef.current?.getBoundingClientRect();
                  if (!box) return;
                  const move = (ev: PointerEvent) => {
                    const nw = Math.min(1 - m.x, Math.max(0.05, (ev.clientX - box.left) / box.width - m.x));
                    const nh = Math.min(1 - m.y, Math.max(0.05, (ev.clientY - box.top) / box.height - m.y));
                    onUpdate((d) => {
                      const t = d.mediaOverlays.find((x) => x.id === m.id);
                      if (t) { t.w = nw; t.h = nh; }
                    });
                  };
                  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-full border border-background bg-foreground opacity-0 group-hover:opacity-100"
              />
            </div>
          ))}
      </div>
    </div>
  );
}
