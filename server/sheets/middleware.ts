import type { NextFunction, Request, Response } from 'express'
import {
  createSheetsContext,
  discardSheetsContext,
  flushSheetsContext,
  runWithSheetsContext,
  sheetsWriteError,
} from './runtime'

/**
 * Gives every request a Google Sheets write context. Writes are staged while
 * the handler runs and flushed before the response is sent, so the client only
 * sees success after the spreadsheet has confirmed the save.
 *
 * Only `res.send` is wrapped. Express's `res.json`, `res.sendStatus` and
 * `res.redirect` all end up calling `res.send`, so wrapping it once avoids the
 * recursion that happens when `res.json` is wrapped and its internal
 * `this.send` call hits the wrapper again.
 */
export function sheetsMiddleware(req: Request, res: Response, next: NextFunction) {
  const ctx = createSheetsContext()

  runWithSheetsContext(ctx, () => {
    const originalSend = res.send.bind(res)
    const originalJson = res.json.bind(res)
    let sending = false

    res.send = ((body?: unknown) => {
      if (sending) return res
      sending = true
      flushSheetsContext(ctx)
        .then(() => originalSend(body))
        .catch((err) => {
          discardSheetsContext()
          const failure = sheetsWriteError(err)
          console.error(`[sheets] could not save ${req.method} ${req.originalUrl}:`, failure.message)
          if (!res.headersSent) {
            // Restore the real senders so the error response is not swallowed
            // by the "already sending" guard above. Let the shared error
            // handler map conflicts (409) and missing rows (404); everything
            // else becomes a clear 502 "nothing was saved" response.
            res.json = originalJson
            res.send = originalSend
            next(failure)
          }
        })
      return res
    }) as Response['send']

    next()
  })
}
