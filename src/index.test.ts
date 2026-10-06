import { expect, test } from "bun:test";

import {
  Aspect,
  DEFAULT_SERVER,
  KREA2_DEFAULTS,
  QWEN_IMAGE_DEFAULTS,
  Sampler,
  Scheduler,
  buildKrea2Prompt,
  generateKrea2,
  readPngMetadata,
  readPngMetadataFile,
} from "./index.ts";

test("l'entrée du paquet expose l'API publique", () => {
  expect(Sampler.Euler).toBe("euler");
  expect(Aspect.Standard).toBe("4:3 (Standard)");
  expect(Scheduler.Simple).toBe("simple");
  expect(DEFAULT_SERVER).toBe("http://127.0.0.1:8188");
  expect(QWEN_IMAGE_DEFAULTS.steps).toBe(25);
  expect(KREA2_DEFAULTS.unetName).toBe("museByStableYogi_v35Int8Extended.safetensors");
  expect(KREA2_DEFAULTS.cfg).toBe(1.5);
  expect(typeof buildKrea2Prompt).toBe("function");
  expect(typeof generateKrea2).toBe("function");
  expect(typeof readPngMetadata).toBe("function");
  expect(typeof readPngMetadataFile).toBe("function");
});
