import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordFieldsProps {
  idPrefix: string;
  newPassword: string;
  confirmPassword: string;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  currentPassword?: string;
  onCurrentPasswordChange?: (value: string) => void;
}

export function PasswordFields({
  idPrefix,
  newPassword,
  confirmPassword,
  onNewPasswordChange,
  onConfirmPasswordChange,
  currentPassword,
  onCurrentPasswordChange,
}: PasswordFieldsProps) {
  const [visibleFields, setVisibleFields] = useState({ current: false, next: false, confirm: false });

  const passwordInput = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    visible: boolean,
    toggleVisibility: () => void,
    autoComplete: "current-password" | "new-password",
    constraints?: { minLength: number; maxLength: number },
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={event => onChange(event.target.value)}
          required
          minLength={constraints?.minLength}
          maxLength={constraints?.maxLength}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={toggleVisibility}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {currentPassword !== undefined && onCurrentPasswordChange && passwordInput(
        `${idPrefix}-current-password`,
        "Current password",
        currentPassword,
        onCurrentPasswordChange,
        visibleFields.current,
        () => setVisibleFields(current => ({ ...current, current: !current.current })),
        "current-password",
      )}
      {passwordInput(
        `${idPrefix}-new-password`,
        "New password",
        newPassword,
        onNewPasswordChange,
        visibleFields.next,
        () => setVisibleFields(current => ({ ...current, next: !current.next })),
        "new-password",
        { minLength: 6, maxLength: 200 },
      )}
      {passwordInput(
        `${idPrefix}-confirm-password`,
        "Confirm new password",
        confirmPassword,
        onConfirmPasswordChange,
        visibleFields.confirm,
        () => setVisibleFields(current => ({ ...current, confirm: !current.confirm })),
        "new-password",
        { minLength: 6, maxLength: 200 },
      )}
      <p className="text-xs text-muted-foreground">Password must be 6–200 characters long.</p>
    </div>
  );
}
