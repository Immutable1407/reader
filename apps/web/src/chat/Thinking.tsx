import { useEffect, useState } from "react";
import { ChatDisclosure } from "./ChatDisclosure";

export function Thinking({
  text,
  active,
  incomplete = false,
}: {
  text: string;
  active: boolean;
  incomplete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return (
    <ChatDisclosure
      open={open}
      onOpenChange={setOpen}
      active={active}
      className="chat-thinking"
      label={
        active ? "正在思考…" : incomplete ? "思考过程（未完成）" : "思考过程"
      }
    >
      {text}
    </ChatDisclosure>
  );
}
