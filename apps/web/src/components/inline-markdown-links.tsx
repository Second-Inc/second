import type { ReactNode } from "react";
import {
  LinkChip,
  splitPipedLinkLabel,
} from "@/components/ai-elements/link-chip";

const INLINE_MARKDOWN_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;

export function InlineMarkdownLinks({
  text,
  className,
  linkClassName,
  strongClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
  strongClassName?: string;
}) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }

    const label = match[1];
    const url = match[2];
    const strongText = match[3];
    if (label && url) {
      if (splitPipedLinkLabel(label)) {
        parts.push(
          <LinkChip key={`${url}-${index}`} href={url}>
            {label}
          </LinkChip>,
        );
      } else {
        parts.push(
          <a
            key={`${url}-${index}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={
              linkClassName ??
              "text-foreground underline underline-offset-2 hover:text-foreground/80"
            }
          >
            {label}
          </a>,
        );
      }
    } else if (strongText) {
      parts.push(
        <strong
          key={`strong-${index}`}
          className={strongClassName ?? "font-medium text-foreground"}
        >
          {strongText}
        </strong>,
      );
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts.length ? parts : text}</span>;
}
