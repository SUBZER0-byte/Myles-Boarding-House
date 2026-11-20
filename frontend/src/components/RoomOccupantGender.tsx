import type { OccupantGender } from "@/lib/publicRooms";

interface RoomOccupantGenderProps {
  genders: OccupantGender[] | undefined;
  className?: string;
}

export function RoomOccupantGender({ genders, className = "" }: RoomOccupantGenderProps) {
  if (!genders?.length) return null;

  return (
    <p className={`text-xs text-muted-foreground ${className}`.trim()}>
      Registered occupant gender(s): {genders.join(", ")}
    </p>
  );
}
