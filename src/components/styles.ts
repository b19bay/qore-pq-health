/** Shared inline styles (the scaffold ships no CSS framework). */
import type { CSSProperties } from "react";

export const card: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "1rem",
  marginTop: "1rem",
};

export const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  flexWrap: "wrap",
};

export const input: CSSProperties = {
  flex: 1,
  minWidth: 260,
  padding: "0.5rem",
  fontFamily: "monospace",
  fontSize: "0.9rem",
};

export const button: CSSProperties = {
  padding: "0.5rem 1rem",
  cursor: "pointer",
};

export const mono: CSSProperties = {
  fontFamily: "monospace",
  overflowWrap: "anywhere",
};

export const pre: CSSProperties = {
  ...mono,
  background: "#f6f6f6",
  padding: "0.75rem",
  borderRadius: 6,
  whiteSpace: "pre-wrap",
  fontSize: "0.85rem",
};

export const muted: CSSProperties = { color: "#555", fontSize: "0.9rem" };

export const errorText: CSSProperties = { color: "#a00" };

export const warnBox: CSSProperties = {
  background: "#fff4d6",
  border: "1px solid #e6c200",
  borderRadius: 6,
  padding: "0.75rem",
  marginTop: "0.75rem",
};

export const okBox: CSSProperties = {
  background: "#e8f7e8",
  border: "1px solid #4a4",
  borderRadius: 6,
  padding: "0.75rem",
  marginTop: "0.75rem",
};

export const gradeColors: Record<string, string> = {
  A: "#1a7f1a",
  B: "#3a8a2a",
  C: "#b58900",
  D: "#c65d00",
  E: "#c0392b",
  F: "#a00",
};
