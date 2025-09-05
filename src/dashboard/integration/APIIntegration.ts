/**
 * APIIntegration - Phase 4 API Integration & External Connectors
 * 
 * Comprehensive API integration system:
 * - Multiple API protocol support (REST, GraphQL, WebSocket, gRPC)
 * - Authentication mechanisms (API Key, OAuth, JWT, Basic Auth)
 * - Rate limiting and retry strategies
 * - Data transformation and mapping
 * - Webhook management
 * - External service connectors
 */

interface APIEndpoint {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  protocol: 'rest' | 'graphql' | 'websocket' | 'grpc';
  authentication: APIAuthentication;
  headers: Record<string, string>;
  timeout: number;
  retryConfig: RetryConfig;
  rateLimit: RateLimitConfig;
  dataMapping: DataMapping;
  validation: ValidationConfig;
  monitoring: MonitoringConfig;
}

interface APIAuthentication {
  type: 'none' | 'api_key' | 'bearer_token' | 'oauth2' | 'basic_auth' | 'custom';
  config: Record<string, unknown>;
  tokenRefresh?: {
    enabled: boolean;
    endpoint?: string;
    threshold: number; // seconds before expiry
  };
}

interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryOn: Array<'timeout' | 'network_error' | 'server_error' | 'rate_limit'>;
}

interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
  burstLimit: number;
  queueMaxSize: number;
  dropOnFull: boolean;
}

interface DataMapping {
  requestTransform?: string; // JavaScript function as string
  responseTransform?: string; // JavaScript function as string
  errorTransform?: string; // JavaScript function as string
  fieldMappings: Array<{
    source: string;
    target: string;
    transform?: string;
  }>;
}

interface ValidationConfig {
  requestSchema?: object;
  responseSchema?: object;
  validateRequest: boolean;
  validateResponse: boolean;
  strictMode: boolean;
}

interface MonitoringConfig {
  logRequests: boolean;
  logResponses: boolean;
  logErrors: boolean;
  collectMetrics: boolean;
  alertOnFailure: boolean;
  alertThreshold: number;
}

interface APIRequest {
  id: string;
  endpointId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
  timeout: number;
}

interface APIResponse {
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
  timestamp: number;
  error?: string;
}

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  authentication: APIAuthentication;
  headers: Record<string, string>;
  retryConfig: RetryConfig;
  verification: {
    enabled: boolean;
    secret?: string;
    algorithm: 'sha256' | 'sha512';
    headerName: string;
  };
  filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
}

interface ExternalConnector {
  id: string;
  name: string;
  type: 'database' | 'queue' | 'storage' | 'monitoring' | 'notification' | 'analytics';
  config: Record<string, unknown>;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    endpoint?: string;
  };
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  lastCheck?: number;
  metrics: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    lastError?: string;
  };
}

export class APIIntegration {
  private endpoints: Map<string, APIEndpoint> = new Map();
  private webhooks: Map<string, WebhookConfig> = new Map();
  private connectors: Map<string, ExternalConnector> = new Map();
  private requestQueue: Map<string, APIRequest[]> = new Map();
  private responseCache: Map<string, { response: APIResponse; expiry: number }> = new Map();
  private rateLimiters: Map<string, { requests: number[]; lastReset: number }> = new Map();
  private monitoringCallbacks: Array<(event: APIMonitoringEvent) => void> = [];
  
  constructor() {
    this.initializeDefaultEndpoints();
    this.initializeDefaultConnectors();
    this.startBackgroundTasks();
  }
  
