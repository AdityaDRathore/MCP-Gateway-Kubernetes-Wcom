import http from 'node:http';
import https from 'node:https';
import { AppConfig } from '../config.js';
import { signOAuth1Request } from './oauth.js';
import {
  WooCommerceError,
  UpstreamTimeoutError,
  UpstreamPayloadTooLargeError,
  UpstreamProtocolError,
  mapUpstreamError,
} from './errors.js';
import {
  WooProduct,
  WooOrder,
  WooProductSchema,
  WooProductListSchema,
  WooOrderSchema,
  WooOrderListSchema,
} from './schemas.js';
import {
  ProjectedProduct,
  ProjectedOrder,
  projectProduct,
  projectOrder,
} from './mappers.js';
import { logger, sanitizeString } from '../logging/logger.js';

const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB hard ceiling

export interface ListProductsParams {
  page?: number;
  per_page?: number;
  search?: string;
  sku?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private';
}

export interface CreateProductPayload {
  name: string;
  sku: string;
  regular_price: string;
  description?: string;
  status?: 'draft' | 'publish';
  manage_stock?: boolean;
  stock_quantity?: number;
}

export interface ListOrdersParams {
  page?: number;
  per_page?: number;
  status?: string;
  after?: string;
  before?: string;
}

export class WooCommerceClient {
  private readonly transportPrefix: string;
  private readonly signaturePrefix: string;

  constructor(private readonly config: AppConfig) {
    // Normalizes URLs without trailing slashes
    const transportBase = config.WOOCOMMERCE_BASE_URL.replace(/\/+$/, '');
    const siteBase = config.WOOCOMMERCE_SITE_URL.replace(/\/+$/, '');

    this.transportPrefix = `${transportBase}/wp-json/wc/v3`;
    this.signaturePrefix = `${siteBase}/wp-json/wc/v3`;
  }

