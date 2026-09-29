import { describe, expect, test } from "bun:test";

import { buildQwenImagePrompt } from "./workflow.ts";

describe("buildQwenImagePrompt", () => {
  test("place le prompt et le négatif sur le nœud 484", () => {
    const graph = buildQwenImagePrompt({
      prompt: "a red kettle",
      negativePrompt: "blur",
    });

    expect(graph["484"]?.class_type).toBe("TextEncodeQwenImage21");
    expect(graph["484"]?.inputs.prompt).toBe("a red kettle");
    expect(graph["484"]?.inputs.negative_prompt).toBe("blur");
    expect(graph["484"]?.inputs.clip).toEqual(["485", 0]);
  });

  test("ne reprend pas control_after_generate, réservé à l'éditeur", () => {
    const graph = buildQwenImagePrompt({
      prompt: "cat",
      negativePrompt: "",
    });

    expect(graph["489"]?.inputs).not.toHaveProperty("control_after_generate");
    expect(graph["489"]?.inputs.seed).toBe(0);
    expect(graph["489"]?.inputs.cfg).toBe(1);
    expect(graph["461"]?.inputs["format.bit_depth"]).toBe("8-bit");
  });
});
