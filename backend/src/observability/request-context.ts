import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  readonly requestId: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <Result>(
  context: RequestContext,
  callback: () => Result,
): Result => requestContextStorage.run(
  Object.freeze({ requestId: context.requestId }),
  callback,
);

export const getRequestContext = (): Readonly<RequestContext> | undefined =>
  requestContextStorage.getStore();

export const getRequestId = (): string | undefined =>
  getRequestContext()?.requestId;