  /**
   * Initialize default API endpoints
   */
  private initializeDefaultEndpoints(): void {
    const defaultEndpoints: APIEndpoint[] = [
      {
        id: 'system_health',
        name: 'System Health Check',
        url: 'http://localhost:8989/api/health',
        method: 'GET',
        protocol: 'rest',
        authentication: { type: 'none', config: {} },
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
        retryConfig: {
          enabled: true,
          maxAttempts: 3,
          backoffStrategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 5000,
          retryOn: ['timeout', 'network_error', 'server_error']
        },
        rateLimit: {
          enabled: true,
          requestsPerMinute: 60,
          burstLimit: 10,
          queueMaxSize: 100,
          dropOnFull: false
        },
        dataMapping: {
          fieldMappings: []
        },
        validation: {
          validateRequest: false,
          validateResponse: true,
          strictMode: false
        },
        monitoring: {
          logRequests: true,
          logResponses: false,
          logErrors: true,
          collectMetrics: true,
          alertOnFailure: true,
          alertThreshold: 5
        }
      },
      {
        id: 'external_metrics',
        name: 'External Metrics API',
        url: 'https://api.example.com/metrics',
        method: 'POST',
        protocol: 'rest',
        authentication: {
          type: 'api_key',
          config: {
            keyName: 'X-API-Key',
            keyValue: '${API_KEY}' // Environment variable
          }
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MCP-Index-Server/1.0'
        },
        timeout: 10000,
        retryConfig: {
          enabled: true,
          maxAttempts: 5,
          backoffStrategy: 'exponential',
          baseDelay: 2000,
          maxDelay: 30000,
          retryOn: ['timeout', 'network_error', 'server_error', 'rate_limit']
        },
        rateLimit: {
          enabled: true,
          requestsPerMinute: 30,
          burstLimit: 5,
          queueMaxSize: 50,
          dropOnFull: true
        },
        dataMapping: {
          requestTransform: `
            function transform(data) {
              return {
                timestamp: Date.now(),
                source: 'mcp-index-server',
                metrics: data
              };
            }
          `,
          responseTransform: `
            function transform(response) {
              return {
                success: response.status === 'ok',
                processed: response.count || 0,
                errors: response.errors || []
              };
            }
          `,
          fieldMappings: [
            { source: 'cpu_usage', target: 'cpu', transform: 'Math.round(value * 100) / 100' },
            { source: 'memory_usage', target: 'memory', transform: 'Math.round(value)' }
          ]
        },
        validation: {
          validateRequest: true,
          validateResponse: true,
          strictMode: true,
          requestSchema: {
            type: 'object',
            properties: {
              metrics: { type: 'array' },
              timestamp: { type: 'number' }
            },
            required: ['metrics', 'timestamp']
          }
        },
        monitoring: {
          logRequests: true,
          logResponses: true,
          logErrors: true,
          collectMetrics: true,
          alertOnFailure: true,
          alertThreshold: 3
        }
      }
    ];
    
    defaultEndpoints.forEach(endpoint => {
      this.endpoints.set(endpoint.id, endpoint);
      this.initializeRateLimit(endpoint.id, endpoint.rateLimit);
    });
  }
  
  /**
   * Initialize default external connectors
   */
  private initializeDefaultConnectors(): void {
    const defaultConnectors: ExternalConnector[] = [
      {
        id: 'prometheus_metrics',
        name: 'Prometheus Metrics Collector',
        type: 'monitoring',
        config: {
          url: 'http://localhost:9090',
          scrapeInterval: 15000,
          metrics: ['cpu_usage', 'memory_usage', 'request_rate', 'error_rate']
        },
        healthCheck: {
          enabled: true,
          interval: 30000,
          timeout: 5000,
          endpoint: '/api/v1/status/buildinfo'
        },
        status: 'disconnected',
        metrics: {
          requestCount: 0,
          errorCount: 0,
          avgResponseTime: 0
        }
      },
      {
        id: 'slack_notifications',
        name: 'Slack Notification Connector',
        type: 'notification',
        config: {
          webhookUrl: '${SLACK_WEBHOOK_URL}',
          channel: '#alerts',
          username: 'MCP-Index-Server',
          iconEmoji: ':robot_face:'
        },
        healthCheck: {
          enabled: true,
          interval: 300000, // 5 minutes
          timeout: 10000
        },
        status: 'disconnected',
        metrics: {
          requestCount: 0,
          errorCount: 0,
          avgResponseTime: 0
        }
      },
      {
        id: 'elasticsearch_logs',
        name: 'Elasticsearch Log Connector',
        type: 'analytics',
        config: {
          host: 'localhost',
          port: 9200,
          index: 'mcp-index-server-logs',
          batchSize: 100,
          flushInterval: 5000
        },
        healthCheck: {
          enabled: true,
          interval: 60000,
          timeout: 5000,
          endpoint: '/_cluster/health'
        },
        status: 'disconnected',
        metrics: {
          requestCount: 0,
          errorCount: 0,
          avgResponseTime: 0
        }
      }
    ];
    
    defaultConnectors.forEach(connector => {
      this.connectors.set(connector.id, connector);
    });
  }
  
  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Process request queues
    setInterval(() => {
      this.processRequestQueues();
    }, 100);
    
