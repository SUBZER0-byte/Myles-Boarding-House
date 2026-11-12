import { useEffect, useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { API_BASE_URL, api } from "@/lib/api";

interface ProfilePictureCardProps {
  userId: number;
  currentPath?: string | null;
  endpoint: string;
  canUpload?: boolean;
  onUploaded: () => Promise<void> | void;
}

export function ProfilePictureCard({ userId, currentPath, endpoint, canUpload = true, onUploaded }: ProfilePictureCardProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = currentPath ? `${API_BASE_URL}/Config/profile_picture.php?user_id=${userId}&v=${encodeURIComponent(currentPath)}` : "";

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast({ title: "Profile picture must be JPG, PNG, or WEBP and 10MB or smaller", variant: "destructive" });
      return;
    }
    const formData = new FormData();
    formData.append("user_id", String(userId));
    formData.append("profile_picture", file);
    setUploading(true);
    try {
      const res = await api.post<{ type: string; message?: string }>(endpoint, formData, {
        headers: { "Content-Type": undefined },
      });
      toast({ title: res.data.message ?? "Profile picture updated", variant: res.data.type === "success" ? "default" : "destructive" });
      if (res.data.type === "success") await onUploaded();
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
          <p className="text-xs text-muted-foreground mt-2">JPG, PNG, or WEBP up to 10MB.</p>
        </div>}
      </div>
    </div>
  );
}
