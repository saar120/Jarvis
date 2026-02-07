import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function escHtml(s: unknown): string {
  if (!s) return "";
  const str = typeof s === "string" ? s : JSON.stringify(s, null, 2);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Extract display text from a content field that may be a string or array of {type,text} blocks */
export function contentText(c: unknown): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c.map((b: { text?: string }) => b.text || "").join("\n");
  return JSON.stringify(c);
}
