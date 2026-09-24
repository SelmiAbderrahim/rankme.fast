import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
const HEADER = 'x-request-id';
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.header(HEADER);
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.id = id;
    res.setHeader(HEADER, id);
    next();
};
