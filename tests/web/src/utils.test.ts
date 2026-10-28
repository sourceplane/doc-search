import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("lib/utils.ts (upstream's)", () => {
  it("cn merges class names and lets the last tailwind utility win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});
