import type { HarborConfig } from "../../types";

export type ConfigFieldChange = (
  field: keyof HarborConfig,
  value:
    | HarborConfig[keyof HarborConfig]
    | ((prev: HarborConfig[keyof HarborConfig]) => HarborConfig[keyof HarborConfig]),
) => void;
