"use client";

import Image from "next/image";
import { ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SecondLogo } from "@/components/second-logo";

type ImportAppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: () => void;
};

export function ImportAppDialog({
  open,
  onOpenChange,
  onUpload,
}: ImportAppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        {/* Illustration banner */}
        <div className="relative flex items-center justify-center gap-5 px-8 py-10 bg-gradient-to-br from-orange-50 via-rose-50 to-violet-50 dark:from-orange-950/30 dark:via-rose-950/20 dark:to-violet-950/30">
          {/* Source platform icons – stacked vertically */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
              <Image
                src="/icons/lovable.svg"
                alt="Lovable"
                width={24}
                height={24}
                className="size-6"
              />
            </div>
            <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
              <Image
                src="/icons/base44-icon.svg"
                alt="Base44"
                width={24}
                height={24}
                className="size-6"
              />
            </div>
          </div>

          {/* Arrow */}
          <ArrowRight
            className="size-5 text-muted-foreground/60"
            strokeWidth={2}
          />

          {/* Second logo */}
          <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
            <SecondLogo className="size-6" />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Import an existing app
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Upload your project files from Lovable, Base44, or any other
              platform and we&apos;ll convert them into a Second app.
            </DialogDescription>
          </DialogHeader>

          <Button
            size="lg"
            className="mt-2 w-full bg-foreground text-background hover:bg-foreground/80"
            onClick={() => {
              onOpenChange(false);
              onUpload();
            }}
          >
            <Upload className="size-4" />
            Upload files
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
