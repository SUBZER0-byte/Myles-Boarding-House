import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  variant?: "default" | "primary" | "success" | "warning";
}

const variantStyles = {
  default: "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 shadow-[0_14px_28px_rgba(15,23,42,0.04)] dark:border-border dark:from-card dark:via-card dark:to-card dark:shadow-black/10",
  primary: "border-orange-200 bg-gradient-to-br from-orange-50 via-white to-orange-50 shadow-[0_14px_28px_rgba(249,115,22,0.08)] dark:border-orange-400/20 dark:from-orange-950/30 dark:via-card dark:to-card",
  success: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 shadow-[0_14px_28px_rgba(16,185,129,0.08)] dark:border-emerald-400/20 dark:from-emerald-950/25 dark:via-card dark:to-card",
  warning: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 shadow-[0_14px_28px_rgba(245,158,11,0.08)] dark:border-amber-400/20 dark:from-amber-950/25 dark:via-card dark:to-card",
};

const iconVariantStyles = {
  default: "bg-slate-100 text-slate-600 dark:bg-secondary dark:text-secondary-foreground",
  primary: "bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300",
  success: "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
};

export function StatCard({ title, value, icon: Icon, trend, variant = "default" }: StatCardProps) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${variantStyles[variant]} animate-fade-in`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-display font-bold tracking-tight text-slate-800 dark:text-foreground">{value}</p>
          {trend && <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{trend}</p>}
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconVariantStyles[variant]}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}
