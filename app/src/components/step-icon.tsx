import { ArrowUp, ArrowUpLeft, ArrowUpRight, ChevronsUp, CornerUpLeft, CornerUpRight, Flag } from "lucide-react";

import type { RouteStep } from "@/lib/routing";

type StepIconProps = {
  step: RouteStep;
  className?: string;
  strokeWidth?: number;
};

export function StepIcon({ step, className, strokeWidth }: StepIconProps) {
  const props = { className, strokeWidth, "aria-hidden": true };

  if (step.kind === "stairs") return <ChevronsUp {...props} />;
  if (step.kind === "arrive") return <Flag {...props} />;
  if (step.kind === "depart") return <ArrowUp {...props} />;

  switch (step.direction) {
    case "slight-left":
      return <ArrowUpLeft {...props} />;
    case "left":
    case "sharp-left":
      return <CornerUpLeft {...props} />;
    case "slight-right":
      return <ArrowUpRight {...props} />;
    case "right":
    case "sharp-right":
      return <CornerUpRight {...props} />;
    default:
      return <ArrowUp {...props} />;
  }
}
