export const ratingCategories = [
  "Room Comfort",
  "Cleanliness",
  "Facilities",
  "Safety & Security",
  "Maintenance & Repairs",
  "Location & Accessibility",
  "Value for Money",
  "Services",
  "Overall Satisfaction",
] as const;

export type RatingCategory = (typeof ratingCategories)[number];
