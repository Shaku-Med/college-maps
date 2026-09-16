import { cardinal } from "@/lib/geo";
import type { RouteStep, TurnDirection } from "@/lib/routing";

const TURN_TEXT: Record<TurnDirection, string> = {
  straight: "Continue straight",
  "slight-left": "Bear left",
  left: "Turn left",
  "sharp-left": "Make a sharp left",
  "slight-right": "Bear right",
  right: "Turn right",
  "sharp-right": "Make a sharp right",
};

export function stepText(step: RouteStep, destination: string): string {
  switch (step.kind) {
    case "depart":
      return `Head ${cardinal(step.bearing ?? 0)}`;
    case "stairs":
      return "Take the stairs";
    case "arrive":
      return `Arrive at ${destination}`;
    case "turn":
      return TURN_TEXT[step.direction ?? "straight"];
  }
}
