import { ImagePreview } from "@/components/ImagePreview";
import type { ComplaintAttachment } from "@/lib/tenantRequests";

interface RequestAttachmentListProps {
  attachments?: ComplaintAttachment[];
}

export function RequestAttachmentList({ attachments = [] }: RequestAttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-3" aria-label="Complaint attachments">
      {attachments.map((attachment, index) => (
        attachment.type === "image" ? (
          <ImagePreview
            key={attachment.attachment_id}
            src={attachment.signed_url}
            alt={`Complaint image ${index + 1}`}
            triggerClassName="max-w-full overflow-hidden rounded-md border border-border"
            imageClassName="max-h-72 max-w-full object-contain"
          />
        ) : (
          <video
            key={attachment.attachment_id}
            controls
            preload="metadata"
            aria-label={`Complaint video ${index + 1}`}
            className="max-h-72 max-w-full rounded-md border border-border"
            src={attachment.signed_url}
          >
            Your browser does not support video playback.
          </video>
        )
      ))}
    </div>
  );
}
