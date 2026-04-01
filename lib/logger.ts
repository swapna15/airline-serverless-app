import { randomUUID } from 'crypto'

export interface LogFields {
  correlationId?: string
  userId?: string
  duration?: number
  [key: string]: unknown
}

/**
 * Emits a structured JSON log entry to stdout.
 * Always includes correlationId and duration if provided.
 */
export function log(fields: LogFields): void {
  const entry = {
    timestamp: new Date().toISOString(),
    correlationId: fields.correlationId ?? randomUUID(),
    ...fields,
  }
  console.log(JSON.stringify(entry))
}

/**
 * Creates a request-scoped logger with a fixed correlationId.
 * Returns a log function and a finish() helper that logs duration.
 */
export function createRequestLogger(correlationId?: string, userId?: string) {
  const id = correlationId ?? randomUUID()
  const startTime = Date.now()

  return {
    correlationId: id,
    log: (fields: Omit<LogFields, 'correlationId'>) =>
      log({ correlationId: id, userId, ...fields }),
    finish: (fields?: Omit<LogFields, 'correlationId' | 'duration'>) =>
      log({ correlationId: id, userId, duration: Date.now() - startTime, ...fields }),
  }
}
