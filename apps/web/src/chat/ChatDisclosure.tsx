import type { ReactNode } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@neoread/ui/components/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@neoread/ui/components/collapsible";
import "./chat-process.css";

export function ChatDisclosure({
  label,
  active = false,
  open,
  onOpenChange,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={`chat-process-section ${className}`}
    >
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" />}
        className="chat-process-toggle"
        title={label}
      >
        <ChevronRight
          className={`size-3.5 chat-process-chevron${open ? " rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span className="chat-process-label">{label}</span>
        {active && (
          <LoaderCircle
            className="size-3 chat-tool-spinner"
            aria-hidden="true"
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="chat-process-content">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
