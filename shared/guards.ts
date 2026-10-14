// Tiny runtime type guards, used to check data we don't control (TOML files,
// localStorage) before trusting its shape.

export const isStr = (v: unknown): v is string => typeof v === "string";
export const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
