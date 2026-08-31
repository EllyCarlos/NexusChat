export type RedisEvalOptions = {
  keys: string[];
  arguments: string[];
};

export interface RedisScriptExecutor {
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
}
