"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col gap-4">
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
            <Upload />
          </div>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Import App
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Upload a Second app export ZIP to restore its files and builder
              chat into a new app in this workspace.
            </DialogDescription>
          </DialogHeader>

          <Button
            size="lg"
            className="w-full bg-foreground text-background hover:bg-foreground/80"
            onClick={() => {
              onOpenChange(false);
              onUpload();
            }}
          >
            <Upload data-icon="inline-start" />
            Upload ZIP
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
