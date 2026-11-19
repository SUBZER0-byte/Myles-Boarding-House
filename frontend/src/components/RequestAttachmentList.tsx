import { useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Video, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ComplaintAttachment } from "@/lib/tenantRequests";

interface RequestAttachmentListProps {
  attachments?: ComplaintAttachment[];
  legacyPhotoUrl?: string | null;
}

export function RequestAttachmentList({
  attachments = [],
  legacyPhotoUrl,
}: RequestAttachmentListProps) {
  const [imagesOpen, setImagesOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const images = [
    ...(legacyPhotoUrl ? [{ path: "legacy-photo", signed_url: legacyPhotoUrl }] : []),
    ...attachments
      .filter(attachment => attachment.type === "image")
      .map(attachment => ({ path: attachment.path, signed_url: attachment.signed_url })),
  ];
  const video = attachments.find(attachment => attachment.type === "video");
  const currentImage = images[activeImageIndex];

  if (images.length === 0 && !video) return null;

  const moveImage = (direction: -1 | 1) => {
    setActiveImageIndex(index => (index + direction + images.length) % images.length);
    setZoomLevel(1);
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Complaint attachments">
        {images.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              setActiveImageIndex(0);
              setZoomLevel(1);
              setImagesOpen(true);
            }}
          >
            <ImageIcon size={16} />
            View Images
            <span className="text-muted-foreground">({images.length})</span>
          </Button>
        )}
        {video && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setVideoOpen(true)}
          >
            <Video size={16} />
            View Video
          </Button>
        )}
      </div>

      <Dialog
        open={imagesOpen}
        onOpenChange={open => {
          setImagesOpen(open);
          if (!open) setZoomLevel(1);
        }}
      >
        {currentImage && (
          <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-6xl gap-3 overflow-hidden p-3 sm:p-5">
            <DialogTitle className="sr-only">Complaint image</DialogTitle>
            <DialogDescription className="sr-only">Complaint image preview</DialogDescription>
            <div className="relative flex max-h-[78vh] items-center justify-center overflow-hidden rounded-md bg-black/95">
              <img
                src={currentImage.signed_url}
                alt={`Complaint image ${activeImageIndex + 1} of ${images.length}`}
                className="max-h-[78vh] w-full object-contain transition-transform duration-200"
                style={{ transform: `scale(${zoomLevel})` }}
                draggable={false}
              />
              {images.length > 1 && (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label="Previous complaint image"
                    className="absolute left-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border border-white/20 bg-white/95 text-black shadow-lg hover:bg-white"
                    onClick={() => moveImage(-1)}
                  >
                    <ChevronLeft size={20} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label="Next complaint image"
                    className="absolute right-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border border-white/20 bg-white/95 text-black shadow-lg hover:bg-white"
                    onClick={() => moveImage(1)}
                  >
                    <ChevronRight size={20} />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm text-muted-foreground">
                Image {activeImageIndex + 1}{images.length > 1 ? ` of ${images.length}` : ""}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Zoom out"
                  disabled={zoomLevel <= 1}
                  onClick={() => setZoomLevel(level => Math.max(1, level - 0.5))}
                >
                  <ZoomOut size={16} />
                </Button>
                <span className="min-w-10 text-center text-xs">{Math.round(zoomLevel * 100)}%</span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Zoom in"
                  disabled={zoomLevel >= 3}
                  onClick={() => setZoomLevel(level => Math.min(3, level + 0.5))}
                >
                  <ZoomIn size={16} />
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        {video && (
          <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-6xl gap-3 overflow-hidden p-3 sm:p-5">
            <DialogTitle className="sr-only">Complaint video</DialogTitle>
            <DialogDescription className="sr-only">Complaint video preview</DialogDescription>
            <div className="flex max-h-[78vh] items-center justify-center overflow-hidden rounded-md bg-black/95">
              <video
                key={video.path}
                controls
                preload="metadata"
                aria-label="Complaint video preview"
                className="max-h-[78vh] max-w-full object-contain"
                src={video.signed_url}
              >
                Your browser does not support video playback.
              </video>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
