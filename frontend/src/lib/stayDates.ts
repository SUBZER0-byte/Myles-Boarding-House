import { addMonths, format } from "date-fns";

export function calculateMoveOutDate(moveInDate: string, stayMonths: number): string {
  if (!moveInDate || !Number.isInteger(stayMonths) || stayMonths < 1) return "";
  const moveIn = new Date(`${moveInDate}T00:00:00`);
  if (Number.isNaN(moveIn.getTime()) || format(moveIn, "yyyy-MM-dd") !== moveInDate) return "";
  return format(addMonths(moveIn, stayMonths), "yyyy-MM-dd");
}

export function getStayMonths(moveInDate: string, moveOutDate: string | null | undefined): string {
  if (!moveInDate || !moveOutDate) return "";
  const moveIn = new Date(`${moveInDate}T00:00:00`);
  const moveOut = new Date(`${moveOutDate}T00:00:00`);
  if (
    Number.isNaN(moveIn.getTime())
    || Number.isNaN(moveOut.getTime())
    || format(moveIn, "yyyy-MM-dd") !== moveInDate
    || format(moveOut, "yyyy-MM-dd") !== moveOutDate
    || moveOut <= moveIn
  ) return "";

  const monthDifference = (moveOut.getFullYear() - moveIn.getFullYear()) * 12
    + moveOut.getMonth() - moveIn.getMonth();
  return String(Math.max(1, monthDifference + (moveOut.getDate() > moveIn.getDate() ? 1 : 0)));
}
