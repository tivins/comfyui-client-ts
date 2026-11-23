/** Lien vers la sortie `slot` d'un nœud du graphe API. */
export type NodeRef = [string, number];

/**
 * Valeur de liste d'un widget (boîtes de `CreateBoundingBoxes`…). Envoyée nue, ComfyUI
 * prendrait la liste pour un lien `[nœud, sortie]` ; l'interface l'emballe aussi ainsi.
 */
export type ApiListValue = {__value__: unknown[]};

export type ApiInput = string | number | boolean | NodeRef | ApiListValue;

export type ApiNode = {
  class_type: string;
  inputs: Record<string, ApiInput>;
  _meta: Record<string, ApiInput>;
};

export type ApiPrompt = Record<string, ApiNode>;

function values<const T extends Record<string, string>>(record: T): T[keyof T][] {
  return Object.values(record) as T[keyof T][];
}

/** Ratios du nœud `ResolutionSelector`. La valeur est la chaîne envoyée à ComfyUI. */
export const Aspect = {
  Square: "1:1 (Square)",
  PortraitPhoto: "2:3 (Portrait Photo)",
  Photo: "3:2 (Photo)",
  PortraitStandard: "3:4 (Portrait Standard)",
  Standard: "4:3 (Standard)",
  PortraitWidescreen: "9:16 (Portrait Widescreen)",
  Widescreen: "16:9 (Widescreen)",
  Ultrawide: "21:9 (Ultrawide)",
} as const;

export type Aspect = (typeof Aspect)[keyof typeof Aspect];

export const ASPECT_RATIOS: Aspect[] = values(Aspect);

/** Noms de sampler du `KSampler`. La valeur est la chaîne envoyée à ComfyUI. */
export const Sampler = {
  Euler: "euler",
  EulerCfgPp: "euler_cfg_pp",
  EulerAncestral: "euler_ancestral",
  EulerAncestralCfgPp: "euler_ancestral_cfg_pp",
  Heun: "heun",
  Heunpp2: "heunpp2",
  ExpHeun2X0: "exp_heun_2_x0",
  ExpHeun2X0Sde: "exp_heun_2_x0_sde",
  Dpm2: "dpm_2",
  Dpm2Ancestral: "dpm_2_ancestral",
  Lms: "lms",
  DpmFast: "dpm_fast",
  DpmAdaptive: "dpm_adaptive",
  Dpmpp2sAncestral: "dpmpp_2s_ancestral",
  Dpmpp2sAncestralCfgPp: "dpmpp_2s_ancestral_cfg_pp",
  DpmppSde: "dpmpp_sde",
  DpmppSdeGpu: "dpmpp_sde_gpu",
  Dpmpp2m: "dpmpp_2m",
  Dpmpp2mCfgPp: "dpmpp_2m_cfg_pp",
  Dpmpp2mSde: "dpmpp_2m_sde",
  Dpmpp2mSdeGpu: "dpmpp_2m_sde_gpu",
  Dpmpp2mSdeHeun: "dpmpp_2m_sde_heun",
  Dpmpp2mSdeHeunGpu: "dpmpp_2m_sde_heun_gpu",
  Dpmpp3mSde: "dpmpp_3m_sde",
  Dpmpp3mSdeGpu: "dpmpp_3m_sde_gpu",
  Ddpm: "ddpm",
  Lcm: "lcm",
  Ipndm: "ipndm",
  IpndmV: "ipndm_v",
  Deis: "deis",
  CfgppUd10Ab: "cfgpp_ud10_ab",
  ResMultistep: "res_multistep",
  ResMultistepCfgPp: "res_multistep_cfg_pp",
  ResMultistepAncestral: "res_multistep_ancestral",
  ResMultistepAncestralCfgPp: "res_multistep_ancestral_cfg_pp",
  GradientEstimation: "gradient_estimation",
  GradientEstimationCfgPp: "gradient_estimation_cfg_pp",
  ErSde: "er_sde",
  Seeds2: "seeds_2",
  Seeds3: "seeds_3",
  SaSolver: "sa_solver",
  SaSolverPece: "sa_solver_pece",
  Ddim: "ddim",
  UniPc: "uni_pc",
  UniPcBh2: "uni_pc_bh2",
} as const;

export type Sampler = (typeof Sampler)[keyof typeof Sampler];

export const SAMPLER_NAMES: Sampler[] = values(Sampler);

/** Schedulers du `KSampler`. La valeur est la chaîne envoyée à ComfyUI. */
export const Scheduler = {
  Simple: "simple",
  SgmUniform: "sgm_uniform",
  Karras: "karras",
  Exponential: "exponential",
  DdimUniform: "ddim_uniform",
  Beta: "beta",
  Normal: "normal",
  LinearQuadratic: "linear_quadratic",
  KlOptimal: "kl_optimal",
} as const;

export type Scheduler = (typeof Scheduler)[keyof typeof Scheduler];

export const SCHEDULER_NAMES: Scheduler[] = values(Scheduler);

/** LoRA appliquée au modèle seul (`LoraLoaderModelOnly`). */
export type LoRA = {
    model: string;
    weight: number;
};

/**
 * Intercale des `LoraLoaderModelOnly` entre la sortie modèle du nœud `from`
 * et l'entrée `model` du nœud `to`. Les nœuds ajoutés prennent les ids
 * `firstId`, `firstId + 1`, … Sans LoRA, le graphe ne change pas.
 */
export function chainLoras(graph: ApiPrompt, loras: LoRA[], from: string, to: string, firstId: number): void {
    let previous = from;
    let id = firstId;
    for (const lora of loras) {
        graph[String(id)] = {
            inputs: {
                lora_name: lora.model,
                strength_model: lora.weight,
                model: [previous, 0]
            },
            class_type: "LoraLoaderModelOnly",
            _meta: {}
        };
        previous = String(id);
        id++;
    }
    graph[to]!.inputs.model = [previous, 0];
}

/**
 * Ajoute `meta` au `_meta` du nœud `id`. ComfyUI recopie le graphe, `_meta`
 * compris, dans le chunk `prompt` des fichiers produits : un workflow externe
 * peut s'en servir pour faire passer des informations d'une étape à l'autre.
 */
export function applyMeta(graph: ApiPrompt, id: string, meta: Record<string, ApiInput> | null): void {
    if (meta !== null) {
        graph[id]!._meta = {...graph[id]!._meta, ...meta};
    }
}
