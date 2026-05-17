"use client";

import { useEffect, useRef, useState } from "react";
import { AppComposer } from "./app-composer";
import { WorkspaceSuggestions } from "./workspace-suggestions";

const titleWords = ["Build", "something", "beautiful."];

export function WorkspaceHome({
  workspaceId,
  initialPrompt = "",
  initialAgentId = null,
  initialAgent = null,
}: {
  workspaceId: string;
  initialPrompt?: string;
  initialAgentId?: string | null;
  initialAgent?: { _id: string; displayName: string } | null;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!initialPrompt) return;

    const frame = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(initialPrompt.length, initialPrompt.length);
    });

    return () => cancelAnimationFrame(frame);
  }, [initialPrompt]);

  const handleSuggestionSelect = (text: string) => {
    setPrompt(text);
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    }, 0);
  };

  const suggestionsVisible = prompt.length === 0;

  return (
    <div className="flex w-full flex-col items-center">
      <h1
        className="text-2xl tracking-tight"
        style={{
          fontFamily: "AlphaLyrae, sans-serif",
          fontFeatureSettings: '"calt" 1',
          // WebkitTextStroke: "0.2px currentColor",
        }}
      >
        {titleWords.map((word, i) => (
          <span
            key={i}
            className="inline-block opacity-0 animate-fade-in-up"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {word}
            {i < titleWords.length - 1 ? "\u00A0" : ""}
          </span>
        ))}
      </h1>

      <div
        className="mt-10 w-full opacity-0 animate-fade-in-up"
        style={{ animationDelay: "650ms" }}
      >
        <AppComposer
          workspaceId={workspaceId}
          value={prompt}
          onChange={setPrompt}
          textareaRef={textareaRef}
          initialAgentId={initialAgentId}
          initialAgent={initialAgent}
        />
      </div>

      <div
        className="w-full opacity-0 animate-fade-in-up"
        style={{
          animationDelay: "1150ms",
          display: "grid",
          gridTemplateRows: suggestionsVisible ? "1fr" : "0fr",
          marginTop: suggestionsVisible ? "2.5rem" : 0,
          transition:
            "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1), margin-top 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              opacity: suggestionsVisible ? 1 : 0,
              transition: suggestionsVisible
                ? "opacity 150ms ease-out"
                : "opacity 100ms ease-out 100ms",
            }}
          >
            <WorkspaceSuggestions onSelect={handleSuggestionSelect} />
          </div>
        </div>
      </div>
    </div>
  );
}
