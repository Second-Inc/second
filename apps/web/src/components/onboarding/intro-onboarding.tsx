"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const INTRO_PRIMARY_TEXT =
  "Ship agent-native internal software across your org — built for deep human and agent collaboration";
const INTRO_POINTS = [
  "Humans and agents collaborate in real-time on the same custom UIs",
  "Open-source — bring your own agent, run on your infra",
  "Security, permissions, approval flows, and audit logs built in",
];

function RevealedWords({
  text,
  delayOffset = 0,
}: {
  text: string;
  delayOffset?: number;
}) {
  const words = text.split(" ");

  return (
    <>
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          className="onboarding-word-reveal inline-block"
          style={{ animationDelay: `${220 + delayOffset + index * 55}ms` }}
        >
          {word}
          {index < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </>
  );
}

export function IntroOnboarding() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 3000);
    return () => window.clearTimeout(timeout);
  }, []);

  const continueToIdentity = useCallback(() => {
    document.dispatchEvent(
      new CustomEvent("second:onboarding-navigate", {
        detail: { href: "/onboarding/identity" },
      }),
    );
  }, []);

  useEffect(() => {
    if (!ready) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Enter") return;
      event.preventDefault();
      continueToIdentity();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [continueToIdentity, ready]);

  return (
    <div className="flex max-w-2xl flex-col items-start gap-8 text-left">
      <div className="text-base leading-7 sm:text-lg">
        <p className="text-foreground">
          <RevealedWords text={INTRO_PRIMARY_TEXT} />
        </p>
        <div className="mt-8 flex flex-col gap-3">
          {INTRO_POINTS.map((point, index) => (
            <div
              key={point}
              className="flex items-start gap-3 text-muted-foreground"
            >
              <span
                className="onboarding-word-reveal mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
                style={{ animationDelay: `${980 + index * 360}ms` }}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <RevealedWords
                  text={point}
                  delayOffset={980 + index * 360}
                />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className={
          ready
            ? "pointer-events-auto opacity-100 transition-opacity duration-500"
            : "pointer-events-none opacity-0"
        }
      >
        <Button type="button" variant="outline" onClick={continueToIdentity}>
          Continue
          <Kbd data-icon="inline-end" className="translate-x-0.5">
            ⏎
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
