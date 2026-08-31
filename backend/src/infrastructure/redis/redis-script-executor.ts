export type RedisEvalOptions = {
  keys: string[];
  arguments: string[];
};

export interface RedisScriptExecutor {
  readonly isReady?: boolean;
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
}
