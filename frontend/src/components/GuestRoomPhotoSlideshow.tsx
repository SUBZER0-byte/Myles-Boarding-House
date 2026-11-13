import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, ZoomIn, ZoomOut } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/api";
import { getPublicRoomImageUrl, getPublicRoomPhotos, type PublicRoomPhoto } from "@/lib/publicRooms";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface GuestRoomPhotoSlideshowProps {
  roomId: number;
  roomNumber: string;
  coverImage?: string;
  expanded?: boolean;
}

interface Slide {
  src: string;
  caption: string;
}

function imageUrl(image: string): string {
  const resolvedImage = getPublicRoomImageUrl(image);
  if (resolvedImage.startsWith("http")) return resolvedImage;
  if (image.includes("/")) return `${API_BASE_URL}/${image}`;
  return `${API_BASE_URL}/uploads/rooms/${encodeURIComponent(image)}`;
}

export function GuestRoomPhotoSlideshow({ roomId, roomNumber, coverImage, expanded = false }: GuestRoomPhotoSlideshowProps) {
  const [photos, setPhotos] = useState<PublicRoomPhoto[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    let active = true;
    setPhotos([]);
    setActiveSlide(0);
    setPhotoLoadFailed(false);

    getPublicRoomPhotos(roomId).then((data) => {
      if (!active) return;
      setPhotos(data);
    }).catch(() => {
      if (active) {
        setPhotos([]);
        setPhotoLoadFailed(true);
      }
    });

    return () => {
      active = false;
    };
  }, [roomId]);

  const slides: Slide[] = [
    ...(coverImage ? [{ src: imageUrl(coverImage), caption: "Room overview" }] : []),
    ...photos.map((photo) => ({
      src: imageUrl(photo.filename),
      caption: photo.caption || "Room photo",
    })),
  ];
  const slideCount = slides.length;
  const currentSlide = slides[activeSlide] || slides[0];

  useEffect(() => {
    setZoomLevel(1);
  }, [activeSlide, zoomOpen]);

  useEffect(() => {
    if (slideCount < 2 || zoomOpen) return;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slideCount);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [slideCount, zoomOpen]);

  useEffect(() => {
    if (activeSlide >= slideCount) setActiveSlide(0);
  }, [activeSlide, slideCount]);

  const moveSlide = (direction: -1 | 1) => {
    setActiveSlide((current) => (current + direction + slideCount) % slideCount);
  };

  const goToSlide = (index: number) => {
    setActiveSlide(index);
  };

  const handleSwipeEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number } }) => {
    if (Math.abs(info.offset.x) < 45) return;
    moveSlide(info.offset.x < 0 ? 1 : -1);
  };

  return (
    <div className={`relative mb-3 ${expanded ? "h-56 sm:h-72" : "h-36"} overflow-hidden rounded-md bg-muted transition-[height] duration-300`}>
      {slideCount > 0 ? (
        <>
          <motion.div
            className="relative h-full w-full touch-pan-y overflow-hidden"
            drag={slideCount > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={handleSwipeEnd}
          >
            <button
              type="button"
              className="absolute inset-0 h-full w-full cursor-zoom-in"
              aria-label={`Zoom image: Room ${roomNumber}, ${currentSlide.caption}`}
              onClick={() => setZoomOpen(true)}
            >
              <img
                key={currentSlide.src}
                src={currentSlide.src}
                alt={`Room ${roomNumber}: ${currentSlide.caption}`}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>
          </motion.div>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Zoom room photo"
            title="Zoom room photo"
            className="absolute right-2 bottom-2 h-8 w-8 rounded-full bg-background/85"
            onClick={() => setZoomOpen(true)}
          >
            <ZoomIn size={16} />
          </Button>
          {slideCount > 1 && (
            <>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label="Previous room photo"
                className="absolute left-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border border-black/10 bg-white text-black shadow-lg hover:bg-white/90"
                onClick={() => moveSlide(-1)}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label="Next room photo"
                className="absolute right-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border border-black/10 bg-white text-black shadow-lg hover:bg-white/90"
                onClick={() => moveSlide(1)}
              >
                <ChevronRight size={16} />
              </Button>
              <span className="absolute right-2 top-2 rounded bg-background/85 px-2 py-0.5 text-[10px] text-foreground">
                {activeSlide + 1}/{slideCount}
              </span>
              <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-2 py-1">
                {slides.map((slide, index) => (
                  <button
                    key={slide.src}
                    type="button"
                    aria-label={`Show photo ${index + 1} of ${slideCount}`}
                    aria-current={index === activeSlide ? "true" : undefined}
                    onClick={() => goToSlide(index)}
                    className={`h-1.5 rounded-full transition-all ${
                      index === activeSlide ? "w-4 bg-white" : "w-1.5 bg-white/60 hover:bg-white"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
          {currentSlide.caption && (
            <span className="absolute bottom-0 left-0 max-w-full bg-black/55 px-2 py-1 text-xs text-white">
              {currentSlide.caption}
            </span>
          )}
          {photoLoadFailed && (
            <span role="status" className="absolute bottom-0 right-0 bg-black/65 px-2 py-1 text-[10px] text-white">
              More photos unavailable
            </span>
          )}
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground" aria-label="No room photos">
          {photoLoadFailed ? (
            <span role="status" className="text-xs">Room photos unavailable</span>
          ) : (
            <ImageIcon size={24} />
          )}
        </div>
      )}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        {currentSlide && (
          <DialogContent className="max-h-[95vh] w-[calc(100vw-1.5rem)] max-w-6xl gap-3 overflow-hidden p-3 sm:p-5">
            <DialogTitle className="sr-only">Room {roomNumber} photo</DialogTitle>
            <DialogDescription className="sr-only">{currentSlide.caption}</DialogDescription>
            <div className="relative flex max-h-[78vh] items-center justify-center overflow-hidden rounded-md bg-black/95">
              <img
                key={currentSlide.src}
                src={currentSlide.src}
                alt={`Room ${roomNumber}: ${currentSlide.caption}`}
                className="max-h-[78vh] w-full object-contain transition-transform duration-200"
                style={{ transform: `scale(${zoomLevel})` }}
                draggable={false}
              />
              {slideCount > 1 && (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label="Previous room photo"
                    className="absolute left-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border border-white/20 bg-white/95 text-black shadow-lg hover:bg-white"
                    onClick={() => moveSlide(-1)}
                  >
                    <ChevronLeft size={20} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label="Next room photo"
                    className="absolute right-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border border-white/20 bg-white/95 text-black shadow-lg hover:bg-white"
                    onClick={() => moveSlide(1)}
                  >
                    <ChevronRight size={20} />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm text-muted-foreground">
                {currentSlide.caption}{slideCount > 1 ? ` · ${activeSlide + 1}/${slideCount}` : ""}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Zoom out"
                  disabled={zoomLevel <= 1}
                  onClick={() => setZoomLevel((level) => Math.max(1, level - 0.5))}
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
                  onClick={() => setZoomLevel((level) => Math.min(3, level + 0.5))}
                >
                  <ZoomIn size={16} />
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
