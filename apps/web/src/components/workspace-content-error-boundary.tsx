"use client";

import { type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RecoverableErrorBoundary } from "@/components/recoverable-error-boundary";

type WorkspaceContentErrorBoundaryProps = {
  children: ReactNode;
};

export function WorkspaceContentErrorBoundary({
  children,
}: WorkspaceContentErrorBoundaryProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <RecoverableErrorBoundary
      name="WorkspaceLayout.Content"
      resetKey={pathname}
      fallbackTitle="This page hit an error"
      fallbackDescription="The workspace shell is still usable. We sent the error report."
      onReset={() => router.refresh()}
    >
      {children}
    </RecoverableErrorBoundary>
  );
}
