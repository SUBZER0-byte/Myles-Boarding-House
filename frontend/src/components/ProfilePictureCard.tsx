import { useEffect, useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getProfilePictureUrl, uploadMyProfilePicture } from "@/lib/profileSettings";

interface ProfilePictureCardProps {
  userId: number;
  currentPath?: string | null;
  endpoint?: string;
  storageBacked?: boolean;
  canUpload?: boolean;
  onUploaded: () => Promise<void> | void;
}

export function ProfilePictureCard({ userId, currentPath, endpoint, storageBacked = false, canUpload = true, onUploaded }: ProfilePictureCardProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = getProfilePictureUrl(userId, currentPath);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const maxFileSize = storageBacked ? 5 : 10;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > maxFileSize * 1024 * 1024) {
      toast({ title: `Profile picture must be JPG, PNG, or WEBP and ${maxFileSize}MB or smaller`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      if (storageBacked) {
        await uploadMyProfilePicture(file, currentPath);
      } else {
        if (!endpoint) throw new Error("Profile picture upload endpoint is not configured.");
        const formData = new FormData();
        formData.append("user_id", String(userId));
        formData.append("profile_picture", file);
        const res = await api.post<{ type: string; message?: string }>(endpoint, formData, {
          headers: { "Content-Type": undefined },
        });
        if (res.data.type !== "success") throw new Error(res.data.message || "Profile picture upload failed.");
      }
      toast({ title: "Profile picture updated" });
      await onUploaded();
    } catch (error) {
      toast({
        title: "Unable to update profile picture",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4">
      <h2 className="font-semibold">Profile Picture</h2>
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 overflow-hidden rounded-full border border-border bg-muted flex items-center justify-center shrink-0">
          {imageUrl && !imageFailed ? <img src={imageUrl} alt="Profile" className="h-full w-full object-cover" onError={() => setImageFailed(true)} /> : <span className="text-2xl text-muted-foreground">?</span>}
        </div>
        {canUpload && <div>
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
            {uploading ? "Uploading..." : imageUrl ? "Change Picture" : "Upload Picture"}
          </Button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} />
          <p className="text-xs text-muted-foreground mt-2">JPG, PNG, or WEBP up to {storageBacked ? 5 : 10}MB.</p>
        </div>}
      </div>
    </div>
  );
}
