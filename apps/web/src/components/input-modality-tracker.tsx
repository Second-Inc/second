"use client";

import { useEffect } from "react";

type InputModality = "keyboard" | "pointer";

const INPUT_MODALITY_ATTRIBUTE = "data-input-modality";

function setInputModality(modality: InputModality) {
  document.documentElement.setAttribute(INPUT_MODALITY_ATTRIBUTE, modality);
}

export function InputModalityTracker() {
  useEffect(() => {
    // Global input modality flag used by globals.css to gate focus rings.
    // To remove this behavior: delete this component, its mount in layout.tsx, and the related CSS rule.
    setInputModality("pointer");

    const handlePointerDown = () => {
      setInputModality("pointer");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      setInputModality("keyboard");
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
}
