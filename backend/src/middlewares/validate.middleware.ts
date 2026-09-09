import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

type ValidatedRequestPart = "body" | "params" | "query";

export const validate = (
  schema: ZodTypeAny,
  requestPart: ValidatedRequestPart = "body",
) => (req: Request, _res: Response, next: NextFunction) => {
  try {
    const parsedValue = schema.parse(req[requestPart]);

    if (requestPart === "body") {
      req.body = parsedValue;
    } else {
      const requestValue = req[requestPart] as Record<string, unknown>;
      for (const key of Object.keys(requestValue)) {
        delete requestValue[key];
      }
      Object.assign(requestValue, parsedValue);
    }

    next();
  } catch (error) {
    next(error);
  }
};
