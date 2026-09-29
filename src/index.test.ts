import { expect, test } from "bun:test";

import {
  Aspect,
  DEFAULT_SERVER,
  QWEN_IMAGE_DEFAULTS,
  Sampler,
  Scheduler,
} from "./index.ts";

test("l'entrée du paquet expose l'API publique", () => {
  expect(Sampler.Euler).toBe("euler");
  expect(Aspect.Standard).toBe("4:3 (Standard)");
  expect(Scheduler.Simple).toBe("simple");
  expect(DEFAULT_SERVER).toBe("http://127.0.0.1:8188");
  expect(QWEN_IMAGE_DEFAULTS.steps).toBe(25);
});
