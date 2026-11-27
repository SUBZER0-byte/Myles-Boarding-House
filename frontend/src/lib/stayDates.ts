import { addMonths, differenceInCalendarMonths, format } from "date-fns";

export function calculateMoveOutDate(moveInDate: string, stayMonths: number): string {
  if (!moveInDate || !Number.isInteger(stayMonths) || stayMonths < 1) return "";
  const moveIn = new Date(`${moveInDate}T00:00:00`);
  if (Number.isNaN(moveIn.getTime()) || format(moveIn, "yyyy-MM-dd") !== moveInDate) return "";
  const moveOut = addMonths(moveIn, stayMonths);
  if (Number.isNaN(moveOut.getTime())) return "";
  const formattedMoveOut = format(moveOut, "yyyy-MM-dd");
  return /^\d{4}-\d{2}-\d{2}$/.test(formattedMoveOut) ? formattedMoveOut : "";
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

  const monthDifference = differenceInCalendarMonths(moveOut, moveIn);
  const months = Math.max(1, monthDifference);
  return String(addMonths(moveIn, months) < moveOut ? months + 1 : months);
}
