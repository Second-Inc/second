"use client";

import { memo, useEffect, useRef, useState } from "react";
/** @paper-design/shaders-react@0.0.76 */
import { StaticMeshGradient } from "@paper-design/shaders-react";

export type OnboardingShaderStep =
  | "intro"
  | "identity"
  | "workspace"
  | "loader"
  | "provider"
  | "start";

const SHADER_STYLE = {
  height: "2329px",
  width: "1506px",
};

type ShaderState = {
  waveX: number;
  waveY: number;
  colors: string[];
};

const SHADER_TRANSITION_MS = 1900;
const STEP_SHADER_STATE: Record<OnboardingShaderStep, ShaderState> = {
  intro: {
    waveX: 0.51,
    waveY: 1,
    colors: ["#000000", "#082400", "#B1AA91", "#8E8C15"],
  },
  identity: {
    waveX: 0.3,
    waveY: 0.97,
    colors: ["#000000", "#0A2602", "#B6B098", "#8E9019"],
  },
  workspace: {
    waveX: 0.42,
    waveY: 1.04,
    colors: ["#000000", "#062707", "#BBB49A", "#858B16"],
  },
  loader: {
    waveX: 0.58,
    waveY: 0.95,
    colors: ["#000000", "#092400", "#BFB393", "#968D18"],
  },
  provider: {
    waveX: 0.36,
    waveY: 1.06,
    colors: ["#000000", "#071F05", "#AAA891", "#818A16"],
  },
  start: {
    waveX: 0.5,
    waveY: 0.99,
    colors: ["#000000", "#0A2703", "#BCB79E", "#8E9419"],
  },
};

function easeOutSine(progress: number): number {
  return Math.sin((progress * Math.PI) / 2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const channelToHex = (channel: number) =>
    Math.round(channel).toString(16).padStart(2, "0");

  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function interpolateNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function interpolateColor(
  fromColor: string,
  toColor: string,
  progress: number,
): string {
  const from = hexToRgb(fromColor);
  const to = hexToRgb(toColor);

  return rgbToHex({
    r: interpolateNumber(from.r, to.r, progress),
    g: interpolateNumber(from.g, to.g, progress),
    b: interpolateNumber(from.b, to.b, progress),
  });
}

function interpolateColors(
  fromColors: string[],
  toColors: string[],
  progress: number,
): string[] {
  return toColors.map((toColor, index) =>
    interpolateColor(fromColors[index] ?? toColor, toColor, progress),
  );
}

function interpolateShaderState(
  fromState: ShaderState,
  toState: ShaderState,
  progress: number,
): ShaderState {
  return {
    waveX: interpolateNumber(fromState.waveX, toState.waveX, progress),
    waveY: interpolateNumber(fromState.waveY, toState.waveY, progress),
    colors: interpolateColors(fromState.colors, toState.colors, progress),
  };
}

function shaderStateMatches(fromState: ShaderState, toState: ShaderState) {
  return (
    Math.abs(fromState.waveX - toState.waveX) < 0.001 &&
    Math.abs(fromState.waveY - toState.waveY) < 0.001 &&
    fromState.colors.every((color, index) => color === toState.colors[index])
  );
}

/**
 * from Paper
 * https://app.paper.design/file/01K8KYS2WFV3EMJGK3521HWRNH/01K8KYS2WFJ5PPJFB0YACZVE78/4-0
 * on Apr 21, 2026
 */
function OnboardingShaderImpl({
  step = "intro",
}: {
  step?: OnboardingShaderStep;
}) {
  const targetShaderState = STEP_SHADER_STATE[step];
  const animationFrameRef = useRef<number | null>(null);
  const shaderStateRef = useRef<ShaderState>(targetShaderState);
  const [shaderState, setShaderState] =
    useState<ShaderState>(targetShaderState);

  useEffect(() => {
    const fromShaderState = shaderStateRef.current;

    if (shaderStateMatches(fromShaderState, targetShaderState)) return;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    const startedAt = performance.now();

    const animateShader = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / SHADER_TRANSITION_MS);
      const easedProgress = easeOutSine(progress);
      const nextShaderState = interpolateShaderState(
        fromShaderState,
        targetShaderState,
        easedProgress,
      );

      shaderStateRef.current = nextShaderState;
      setShaderState(nextShaderState);

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animateShader);
        return;
      }

      shaderStateRef.current = targetShaderState;
      setShaderState(targetShaderState);
      animationFrameRef.current = null;
    };

    animationFrameRef.current = window.requestAnimationFrame(animateShader);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [targetShaderState]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2"
        style={{ transform: "translate(-50%, -50%) scale(0.56)" }}
      >
        <StaticMeshGradient
          scale={1}
          rotation={0}
          positions={42}
          waveX={shaderState.waveX}
          waveXShift={0}
          waveY={shaderState.waveY}
          waveYShift={0}
          mixing={0}
          grainMixer={0.37}
          grainOverlay={0.78}
          colors={shaderState.colors}
          style={SHADER_STYLE}
        />
      </div>
    </div>
  );
}

export const OnboardingShader = memo(OnboardingShaderImpl);
