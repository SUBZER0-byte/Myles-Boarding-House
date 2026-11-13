import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { ArrowDown, ArrowUp, Image as ImageIcon, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  addMyAdminRoomPhoto,
  deleteMyAdminRoomPhoto,
  getAdminRoomPhotoUrl,
  getMyAdminRoomPhotos,
  moveMyAdminRoomPhoto,
  saveMyAdminRoomPhotoCaption,
} from "@/lib/adminRooms";

const PHOTO_LABELS = ["Whole room", "Bed", "Table", "Window", "Drawer", "Closet", "Bathroom", "Balcony", "Desk"];
const MAX_PHOTOS_PER_ROOM = 12;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface RoomPhoto {
  image_id: number;
  filename: string;
  caption: string;
  sort_order: number;
}

interface PendingPhoto {
  id: number;
  file: File;
  caption: string;
  preview: string;
}

interface PhotoUploadError {
  index: number;
  filename: string;
  message: string;
}

interface PhotoUploadResult {
  failedCount: number;
  errors: PhotoUploadError[];
}

export interface RoomPhotosManagerHandle {
  savePendingCaptions: () => Promise<boolean>;
  uploadPending: (roomId: number) => Promise<PhotoUploadResult>;
}

interface RoomPhotosManagerProps {
  roomId: number | null;
  enabled: boolean;
  disabled?: boolean;
  onPendingChange?: (pending: { file: File; caption: string }[]) => void;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

function photoUrl(filename: string): string {
  return getAdminRoomPhotoUrl(filename);
}

export const RoomPhotosManager = forwardRef<RoomPhotosManagerHandle, RoomPhotosManagerProps>(
  ({ roomId, enabled, disabled = false, onPendingChange }, ref) => {
    const { toast } = useToast();
    const [photos, setPhotos] = useState<RoomPhoto[]>([]);
    const [pending, setPending] = useState<PendingPhoto[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
    const [savingCaptions, setSavingCaptions] = useState<number[]>([]);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const previewUrls = useRef(new Set<string>());
    const nextPendingId = useRef(0);
    const photoLoadRequest = useRef(0);
    const captionSaveTasks = useRef(new Map<number, Promise<boolean>>());
    const persistedCaptions = useRef(new Map<number, string>());
    const dirtyCaptions = useRef(new Map<number, string>());
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const revokePreview = useCallback((url: string) => {
      if (previewUrls.current.delete(url)) URL.revokeObjectURL(url);
    }, []);

    const clearPending = useCallback(() => {
      setPending((current) => {
        current.forEach((photo) => revokePreview(photo.preview));
        return [];
      });
    }, [revokePreview]);

    const loadPhotos = useCallback(async (id: number) => {
      if (!enabledRef.current) return;
      const requestId = ++photoLoadRequest.current;
      const isCurrent = () => enabledRef.current && requestId === photoLoadRequest.current;
      setLoading(true);
      setPhotoLoadFailed(false);
      try {
        const loadedPhotos = await getMyAdminRoomPhotos(id);
        if (isCurrent()) {
          persistedCaptions.current = new Map(loadedPhotos.map((photo) => [photo.image_id, photo.caption || ""]));
          setPhotos(loadedPhotos.map((photo) => ({
            ...photo,
            caption: dirtyCaptions.current.get(photo.image_id) ?? photo.caption ?? "",
          })));
        }
      } catch (error: unknown) {
        if (isCurrent()) {
          setPhotoLoadFailed(true);
          toast({
            title: "Could not load room photos",
            description: errorMessage(error),
            variant: "destructive",
          });
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }, [toast]);

    useEffect(() => {
      if (!enabled) {
        photoLoadRequest.current++;
        setPhotos([]);
        clearPending();
        setSavingCaptions([]);
        setUploading(false);
        setLoading(false);
        setPhotoLoadFailed(false);
        persistedCaptions.current.clear();
        dirtyCaptions.current.clear();
        return;
      }
      if (!roomId) {
        setPhotos([]);
        setLoading(false);
        return;
      }
      void loadPhotos(roomId);
    }, [clearPending, enabled, loadPhotos, roomId]);

    useEffect(() => {
      onPendingChange?.(pending.map(({ file, caption }) => ({ file, caption })));
    }, [onPendingChange, pending]);

    useEffect(() => () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.clear();
    }, []);

    const uploadPending = useCallback(async (targetRoomId: number): Promise<PhotoUploadResult> => {
      if (pending.length === 0) return { failedCount: 0, errors: [] };

      setUploading(true);
      try {
        const failedIndexes = new Set<number>();
        const errors: PhotoUploadError[] = [];
        for (const [index, photo] of pending.entries()) {
          try {
            await addMyAdminRoomPhoto(targetRoomId, photo.file, photo.caption, photos.length + index);
          } catch (error: unknown) {
            failedIndexes.add(index);
            errors.push({
              index,
              filename: photo.file.name,
              message: errorMessage(error),
            });
          }
        }

        const failed = pending.filter((_, index) => failedIndexes.has(index));
        const succeeded = pending.filter((_, index) => !failedIndexes.has(index));
        succeeded.forEach((photo) => revokePreview(photo.preview));
        setPending(failed);
        await loadPhotos(targetRoomId);
        return { failedCount: failed.length, errors };
      } catch (error: unknown) {
        const message = errorMessage(error);
        return {
          failedCount: pending.length,
          errors: pending.map((photo, index) => ({
            index,
            filename: photo.file.name,
            message,
          })),
        };
      } finally {
        setUploading(false);
      }
    }, [loadPhotos, pending, photos.length, revokePreview]);

    const pickPhotos = (files: FileList | null) => {
      if (!files) return;
      const available = Math.max(0, MAX_PHOTOS_PER_ROOM - photos.length - pending.length);
      const accepted: File[] = [];
      const skipped: string[] = [];

      Array.from(files).forEach((file) => {
        if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
          skipped.push(`${file.name}: use JPG, PNG, or WEBP`);
        } else if (accepted.length >= available) {
          skipped.push(`${file.name}: the room photo limit is 12`);
        } else {
          accepted.push(file);
        }
      });

      if (skipped.length > 0) {
        toast({
          title: "Some photos were skipped",
          description: skipped.join("; "),
          variant: "destructive",
        });
      }
      if (accepted.length === 0) return;

      const shouldLabelFirst = photos.length === 0 && pending.length === 0;
      const additions = accepted.map((file, index) => {
        const preview = URL.createObjectURL(file);
        previewUrls.current.add(preview);
        nextPendingId.current += 1;
        return {
          id: nextPendingId.current,
          file,
          caption: shouldLabelFirst && index === 0 ? "Whole room" : "",
          preview,
        };
      });
      setPending((current) => [...current, ...additions]);
    };

    const updatePendingCaption = (id: number, caption: string) => {
      setPending((current) => current.map((photo) => photo.id === id ? { ...photo, caption } : photo));
    };

    const removePending = (id: number) => {
      setPending((current) => {
        const removed = current.find((photo) => photo.id === id);
        if (removed) revokePreview(removed.preview);
        return current.filter((photo) => photo.id !== id);
      });
    };

    const saveCaption = useCallback((photo: RoomPhoto): Promise<boolean> => {
      const caption = dirtyCaptions.current.get(photo.image_id);
      if (caption === undefined) return Promise.resolve(true);
      const existingTask = captionSaveTasks.current.get(photo.image_id);
      if (existingTask) return existingTask;

      setSavingCaptions((current) => [...current, photo.image_id]);
      const task = (async () => {
        try {
          await saveMyAdminRoomPhotoCaption(photo.image_id, caption);
          if (enabledRef.current) {
            persistedCaptions.current.set(photo.image_id, caption);
            if (dirtyCaptions.current.get(photo.image_id) === caption) {
              dirtyCaptions.current.delete(photo.image_id);
            }
          }
          return true;
        } catch (error: unknown) {
          toast({
            title: "Could not save photo label",
            description: errorMessage(error),
            variant: "destructive",
          });
          return false;
        }
      })();
      captionSaveTasks.current.set(photo.image_id, task);
      void task.finally(() => {
        if (captionSaveTasks.current.get(photo.image_id) === task) {
          captionSaveTasks.current.delete(photo.image_id);
        }
        setSavingCaptions((current) => current.filter((id) => id !== photo.image_id));
      });
      return task;
    }, [toast]);

    const savePendingCaptions = useCallback(async () => {
      const activeTasks = Array.from(captionSaveTasks.current.values());
      const retryTasks = Array.from(dirtyCaptions.current.keys()).map((imageId) => {
        const photo = photos.find((item) => item.image_id === imageId);
        return photo ? saveCaption(photo) : Promise.resolve(false);
      });
      const results = await Promise.all(Array.from(new Set([...activeTasks, ...retryTasks])));
      return results.every(Boolean);
    }, [photos, saveCaption]);

    useImperativeHandle(ref, () => ({ savePendingCaptions, uploadPending }), [savePendingCaptions, uploadPending]);

    const movePhoto = async (imageId: number, direction: "up" | "down") => {
      if (!roomId || disabled) return;
      try {
        await moveMyAdminRoomPhoto(imageId, direction);
        await loadPhotos(roomId);
      } catch (error: unknown) {
        toast({
          title: "Could not reorder photos",
          description: errorMessage(error),
          variant: "destructive",
        });
      }
    };

    const removePhoto = async (imageId: number) => {
      if (!roomId || disabled) return;
      try {
        await deleteMyAdminRoomPhoto(imageId);
        persistedCaptions.current.delete(imageId);
        dirtyCaptions.current.delete(imageId);
        await loadPhotos(roomId);
      } catch (error: unknown) {
        toast({
          title: "Could not remove photo",
          description: errorMessage(error),
          variant: "destructive",
        });
      }
    };

    const totalCount = photos.length + pending.length;

    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label>Room photos</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Add photos that show the whole room and its features: bed, table, window, drawer. Add a label to each one. Guests see them as a slideshow.
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{totalCount}/{MAX_PHOTOS_PER_ROOM} photos</span>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          disabled={disabled || uploading || loading}
          onClick={() => photoInputRef.current?.click()}
        >
          <ImagePlus size={16} />
          Select photos
        </Button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          disabled={disabled || uploading || loading}
          onChange={(event) => {
            pickPhotos(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading photos…
          </div>
        )}
        {photoLoadFailed && (
          <p className="text-xs text-destructive">
            Existing photos could not be loaded. You can still select files, but saving requires the Supabase room-management migration to be applied.
          </p>
        )}

        {totalCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((photo, index) => (
              <div key={photo.image_id} className="min-w-0 space-y-2 rounded-md border border-border p-2">
                {photoUrl(photo.filename) ? (
                  <img src={photoUrl(photo.filename)} alt={photo.caption || "Room photo"} className="h-28 w-full rounded object-cover" />
                ) : (
                  <div className="flex h-28 w-full items-center justify-center rounded bg-muted text-muted-foreground" aria-label="Room photo unavailable">
                    <ImageIcon size={20} />
                  </div>
                )}
                <Input
                  aria-label={`Label for photo ${index + 1}`}
                  value={photo.caption || ""}
                  placeholder="Add a label"
                  list="room-photo-labels"
                  maxLength={255}
                  disabled={disabled || savingCaptions.includes(photo.image_id)}
                  onChange={(event) => {
                    const caption = event.target.value;
                    const savedCaption = persistedCaptions.current.get(photo.image_id) ?? "";
                    if (caption === savedCaption) dirtyCaptions.current.delete(photo.image_id);
                    else dirtyCaptions.current.set(photo.image_id, caption);
                    setPhotos((current) => current.map((item) =>
                      item.image_id === photo.image_id ? { ...item, caption } : item
                    ));
                  }}
                  onBlur={() => void saveCaption(photo)}
                />
                <div className="flex justify-between gap-1">
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Move photo earlier"
                      disabled={disabled || index === 0}
                      onClick={() => void movePhoto(photo.image_id, "up")}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Move photo later"
                      disabled={disabled || index === photos.length - 1}
                      onClick={() => void movePhoto(photo.image_id, "down")}
                    >
                      <ArrowDown size={14} />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    aria-label="Remove photo"
                    disabled={disabled}
                    onClick={() => void removePhoto(photo.image_id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}

            {pending.map((photo, index) => (
              <div key={photo.id} className="min-w-0 space-y-2 rounded-md border border-dashed border-primary/50 p-2">
                <img src={photo.preview} alt={photo.caption || photo.file.name} className="h-28 w-full rounded object-cover" />
                <Input
                  aria-label={`Label for new photo ${index + 1}`}
                  value={photo.caption}
                  placeholder="Add a label"
                  list="room-photo-labels"
                  maxLength={255}
                  disabled={disabled || uploading}
                  onChange={(event) => updatePendingCaption(photo.id, event.target.value)}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">{photo.file.name}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-destructive"
                    aria-label="Remove selected photo"
                    disabled={disabled || uploading}
                    onClick={() => removePending(photo.id)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <datalist id="room-photo-labels">
          {PHOTO_LABELS.map((label) => <option key={label} value={label} />)}
        </datalist>
      </section>
    );
  }
);

RoomPhotosManager.displayName = "RoomPhotosManager";
