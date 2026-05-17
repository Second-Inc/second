"use client";

import { memo } from "react";
import {
  BookOpenIcon,
  CheckIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { Badge } from "@/components/ui/badge";

type SkillToolCardProps = {
  input: Record<string, unknown> | undefined;
  isRunning: boolean;
  isDone: boolean;
};

function skillName(input: Record<string, unknown> | undefined): string {
  const candidates = [
    input?.skill,
    input?.skillName,
    input?.skill_name,
    input?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "skill";
}

function skillLabel(name: string): string {
  if (name === "add-integrations") return "integration skill";
  return name.replace(/[-_]+/g, " ");
}

function skillStatusText(name: string, label: string, isRunning: boolean): string {
  if (name === "add-integrations") {
    return isRunning ? "Using integration skill" : "Used integration skill";
  }

  return `${isRunning ? "Reading" : "Read"} ${label}`;
}

export const SkillToolCard = memo(function SkillToolCard({
  input,
  isRunning,
  isDone,
}: SkillToolCardProps) {
  const name = skillName(input);
  const label = skillLabel(name);

  return (
    <div className="not-prose flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {isRunning ? (
        <AppLoader size="xs" />
      ) : (
        <BookOpenIcon className="size-4" />
      )}
      <span className="text-foreground/85">
        {skillStatusText(name, label, isRunning)}
      </span>
      <Badge variant="outline" className="font-mono">
        {name}
      </Badge>
      {isDone ? (
        <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : null}
    </div>
  );
});
