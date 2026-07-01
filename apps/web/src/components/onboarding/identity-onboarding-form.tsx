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

type IdentityOnboardingFormProps = {
  defaultDisplayName?: string;
  defaultProfileRole?: string | null;
};

export function IdentityOnboardingForm({
  defaultDisplayName,
  defaultProfileRole,
}: IdentityOnboardingFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitIdentity(event: FormEvent<HTMLFormElement>) {
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
        throw new Error("identity_submit_failed");
      }

      navigateToResponseUrl(response, "/onboarding/workspace");
    } catch {
      setSubmitting(false);
      setError("Could not save identity. Check your details and try again.");
    }
  }

  return (
    <form
      action="/api/onboarding/identity"
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(event) => void submitIdentity(event)}
    >
      <div className="p-0">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            <Input
              id="display-name"
              name="displayName"
              autoComplete="name"
              autoFocus
              required
              minLength={2}
              maxLength={80}
              placeholder="Ada Lovelace"
              defaultValue={defaultDisplayName}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="profile-role">Your role</FieldLabel>
            <Input
              id="profile-role"
              name="profileRole"
              autoComplete="organization-title"
              maxLength={80}
              placeholder="Head of Operations"
              defaultValue={defaultProfileRole ?? undefined}
            />
            <FieldDescription>
              Optional, but helpful for the first build.
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
          {submitting ? "Saving..." : "Continue"}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </form>
  );
}
