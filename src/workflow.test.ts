import { describe, expect, test } from "bun:test";

import { Aspect, Sampler, Scheduler, applyMeta, chainLoras, type ApiPrompt } from "./workflow.ts";

describe("Sampler", () => {
  test("expose la chaîne attendue par ComfyUI", () => {
    expect(Aspect.Standard).toBe("4:3 (Standard)");
    expect(Sampler.Euler).toBe("euler");
    expect(Scheduler.Simple).toBe("simple");
    expect(Sampler.Dpmpp2m).toBe("dpmpp_2m");
    expect(Scheduler.Karras).toBe("karras");
  });
});

function twoNodes(): ApiPrompt {
  return {
    "1": { class_type: "UNETLoader", inputs: {}, _meta: { title: "UNET" } },
    "2": { class_type: "KSampler", inputs: { model: ["1", 0] }, _meta: {} },
  };
}

describe("applyMeta", () => {
  test("ajoute les clés au _meta existant", () => {
    const graph = twoNodes();
    applyMeta(graph, "1", { run: "a", step: 2 });
    expect(graph["1"]?._meta).toEqual({ title: "UNET", run: "a", step: 2 });
  });

  test("ne touche à rien sans meta", () => {
    const graph = twoNodes();
    applyMeta(graph, "1", null);
    expect(graph).toEqual(twoNodes());
  });
});

describe("chainLoras", () => {
  test("ne change pas le graphe sans LoRA", () => {
    const graph = twoNodes();
    chainLoras(graph, [], "1", "2", 10);
    expect(graph).toEqual(twoNodes());
  });
});
