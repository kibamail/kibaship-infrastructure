import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Handles loading and caching of HTML templates at application startup.
 */
class TemplateLoader {
  constructor() {
    this.templates = new Map();
  }

  /**
   * Loads a template from the filesystem and caches it in memory.
   * @param {string} templateName - Unique identifier for the template
   * @param {string} filePath - Absolute path to the template file
   * @returns {string} The loaded template content
   */
  loadTemplate(templateName, filePath) {
    const template = readFileSync(filePath, "utf8");
    this.templates.set(templateName, template);
    console.log(`Template loaded: ${templateName} from ${filePath}`);
    return template;
  }

  getTemplate(templateName) {
    return this.templates.get(templateName);
  }

  /**
   * Renders a template by replacing placeholder variables with actual values.
   * @param {string} templateName - Name of the cached template
   * @param {Object} variables - Key-value pairs for template variable replacement
   * @returns {string} Rendered template with variables substituted
   */
  render(templateName, variables = {}) {
    let template = this.getTemplate(templateName);

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{ ${key} }}`;
      template = template.replace(new RegExp(placeholder, "g"), value);
    });

    return template;
  }
}

/**
 * Extracts and formats request identifiers from HTTP headers for tracing purposes.
 */
class RequestIdExtractor {
  /**
   * Attempts to extract a request ID from common tracing headers.
   * @param {Object} headers - HTTP request headers object
   * @returns {string} Formatted request ID for debugging
   */
  static extract(headers) {
    const requestId =
      headers["x-request-id"] ||
      headers["x-trace-id"] ||
      headers["x-correlation-id"] ||
      this.generateFallbackId();

    return requestId;
  }

  /**
   * Generates a unique fallback identifier when no request ID is found.
   * @returns {string} Timestamp-based unique identifier
   */
  static generateFallbackId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `unknown-${timestamp}-${random}`;
  }
}

/**
 * Builds consistent HTTP responses with appropriate headers and content.
 */
class ResponseBuilder {
  constructor() {
    this.headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    };
  }

  notFound(htmlContent) {
    return {
      status: 404,
      headers: this.headers,
      body: htmlContent,
    };
  }

  /**
   * Creates a standardized health check response for monitoring systems.
   * @returns {Object} JSON response with service status and metadata
   */
  health() {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "404-deployment-not-found",
      }),
    };
  }
}

/**
 * Main service class that handles 404 responses for non-existent deployments.
 * Provides a user-friendly error page similar to Vercel's deployment not found page.
 */
class NotFoundService {
  constructor() {
    this.app = new Hono();
    this.templateLoader = new TemplateLoader();
    this.responseBuilder = new ResponseBuilder();
    this.port = process.env.PORT || 3000;

    this.initialize();
  }

  initialize() {
    const templatePath = join(__dirname, "..", "public", "index.html");
    this.templateLoader.loadTemplate("404", templatePath);
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.use(
      "/public/*",
      serveStatic({
        root: "./",
        rewriteRequestPath: (path) => path.replace(/^\/public/, "/public"),
      }),
    );

    this.app.get("/health", (c) => {
      const response = this.responseBuilder.health();
      return c.json(JSON.parse(response.body), response.status);
    });

    this.app.all("*", (c) => {
      return this.handle404Request(c);
    });
  }

  /**
   * Processes all unmatched requests and returns a branded 404 page with request tracing.
   * @param {Object} c - Hono context object containing request and response utilities
   * @returns {Response} HTML response with 404 status and request ID for debugging
   */
  handle404Request(c) {
    const requestId = RequestIdExtractor.extract(c.req.header());
    const html = this.templateLoader.render("404", { requestId });
    const response = this.responseBuilder.notFound(html);

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  /**
   * Starts the HTTP server and begins accepting requests.
   */
  start() {
    console.log(`404 Deployment Not Found service starting...`);
    console.log(`Port: ${this.port}`);

    serve({
      fetch: this.app.fetch,
      port: this.port,
    });

    console.log(`🚀 Server running on http://0.0.0.0:${this.port}`);
  }
}

const service = new NotFoundService();
service.start();
