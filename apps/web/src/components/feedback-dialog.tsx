"use client";

import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


const FEEDBACK_EMAIL = "feedback@second.so";

type FeedbackDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = body.trim().length > 0;

  const handleSendViaGmail = () => {
    const subject = encodeURIComponent("Second feedback");
    const encodedBody = encodeURIComponent(body.trim());
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&to=${FEEDBACK_EMAIL}&su=${subject}&body=${encodedBody}`,
      "_blank",
    );
    setBody("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setBody("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        {/* Banner */}
        <div className="flex items-center justify-center px-8 py-10 bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 dark:from-sky-950/30 dark:via-indigo-950/20 dark:to-violet-950/30">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
            <span className="text-2xl" aria-hidden="true">🙏</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Send us feedback
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Tell us what&apos;s on your mind &mdash; bugs, ideas, anything.
            </DialogDescription>
          </DialogHeader>

          <textarea
            ref={textareaRef}
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What could be better?"
            rows={5}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />

          <div className="flex items-center justify-start">
            <Button
              type="submit"
              size="lg"
              disabled={!canSend}
              className="bg-foreground text-background hover:bg-foreground/80"
              onClick={handleSendViaGmail}
            >
              Submit
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