    // Clean up cache
    setInterval(() => {
      this.cleanupCache();
    }, 60000);
    
    // Reset rate limiters
    setInterval(() => {
      this.resetRateLimiters();
    }, 60000);
    
    // Health check connectors
    setInterval(() => {
      this.performHealthChecks();
    }, 30000);
  }
  
  /**
   * Initialize rate limiter for endpoint
   */
  private initializeRateLimit(endpointId: string, config: RateLimitConfig): void {
    if (config.enabled) {
      this.rateLimiters.set(endpointId, {
        requests: [],
        lastReset: Date.now()
      });
    }
  }
  
  /**
   * Check rate limit for endpoint
   */
  private checkRateLimit(endpointId: string): boolean {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint?.rateLimit.enabled) return true;
    
    const limiter = this.rateLimiters.get(endpointId);
    if (!limiter) return true;
    
    const now = Date.now();
    const config = endpoint.rateLimit;
    
    // Remove requests older than 1 minute
    limiter.requests = limiter.requests.filter(time => now - time < 60000);
    
    // Check if within rate limit
    if (limiter.requests.length >= config.requestsPerMinute) {
      return false;
    }
    
    // Check burst limit
    const recentRequests = limiter.requests.filter(time => now - time < 1000);
    if (recentRequests.length >= config.burstLimit) {
      return false;
    }
    
    // Add current request
    limiter.requests.push(now);
    return true;
  }
  
  /**
   * Execute API request
   */
  async executeRequest(endpointId: string, data?: unknown, overrides?: Partial<APIRequest>): Promise<APIResponse> {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint not found: ${endpointId}`);
    }
    
    // Check rate limit
    if (!this.checkRateLimit(endpointId)) {
      throw new Error(`Rate limit exceeded for endpoint: ${endpointId}`);
    }
    
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Prepare request
    const request: APIRequest = {
      id: requestId,
      endpointId,
      method: endpoint.method,
      url: endpoint.url,
      headers: { ...endpoint.headers, ...(overrides?.headers || {}) },
      body: data,
      timestamp: Date.now(),
      timeout: overrides?.timeout || endpoint.timeout
    };
    
    // Apply authentication
    this.applyAuthentication(request, endpoint.authentication);
    
    // Transform request data
    if (data && endpoint.dataMapping.requestTransform) {
      try {
        const transformFn = new Function('data', endpoint.dataMapping.requestTransform + '; return transform(data);');
        request.body = transformFn(data);
      } catch (error) {
        console.error('Request transform error:', error);
      }
    }
    
    // Validate request
    if (endpoint.validation.validateRequest && endpoint.validation.requestSchema) {
      const valid = this.validateData(request.body, endpoint.validation.requestSchema);
      if (!valid && endpoint.validation.strictMode) {
        throw new Error('Request validation failed');
      }
    }
    
    // Log request
    if (endpoint.monitoring.logRequests) {
      this.logAPIEvent('request', { endpointId, requestId, url: request.url, method: request.method });
    }
    
    // Execute request with retry logic
    const response = await this.executeWithRetry(request, endpoint.retryConfig);
    
    // Transform response
    if (endpoint.dataMapping.responseTransform) {
      try {
        const transformFn = new Function('response', endpoint.dataMapping.responseTransform + '; return transform(response);');
        response.body = transformFn(response.body);
      } catch (error) {
        console.error('Response transform error:', error);
      }
    }
    
    // Apply field mappings
    if (endpoint.dataMapping.fieldMappings.length > 0) {
      response.body = this.applyFieldMappings(response.body, endpoint.dataMapping.fieldMappings);
    }
    
    // Validate response
    if (endpoint.validation.validateResponse && endpoint.validation.responseSchema) {
      const valid = this.validateData(response.body, endpoint.validation.responseSchema);
      if (!valid && endpoint.validation.strictMode) {
        console.warn('Response validation failed for endpoint:', endpointId);
      }
    }
    
    // Log response
    if (endpoint.monitoring.logResponses) {
      this.logAPIEvent('response', { 
        endpointId, 
        requestId, 
        status: response.status, 
        responseTime: response.responseTime 
      });
    }
    
    // Log errors
    if (response.error && endpoint.monitoring.logErrors) {
      this.logAPIEvent('error', { 
        endpointId, 
        requestId, 
        error: response.error, 
        status: response.status 
      });
    }
    
    // Collect metrics
    if (endpoint.monitoring.collectMetrics) {
      this.collectMetrics(endpointId, response);
    }
    
    return response;
  }
  
  /**
   * Apply authentication to request
   */
  private applyAuthentication(request: APIRequest, auth: APIAuthentication): void {
    switch (auth.type) {
      case 'api_key': {
        const keyName = auth.config.keyName as string;
        const keyValue = this.resolveConfigValue(auth.config.keyValue as string);
        request.headers[keyName] = keyValue;
        break;
      }
        
      case 'bearer_token': {
        const token = this.resolveConfigValue(auth.config.token as string);
        request.headers['Authorization'] = `Bearer ${token}`;
        break;
      }
        
      case 'basic_auth': {
        const username = this.resolveConfigValue(auth.config.username as string);
        const password = this.resolveConfigValue(auth.config.password as string);
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        request.headers['Authorization'] = `Basic ${credentials}`;
        break;
      }
        
      case 'oauth2':
        // OAuth2 implementation would require token management
        console.warn('OAuth2 authentication not fully implemented');
        break;
        
      case 'custom': {
        // Custom authentication logic
        const customHeaders = auth.config.headers as Record<string, string>;
        Object.assign(request.headers, customHeaders);
        break;
      }
        
      case 'none':
      default:
        // No authentication required
        break;
    }
  }
  
  /**
   * Resolve configuration values (environment variables, etc.)
   */
  private resolveConfigValue(value: string): string {
    if (value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      return process.env[envVar] || value;
    }
    return value;
  }
  
  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(request: APIRequest, retryConfig: RetryConfig): Promise<APIResponse> {
    let lastError: Error | null = null;
    let attempt = 0;
    
    while (attempt <= retryConfig.maxAttempts) {
      try {
        const response = await this.performHTTPRequest(request);
        
        // Check if response indicates a retryable error
        if (this.shouldRetry(response, retryConfig)) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;
        
        if (attempt > retryConfig.maxAttempts) {
          break;
        }
        
        if (!this.shouldRetryError(lastError, retryConfig)) {
          break;
        }
        
        // Calculate delay
        const delay = this.calculateRetryDelay(attempt, retryConfig);
        await this.sleep(delay);
      }
    }
    
    // Return error response
    return {
      requestId: request.id,
      status: 0,
      statusText: 'Request Failed',
      headers: {},
      body: null,
      responseTime: 0,
      timestamp: Date.now(),
      error: lastError?.message || 'Unknown error'
    };
  }
  
  /**
   * Perform HTTP request
   */
  private async performHTTPRequest(request: APIRequest): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      // Simulate HTTP request - in real implementation, use fetch or axios
      const response = await this.simulateHTTPRequest(request);
      
      return {
        requestId: request.id,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        responseTime: Date.now() - startTime,
        timestamp: Date.now()
      };
      
    } catch (error) {
      throw new Error(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Simulate HTTP request (for demo purposes)
   */
  private async simulateHTTPRequest(request: APIRequest): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  }> {
    // Simulate network delay
    await this.sleep(Math.random() * 100 + 50);
    
    // Simulate different response scenarios
    const scenarios = [
      { weight: 0.8, status: 200, statusText: 'OK', body: { success: true, data: 'Response data' } },
      { weight: 0.1, status: 429, statusText: 'Too Many Requests', body: { error: 'Rate limit exceeded' } },
      { weight: 0.05, status: 500, statusText: 'Internal Server Error', body: { error: 'Server error' } },
      { weight: 0.05, status: 503, statusText: 'Service Unavailable', body: { error: 'Service unavailable' } }
    ];
    
    const random = Math.random();
    let cumulative = 0;
    
    for (const scenario of scenarios) {
      cumulative += scenario.weight;
      if (random <= cumulative) {
        return {
          status: scenario.status,
          statusText: scenario.statusText,
          headers: { 'Content-Type': 'application/json' },
          body: scenario.body
        };
      }
    }
    
    // Default response
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, data: request.body }
    };
  }
  
  /**
   * Check if response should trigger retry
   */
  private shouldRetry(response: APIResponse, retryConfig: RetryConfig): boolean {
    if (!retryConfig.enabled) return false;
    
    // Retry on server errors (5xx) and rate limiting (429)
    if (response.status >= 500 || response.status === 429) {
      return retryConfig.retryOn.includes('server_error') || retryConfig.retryOn.includes('rate_limit');
    }
    
    return false;
  }
  
  /**
   * Check if error should trigger retry
   */
  private shouldRetryError(error: Error, retryConfig: RetryConfig): boolean {
    if (!retryConfig.enabled) return false;
    
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') && retryConfig.retryOn.includes('timeout')) {
      return true;
    }
    
    if ((message.includes('network') || message.includes('fetch')) && 
        retryConfig.retryOn.includes('network_error')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Calculate retry delay
   */
  private calculateRetryDelay(attempt: number, retryConfig: RetryConfig): number {
    let delay: number;
    
    switch (retryConfig.backoffStrategy) {
      case 'linear':
        delay = retryConfig.baseDelay * attempt;
        break;
      case 'exponential':
        delay = retryConfig.baseDelay * Math.pow(2, attempt - 1);
        break;
      case 'fixed':
      default:
        delay = retryConfig.baseDelay;
        break;
    }
    
    return Math.min(delay, retryConfig.maxDelay);
  }
  
  /**
   * Apply field mappings to data
   */
  private applyFieldMappings(data: unknown, mappings: DataMapping['fieldMappings']): unknown {
    if (!data || typeof data !== 'object' || !Array.isArray(mappings)) {
      return data;
    }
    
    const result = { ...data } as Record<string, unknown>;
    
    mappings.forEach(mapping => {
      const sourceValue = this.getNestedValue(result, mapping.source);
      let targetValue = sourceValue;
      
      // Apply transform if provided
      if (mapping.transform) {
        try {
          const transformFn = new Function('value', `return ${mapping.transform}`);
          targetValue = transformFn(sourceValue);
        } catch (error) {
          console.error('Field mapping transform error:', error);
        }
      }
      
      this.setNestedValue(result, mapping.target, targetValue);
    });
    
    return result;
  }
  
  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key: string) => {
      return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
    }, obj as unknown);
  }
  
  /**
   * Set nested value in object
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    
    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      return current[key] as Record<string, unknown>;
    }, obj);
    
    target[lastKey] = value;
  }
  
  /**
   * Validate data against schema
   */
  private validateData(data: unknown, _schema: object): boolean {
    // Simplified validation - in real implementation, use ajv or joi
    try {
      // Basic type checking
      if (typeof data !== 'object' || data === null) {
        return false;
      }
      
      return true; // Placeholder validation
    } catch {
      return false;
    }
  }
  
  /**
   * Process request queues
   */
  private processRequestQueues(): void {
    this.requestQueue.forEach((requests, endpointId) => {
      if (requests.length === 0) return;
      
      const endpoint = this.endpoints.get(endpointId);
      if (!endpoint?.rateLimit.enabled) return;
      
      // Process requests within rate limit
      if (this.checkRateLimit(endpointId)) {
        const request = requests.shift();
        if (request) {
          this.executeRequest(endpointId, request.body, request).catch(error => {
            console.error('Queued request execution error:', error);
          });
        }
      }
    });
  }
  
  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    
    const entries = Array.from(this.responseCache.entries());
    for (const [key, cached] of entries) {
      if (cached.expiry <= now) {
        this.responseCache.delete(key);
      }
    }
  }
  
  /**
   * Get list of configured endpoints
   */
  getConfiguredEndpoints(): APIEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Reset rate limiters
   */
  private resetRateLimiters(): void {
    const now = Date.now();
    
    this.rateLimiters.forEach((limiter, _endpointId) => {
      // Reset if more than 1 minute has passed
      if (now - limiter.lastReset > 60000) {
        limiter.requests = [];
        limiter.lastReset = now;
      }
    });
  }
  
  /**
   * Perform health checks on connectors
   */
  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.connectors.entries()).map(async ([_id, connector]) => {
      if (!connector.healthCheck.enabled) return;
      
      const now = Date.now();
      if (connector.lastCheck && now - connector.lastCheck < connector.healthCheck.interval) {
        return;
      }
      
      try {
        connector.status = 'connecting';
        
        // Simulate health check
        await this.performConnectorHealthCheck(connector);
        
        connector.status = 'connected';
        connector.lastCheck = now;
        
      } catch (error) {
        connector.status = 'error';
        connector.metrics.lastError = error instanceof Error ? error.message : 'Unknown error';
        connector.lastCheck = now;
      }
    });
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Perform health check for specific connector
   */
  private async performConnectorHealthCheck(_connector: ExternalConnector): Promise<void> {
    // Simulate health check delay
    await this.sleep(Math.random() * 1000 + 100);
    
    // Simulate occasional failures
    if (Math.random() < 0.1) {
      throw new Error('Health check failed');
    }
  }
  
  /**
   * Collect metrics for endpoint
   */
  private collectMetrics(endpointId: string, response: APIResponse): void {
    // Update metrics (this would integrate with MetricsCollector)
    this.logAPIEvent('metrics', {
      endpointId,
      responseTime: response.responseTime,
      status: response.status,
      success: response.status >= 200 && response.status < 300
    });
  }
  
  /**
   * Log API event
   */
  private logAPIEvent(type: string, data: Record<string, unknown>): void {
    const event: APIMonitoringEvent = {
      type,
      timestamp: Date.now(),
      data
    };
    
    this.monitoringCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('API monitoring callback error:', error);
      }
    });
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Public API methods
  
  /**
   * Create API endpoint
   */
  createEndpoint(endpoint: Omit<APIEndpoint, 'id'>): string {
    const id = `endpoint_${Date.now()}`;
    const fullEndpoint: APIEndpoint = { id, ...endpoint };
    
    this.endpoints.set(id, fullEndpoint);
    this.initializeRateLimit(id, fullEndpoint.rateLimit);
    
    return id;
  }
  
  /**
   * Get API endpoint
   */
  getEndpoint(id: string): APIEndpoint | undefined {
    return this.endpoints.get(id);
  }
  
  /**
   * List API endpoints
   */
  listEndpoints(): APIEndpoint[] {
    return Array.from(this.endpoints.values());
  }
  
  /**
   * Update API endpoint
   */
  updateEndpoint(id: string, updates: Partial<APIEndpoint>): boolean {
    const endpoint = this.endpoints.get(id);
    if (!endpoint) return false;
    
    Object.assign(endpoint, updates);
    
    if (updates.rateLimit) {
      this.initializeRateLimit(id, endpoint.rateLimit);
    }
    
    return true;
  }
  
  /**
   * Delete API endpoint
   */
  deleteEndpoint(id: string): boolean {
    this.rateLimiters.delete(id);
    this.requestQueue.delete(id);
    return this.endpoints.delete(id);
  }
  
  /**
   * Create webhook
   */
  createWebhook(webhook: Omit<WebhookConfig, 'id'>): string {
    const id = `webhook_${Date.now()}`;
    const fullWebhook: WebhookConfig = { id, ...webhook };
    
    this.webhooks.set(id, fullWebhook);
    return id;
  }
  
  /**
   * Trigger webhook
   */
  async triggerWebhook(id: string, event: string, data: unknown): Promise<boolean> {
    const webhook = this.webhooks.get(id);
    if (!webhook || !webhook.events.includes(event)) {
      return false;
    }
    
    // Apply filters
    if (webhook.filters.length > 0) {
      const passesFilters = webhook.filters.every(filter => 
        this.evaluateWebhookFilter(data, filter)
      );
      if (!passesFilters) return false;
    }
    
    try {
      const payload = {
        event,
        timestamp: Date.now(),
        data
      };
      
      const response = await this.executeWebhookRequest(webhook, payload);
      return response.status >= 200 && response.status < 300;
      
    } catch (error) {
      console.error('Webhook execution error:', error);
      return false;
    }
  }
  
  /**
   * Execute webhook request
   */
  private async executeWebhookRequest(webhook: WebhookConfig, payload: unknown): Promise<APIResponse> {
    const request: APIRequest = {
      id: `webhook_${Date.now()}`,
      endpointId: webhook.id,
      method: 'POST',
      url: webhook.url,
      headers: { ...webhook.headers, 'Content-Type': 'application/json' },
      body: payload,
      timestamp: Date.now(),
      timeout: 10000
    };
    
    this.applyAuthentication(request, webhook.authentication);
    
    // Add webhook signature if verification is enabled
    if (webhook.verification.enabled && webhook.verification.secret) {
      const signature = this.generateWebhookSignature(payload, webhook.verification);
      request.headers[webhook.verification.headerName] = signature;
    }
    
    return this.executeWithRetry(request, webhook.retryConfig);
  }
  
  /**
   * Generate webhook signature
   */
  private generateWebhookSignature(payload: unknown, verification: WebhookConfig['verification']): string {
    // Simplified signature generation - in real implementation, use crypto
    const payloadString = JSON.stringify(payload);
    return `${verification.algorithm}=${Buffer.from(payloadString + verification.secret).toString('base64')}`;
  }
  
  /**
   * Evaluate webhook filter
   */
  private evaluateWebhookFilter(data: unknown, filter: { field: string; operator: string; value: unknown }): boolean {
    if (!data || typeof data !== 'object') return false;
    
    const fieldValue = this.getNestedValue(data as Record<string, unknown>, filter.field);
    
    switch (filter.operator) {
      case 'equals':
        return fieldValue === filter.value;
      case 'not_equals':
        return fieldValue !== filter.value;
      case 'contains':
        return String(fieldValue).includes(String(filter.value));
      default:
        return true;
    }
  }
  
  /**
   * Create external connector
   */
  createConnector(connector: Omit<ExternalConnector, 'id' | 'status' | 'metrics'>): string {
    const id = `connector_${Date.now()}`;
    const fullConnector: ExternalConnector = {
      id,
      ...connector,
      status: 'disconnected',
      metrics: {
        requestCount: 0,
        errorCount: 0,
        avgResponseTime: 0
      }
    };
    
    this.connectors.set(id, fullConnector);
    return id;
  }
  
  /**
   * Get connector status
   */
  getConnectorStatus(id: string): ExternalConnector | undefined {
    return this.connectors.get(id);
  }
  
  /**
   * List all connectors
   */
  listConnectors(): ExternalConnector[] {
    return Array.from(this.connectors.values());
  }
  
  /**
   * Register monitoring callback
   */
  onAPIEvent(callback: (event: APIMonitoringEvent) => void): void {
    this.monitoringCallbacks.push(callback);
  }
  
  /**
   * Get API statistics
   */
  getAPIStatistics(): {
    endpoints: number;
    webhooks: number;
    connectors: number;
    activeConnections: number;
    totalRequests: number;
    errorRate: number;
  } {
    const activeConnections = Array.from(this.connectors.values())
      .filter(c => c.status === 'connected').length;
    
    const totalRequests = Array.from(this.connectors.values())
      .reduce((sum, c) => sum + c.metrics.requestCount, 0);
    
    const totalErrors = Array.from(this.connectors.values())
      .reduce((sum, c) => sum + c.metrics.errorCount, 0);
    
    return {
      endpoints: this.endpoints.size,
      webhooks: this.webhooks.size,
      connectors: this.connectors.size,
      activeConnections,
      totalRequests,
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0
    };
  }
}

interface APIMonitoringEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// Singleton instance
let apiIntegration: APIIntegration | null = null;

export function getAPIIntegration(): APIIntegration {
  if (!apiIntegration) {
    apiIntegration = new APIIntegration();
  }
  return apiIntegration;
}
