export type ApplicationErrorOptions = {
  code: string;
  message: string;
  statusCode?: number;
};

export const LEGACY_CUSTOM_ERROR_CODE = "LEGACY_CUSTOM_ERROR";

export class ApplicationError extends Error {
  readonly code: string;
  readonly statusCode?: number;

  constructor({ code, message, statusCode }: ApplicationErrorOptions) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CustomError extends ApplicationError {
  constructor(message: string = "Interval Server Error", statusCode: number = 500) {
    super({
      code: LEGACY_CUSTOM_ERROR_CODE,
      message,
      statusCode,
    });
    this.name = "CustomError";
  }
}
