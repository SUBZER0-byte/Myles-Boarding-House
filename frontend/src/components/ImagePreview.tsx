import { useState, type ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ImagePreviewProps {
  src: string;
  alt: string;
  triggerLabel?: string;
  triggerClassName?: string;
  imageClassName?: string;
  onImageError?: () => void;
  children?: ReactNode;
}

export function ImagePreview({
  src,
  alt,
  triggerLabel,
  triggerClassName,
  imageClassName,
  onImageError,
  children,
}: ImagePreviewProps) {
  const [open, setOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setZoomLevel(1);
  };

  return (
    <>
      <button
        type="button"
        className={cn("block cursor-zoom-in border-0 bg-transparent p-0 text-left", triggerClassName)}
        aria-label={triggerLabel ?? `View image: ${alt}`}
        onClick={() => handleOpenChange(true)}
      >
        {children ?? <img src={src} alt={alt} className={imageClassName} onError={onImageError} />}
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-6xl gap-3 overflow-hidden p-3 sm:p-5">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">Full-size image preview</DialogDescription>
          <div className="relative flex max-h-[78vh] items-center justify-center overflow-auto rounded-md bg-black/95">
            <img
              src={src}
              alt={alt}
              className="max-h-[78vh] w-full object-contain transition-transform duration-200"
              style={{ transform: `scale(${zoomLevel})` }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm text-muted-foreground">{alt}</p>
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
      </Dialog>
    </>
  );
}
