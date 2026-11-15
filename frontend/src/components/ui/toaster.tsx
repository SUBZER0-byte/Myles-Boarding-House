import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const isError = props.variant === "destructive";

        return (
          <Toast key={id} {...props}>
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm",
                  isError ? "bg-[#ef4444]" : "bg-[#f59e0b]",
                )}
              >
                {isError ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              </div>
              <div className="grid min-w-0 gap-0.5">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
