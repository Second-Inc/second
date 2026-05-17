"use client";

import { createContext, useContext, useId } from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

type CollapsibleIdContextValue = { contentId: string };
const CollapsibleIdContext = createContext<CollapsibleIdContextValue | null>(
  null,
);

type CollapsibleProps = React.ComponentProps<
  typeof CollapsiblePrimitive.Root
> & {
  contentId?: string;
};

function Collapsible({ contentId: contentIdProp, ...props }: CollapsibleProps) {
  const generatedId = useId();
  const contentId =
    contentIdProp ?? `collapsible-${generatedId.replace(/:/g, "")}`;

  return (
    <CollapsibleIdContext.Provider value={{ contentId }}>
      <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
    </CollapsibleIdContext.Provider>
  );
}

function CollapsibleTrigger(
  props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>,
) {
  const context = useContext(CollapsibleIdContext);
  const ariaControls = props["aria-controls"] ?? context?.contentId;

  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
      aria-controls={ariaControls}
    />
  );
}

function CollapsibleContent(
  props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>,
) {
  const context = useContext(CollapsibleIdContext);
  const contentId = props.id ?? context?.contentId;

  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
      id={contentId}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
