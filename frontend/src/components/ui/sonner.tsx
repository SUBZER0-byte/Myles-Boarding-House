import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:w-[min(92vw,360px)] group-[.toaster]:rounded-2xl group-[.toaster]:border group-[.toaster]:border-[#f3dfc0] group-[.toaster]:bg-[#fff7ef] group-[.toaster]:text-[#1f2a2d] group-[.toaster]:shadow-[0_12px_28px_rgba(15,23,42,0.18)] group-[.toaster]:p-0 group-[.toaster]:px-3 group-[.toaster]:py-2 group-[.toaster]:!bg-transparent group-[.toaster]:!border-0",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold",
          description: "group-[.toast]:text-xs group-[.toast]:text-[#475569]",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "group-[.toast]:hidden",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
