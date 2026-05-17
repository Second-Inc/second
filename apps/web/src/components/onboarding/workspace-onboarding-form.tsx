"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { navigateToResponseUrl } from "@/components/onboarding/onboarding-client-navigation";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export function WorkspaceOnboardingForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.reportValidity() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });

      if (!response.ok && !response.redirected) {
        throw new Error("workspace_submit_failed");
      }

      navigateToResponseUrl(response, "/onboarding/loader");
    } catch {
      setSubmitting(false);
      setError("Could not create workspace. Check the name and try again.");
    }
  }

  return (
    <form
      action="/api/onboarding/workspace"
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(event) => void submitWorkspace(event)}
    >
      <div className="p-0">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-name">Company name</FieldLabel>
            <Input
              id="workspace-name"
              name="workspaceName"
              autoFocus
              required
              minLength={2}
              maxLength={80}
              placeholder="Acme"
            />
            <FieldDescription>
              This becomes the workspace name and anchors the context research.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Separator />

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create company workspace"}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </form>
  );
}
