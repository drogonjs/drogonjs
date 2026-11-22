export class HttpException extends Error {
  public readonly status: number;
  public readonly response: Record<string, unknown> | string;
  public readonly cause?: unknown;

  constructor(status: number, response: Record<string, unknown> | string, options?: { cause?: unknown }) {
    const message = typeof response === 'string' ? response : ((response as any)?.message ?? `HTTP Exception ${status}`);
    super(message);
    this.name = 'HttpException';
    this.status = status;
    this.response = response;
    this.cause = options?.cause;
  }

  toJSON(): { statusCode: number; [key: string]: unknown } {
    if (typeof this.response === 'string') {
      return { statusCode: this.status, message: this.response };
    }
    return { statusCode: this.status, ...this.response };
  }

  getStatus(): number {
    return this.status;
  }

  getResponse(): Record<string, unknown> | string {
    return this.response;
  }

  static isHttpException(error: unknown): error is HttpException {
    return error instanceof HttpException;
  }
}

export class BadRequestException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Bad Request', options?: { cause?: unknown }) {
    super(400, response, options);
    this.name = 'BadRequestException';
  }
}

export class UnauthorizedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Unauthorized', options?: { cause?: unknown }) {
    super(401, response, options);
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Forbidden', options?: { cause?: unknown }) {
    super(403, response, options);
    this.name = 'ForbiddenException';
  }
}

export class NotFoundException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Not Found', options?: { cause?: unknown }) {
    super(404, response, options);
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Conflict', options?: { cause?: unknown }) {
    super(409, response, options);
    this.name = 'ConflictException';
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Unprocessable Entity', options?: { cause?: unknown }) {
    super(422, response, options);
    this.name = 'UnprocessableEntityException';
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Internal Server Error', options?: { cause?: unknown }) {
    super(500, response, options);
    this.name = 'InternalServerErrorException';
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Service Unavailable', options?: { cause?: unknown }) {
    super(503, response, options);
    this.name = 'ServiceUnavailableException';
  }
}

export class MethodNotAllowedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Method Not Allowed', options?: { cause?: unknown }) {
    super(405, response, options);
    this.name = 'MethodNotAllowedException';
  }
}

export class NotAcceptableException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Not Acceptable', options?: { cause?: unknown }) {
    super(406, response, options);
    this.name = 'NotAcceptableException';
  }
}

export class RequestTimeoutException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Request Timeout', options?: { cause?: unknown }) {
    super(408, response, options);
    this.name = 'RequestTimeoutException';
  }
}

export class GoneException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Gone', options?: { cause?: unknown }) {
    super(410, response, options);
    this.name = 'GoneException';
  }
}

export class PreconditionFailedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Precondition Failed', options?: { cause?: unknown }) {
    super(412, response, options);
    this.name = 'PreconditionFailedException';
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Payload Too Large', options?: { cause?: unknown }) {
    super(413, response, options);
    this.name = 'PayloadTooLargeException';
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Unsupported Media Type', options?: { cause?: unknown }) {
    super(415, response, options);
    this.name = 'UnsupportedMediaTypeException';
  }
}

export class ImATeapotException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'I\'m a teapot', options?: { cause?: unknown }) {
    super(418, response, options);
    this.name = 'ImATeapotException';
  }
}

export class MisdirectedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Misdirected', options?: { cause?: unknown }) {
    super(421, response, options);
    this.name = 'MisdirectedException';
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Too Many Requests', options?: { cause?: unknown }) {
    super(429, response, options);
    this.name = 'TooManyRequestsException';
  }
}

export class NotImplementedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Not Implemented', options?: { cause?: unknown }) {
    super(501, response, options);
    this.name = 'NotImplementedException';
  }
}

export class BadGatewayException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Bad Gateway', options?: { cause?: unknown }) {
    super(502, response, options);
    this.name = 'BadGatewayException';
  }
}

export class GatewayTimeoutException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'Gateway Timeout', options?: { cause?: unknown }) {
    super(504, response, options);
    this.name = 'GatewayTimeoutException';
  }
}

export class HttpVersionNotSupportedException extends HttpException {
  constructor(response: Record<string, unknown> | string = 'HTTP Version Not Supported', options?: { cause?: unknown }) {
    super(505, response, options);
    this.name = 'HttpVersionNotSupportedException';
  }
}
