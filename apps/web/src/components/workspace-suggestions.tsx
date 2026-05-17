"use client";

import {
  Target,
  Telescope,
  UserPlus,
  CalendarCheck,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

type Suggestion = {
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
};

const suggestions: Suggestion[] = [
  {
    icon: Target,
    title: "Lead Enrichment",
    description: "Enrich CRM leads with company and contact data",
    prompt:
      "Build a lead enrichment tool that pulls company info, contact details, and social profiles from public sources to automatically fill in missing CRM fields",
  },
  {
    icon: Telescope,
    title: "Competitor Research",
    description: "Track competitor pricing and product changes",
    prompt:
      "Build a competitor research agent that monitors competitor websites, pricing changes, and product updates, then delivers weekly insight reports",
  },
  {
    icon: UserPlus,
    title: "Employee Onboarding",
    description: "Automate new-hire checklists and approvals",
    prompt:
      "Build an employee onboarding workflow that guides new hires through IT setup, document signing, and team introductions with automated checklists",
  },
  {
    icon: CalendarCheck,
    title: "Meeting Prep Agent",
    description: "Compile attendee context before every meeting",
    prompt:
      "Build a meeting prep agent that gathers attendee bios, recent emails, and relevant documents before each calendar event",
  },
];

type WorkspaceSuggestionsProps = {
  onSelect: (prompt: string) => void;
};

export function WorkspaceSuggestions({ onSelect }: WorkspaceSuggestionsProps) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs/relaxed text-muted-foreground">
          or try a suggestion
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((item) => (
          <button
            key={item.title}
            type="button"
            className="text-left"
            onClick={() => onSelect(item.prompt)}
          >
            <Card
              size="sm"
              className="group h-full bg-transparent ring-0 transition-all hover:bg-accent/50 hover:ring-1 hover:ring-foreground/10"
            >
              <CardHeader className="flex items-start gap-2.5">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
                  <item.icon
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-xs">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {item.description}
                  </CardDescription>
                </div>
                <ArrowRight
                  className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  strokeWidth={2}
                />
              </CardHeader>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
