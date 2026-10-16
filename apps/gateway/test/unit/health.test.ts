import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { liveHandler, createReadyHandler, healthHandler } from '../../src/http/health.js';

describe('Gateway Operational Health Probes Unit Tests', () => {
  test('liveHandler returns HTTP 200 with service name', () => {
    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    liveHandler({} as Request, res);
    assert.equal(statusCode, 200);
    assert.deepEqual(jsonBody, { status: 'ok', service: 'urumi-gateway' });
  });

  test('healthHandler returns HTTP 200 with service name', () => {
    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    healthHandler({} as Request, res);
    assert.equal(statusCode, 200);
    assert.deepEqual(jsonBody, { status: 'ok', service: 'urumi-gateway' });
  });

  test('readyHandler returns HTTP 200 when local stub reports ready', () => {
    const readyHandler = createReadyHandler(() => true);
    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    readyHandler({} as Request, res);
    assert.equal(statusCode, 200);
    assert.deepEqual(jsonBody, { status: 'ok', service: 'urumi-gateway', ready: true });
  });

  test('readyHandler returns HTTP 503 when local stub reports unready', () => {
    const readyHandler = createReadyHandler(() => false);
    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        jsonBody = body;
        return this;
      },
    } as unknown as Response;

    readyHandler({} as Request, res);
    assert.equal(statusCode, 503);
    assert.deepEqual(jsonBody, { status: 'degraded', service: 'urumi-gateway', ready: false });
  });
});
