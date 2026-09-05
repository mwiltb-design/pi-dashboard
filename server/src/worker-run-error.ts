export class WorkerRunError extends Error {
  constructor(message: string, readonly partialResult?: string, readonly resultTruncated = false) {
    super(message)
  }
}
