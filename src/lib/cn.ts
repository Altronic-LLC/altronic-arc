import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine clsx (conditional class strings) with tailwind-merge (deduplicates
 * conflicting Tailwind classes so "px-2 px-4" → "px-4"). Used everywhere
 * that needs dynamic classNames.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
