import { expect, test } from "bun:test";

import {
  Aspect,
  DEFAULT_SERVER,
  FRAME_INTERPOLATION_DEFAULTS,
  KREA2_DEFAULTS,
  MINIMAX_MUSIC3_DEFAULTS,
  QWEN_IMAGE_DEFAULTS,
  SEEDVR2_DEFAULTS,
  SEEDVR2_VIDEO_DEFAULTS,
  Sampler,
  Scheduler,
  buildKrea2Prompt,
  buildMiniMaxMusic3Prompt,
  buildWan22Prompt,
  generateFrameInterpolation,
  generateKrea2,
  generateMiniMaxMusic3,
  generateSeedVR2Upscale,
  generateSeedVR2VideoUpscale,
  generateWan22,
  readMp3Metadata,
  readMp3MetadataFile,
  readPngMetadata,
  readPngMetadataFile,
  runGraph,
  silentLogger,
  type Logger,
} from "./index.ts";

test("l'entrée du paquet expose l'API publique", () => {
  expect(Sampler.Euler).toBe("euler");
  expect(Aspect.Standard).toBe("4:3 (Standard)");
  expect(Scheduler.Simple).toBe("simple");
  expect(DEFAULT_SERVER).toBe("http://127.0.0.1:8188");
  expect(typeof runGraph).toBe("function");
  expect(QWEN_IMAGE_DEFAULTS.steps).toBe(25);
  expect(KREA2_DEFAULTS.unetName).toBe("museByStableYogi_v35Int8Extended.safetensors");
  expect(KREA2_DEFAULTS.cfg).toBe(1.5);
  expect(typeof buildKrea2Prompt).toBe("function");
  expect(typeof generateKrea2).toBe("function");
  expect(typeof readPngMetadata).toBe("function");
  expect(typeof readPngMetadataFile).toBe("function");
  expect(typeof readMp3Metadata).toBe("function");
  expect(typeof readMp3MetadataFile).toBe("function");
  expect(SEEDVR2_DEFAULTS.unetName).toBe("seedvr2_7b_int8_convrot.safetensors");
  expect(typeof generateSeedVR2Upscale).toBe("function");
  expect(SEEDVR2_VIDEO_DEFAULTS.framesPerChunk).toBe(33);
  expect(typeof generateSeedVR2VideoUpscale).toBe("function");
  expect(FRAME_INTERPOLATION_DEFAULTS.modelName).toBe("rife_v4.26.safetensors");
  expect(typeof generateFrameInterpolation).toBe("function");
  expect(typeof buildWan22Prompt).toBe("function");
  expect(typeof generateWan22).toBe("function");
  expect(MINIMAX_MUSIC3_DEFAULTS.steps).toBe(30);
  expect(typeof buildMiniMaxMusic3Prompt).toBe("function");
  expect(typeof generateMiniMaxMusic3).toBe("function");
  expect(() => silentLogger.log("rien")).not.toThrow();
});

test("console convient comme Logger", () => {
  const logger: Logger = console;
  expect(typeof logger.debug).toBe("function");
});