  /**
   * Dedicated HTTP/HTTPS transport that preserves custom Host headers (preventing Undici/fetch stripping)
   * and enforces strict response size budgeting during streaming.
   */
  private httpTransport(
    requestUrl: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      headers: Record<string, string>;
      body?: string;
      timeoutMs: number;
      operation: string;
    }
  ): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method,
          headers: options.headers,
        },
        (res) => {
          let totalBytes = 0;
          let body = '';

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_RESPONSE_BYTES) {
              req.destroy(new UpstreamPayloadTooLargeError(MAX_RESPONSE_BYTES));
              return;
            }
            body += chunk.toString('utf-8');
          });

          res.on('end', () => {
            resolve({
              status: res.statusCode || 500,
              text: body,
            });
          });
        }
      );

      let timedOut = false;
      req.setTimeout(options.timeoutMs, () => {
        timedOut = true;
        req.destroy();
      });

      req.on('error', (err) => {
        if (timedOut) {
          reject(new UpstreamTimeoutError(options.operation, options.timeoutMs));
        } else {
          reject(err);
        }
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Internal request executor handling OAuth 1.0a signing, timeouts, response bounds, and error mapping.
   */
  private async execute<T>(options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    endpoint: string;
    queryParams?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
    operation: string;
    resourceId?: string | number;
  }): Promise<T> {
    const { method, endpoint, queryParams = {}, body, operation, resourceId } = options;
    const transportUrl = `${this.transportPrefix}${endpoint}`;
    const signatureUrl = `${this.signaturePrefix}${endpoint}`;

    const signResult = signOAuth1Request({
      method,
      transportBaseUrl: transportUrl,
      signatureBaseUrl: signatureUrl,
      queryParams,
      consumerKey: this.config.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: this.config.WOOCOMMERCE_CONSUMER_SECRET,
    });

    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.config.UPSTREAM_HOST_HEADER) {
        headers['Host'] = this.config.UPSTREAM_HOST_HEADER;
      }

      let requestBody: string | undefined;
      if (body) {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
        headers['Content-Length'] = Buffer.byteLength(requestBody).toString();
      }

      const { status, text: rawText } = await this.httpTransport(signResult.requestUrl, {
        method,
        headers,
        body: requestBody,
        timeoutMs: this.config.REQUEST_TIMEOUT_MS,
        operation,
      });

      const durationMs = Date.now() - startTime;

      // Check HTTP status code
      if (status < 200 || status >= 300) {
        logger.warn('Upstream WooCommerce request failed', {
          operation,
          statusCode: status,
          durationMs,
        });
        throw mapUpstreamError(status, rawText, { operation, resourceId });
      }

      // Parse JSON
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        logger.error('Malformed JSON received from WooCommerce', {
          operation,
          durationMs,
        });
        throw new UpstreamProtocolError('Failed to parse upstream response as JSON.');
      }

      logger.debug('Upstream WooCommerce request completed', {
        operation,
        statusCode: status,
        durationMs,
      });

      return data as T;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;

      if (err instanceof WooCommerceError) {
        throw err;
      }

      const rawMessage = err instanceof Error ? err.message : String(err);
      const sanitizedMessage = sanitizeString(rawMessage);
      logger.error('Network or system error during WooCommerce request', {
        operation,
        error: sanitizedMessage,
        durationMs,
      });
      throw new WooCommerceError(`Network request to WooCommerce failed: ${sanitizedMessage}`, 502, 'BAD_GATEWAY');
    }
  }

  // --- 1. list_products ---
  async listProducts(params: ListProductsParams = {}): Promise<ProjectedProduct[]> {
    const raw = await this.execute<WooProduct[]>({
      method: 'GET',
      endpoint: '/products',
      queryParams: {
        page: params.page ?? 1,
        per_page: params.per_page ?? 10,
        search: params.search,
        sku: params.sku,
        status: params.status,
      },
      operation: 'list_products',
    });

    const parsed = WooProductListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamProtocolError('Response failed product list schema validation.');
    }

    return parsed.data.map(projectProduct);
  }

  // --- Helper: getProductBySku ---
  async getProductBySku(sku: string): Promise<ProjectedProduct | null> {
    const products = await this.listProducts({ sku, per_page: 1 });
    return products.length > 0 ? products[0] : null;
  }

  // --- 2. create_product ---
  async createProduct(payload: CreateProductPayload): Promise<ProjectedProduct> {
    // Check if product with this SKU already exists
    const existing = await this.getProductBySku(payload.sku);
    if (existing) {
      throw mapUpstreamError(409, JSON.stringify({ message: `Product with SKU "${payload.sku}" already exists.` }), {
        operation: 'create_product',
      });
    }

    // Zero-retry write operation
    const raw = await this.execute<WooProduct>({
      method: 'POST',
      endpoint: '/products',
      body: {
        name: payload.name,
        sku: payload.sku,
        regular_price: payload.regular_price,
        description: payload.description ?? '',
        status: payload.status ?? 'draft',
        manage_stock: payload.manage_stock ?? false,
        stock_quantity: payload.stock_quantity,
      },
      operation: 'create_product',
    });

    const parsed = WooProductSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamProtocolError('Created product response failed schema validation.');
    }

    return projectProduct(parsed.data);
  }

  // --- 3. list_orders ---
  async listOrders(params: ListOrdersParams = {}): Promise<ProjectedOrder[]> {
    const raw = await this.execute<WooOrder[]>({
      method: 'GET',
      endpoint: '/orders',
      queryParams: {
        page: params.page ?? 1,
        per_page: params.per_page ?? 10,
        status: params.status,
        after: params.after,
        before: params.before,
      },
      operation: 'list_orders',
    });

    const parsed = WooOrderListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamProtocolError('Response failed order list schema validation.');
    }

    return parsed.data.map(projectOrder);
  }

  // --- 4. get_order ---
  async getOrder(orderId: number): Promise<ProjectedOrder> {
    const raw = await this.execute<WooOrder>({
      method: 'GET',
      endpoint: `/orders/${orderId}`,
      operation: 'get_order',
      resourceId: orderId,
    });

    const parsed = WooOrderSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamProtocolError('Order response failed schema validation.');
    }

    return projectOrder(parsed.data);
  }

  // --- 5. update_order_status ---
  async updateOrderStatus(orderId: number, status: string): Promise<{ id: number; previous_status: string; status: string; updated: boolean }> {
    // 1. Fetch current order to check current status
    const current = await this.getOrder(orderId);
    if (current.status === status) {
      return {
        id: orderId,
        previous_status: current.status,
        status,
        updated: false,
      };
    }

    // 2. Perform status mutation (zero-retry write operation)
    const raw = await this.execute<WooOrder>({
      method: 'PUT',
      endpoint: `/orders/${orderId}`,
      body: { status },
      operation: 'update_order_status',
      resourceId: orderId,
    });

    const parsed = WooOrderSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamProtocolError('Updated order response failed schema validation.');
    }

    return {
      id: orderId,
      previous_status: current.status,
      status: parsed.data.status,
      updated: true,
    };
  }
}
