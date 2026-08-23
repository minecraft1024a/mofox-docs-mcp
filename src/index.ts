#!/usr/bin/env node
/**
 * mofox-docs-mcp — Neo-MoFox 官方文档 MCP 服务器
 *
 * 通过 Model Context Protocol 提供 MoFox-Bot-Docs 文档站的检索与阅读能力：
 *   - 工具：search_docs / list_docs / get_doc
 *   - 资源：mofox://docs（全量索引）、mofox://docs/<id>（单篇正文）
 *
 * 数据源为文档站 JSON API（https://docs.mofox-sama.com/api/docs/*），
 * 与 MoFox 插件市场中的 mofox_docs 插件共用同一套索引（llms.json）。
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PACKAGE_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://docs.mofox-sama.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 300_000;

// ── 命令行参数 ────────────────────────────────────────────────────────

interface CliOptions {
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    baseUrl: process.env.MOFOX_DOCS_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: Number(process.env.MOFOX_DOCS_TIMEOUT ?? "") * 1000 || DEFAULT_TIMEOUT_MS,
    cacheTtlMs: Number(process.env.MOFOX_DOCS_CACHE_TTL ?? "") * 1000 || DEFAULT_CACHE_TTL_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = (): string => argv[++i] as string;
    switch (arg) {
      case "--base-url":
        opts.baseUrl = next().replace(/\/+$/, "");
        break;
      case "--timeout":
        opts.timeoutMs = Number(next()) * 1000;
        break;
      case "--cache-ttl":
        opts.cacheTtlMs = Number(next()) * 1000;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "mofox-docs-mcp — Neo-MoFox 官方文档 MCP 服务器",
            "",
            "用法: mofox-docs-mcp [选项]",
            "",
            "选项:",
            "  --base-url <url>   文档站地址（默认 " + DEFAULT_BASE_URL + "）",
            "  --timeout <秒>     请求超时（默认 30）",
            "  --cache-ttl <秒>   索引缓存时长（默认 300）",
            "  -h, --help         显示帮助",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`未知参数: ${arg}（使用 --help 查看帮助）`);
          process.exit(2);
        }
    }
  }
  return opts;
}

// ── 文档 API 客户端 ───────────────────────────────────────────────────

interface LlmsDoc {
  id: string;
  path: string;
  title: string;
  description: string;
  preview: string;
  section: string;
}

class DocsApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private llmsCache: { at: number; docs: LlmsDoc[]; total: number } | null = null;

  constructor(opts: CliOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs;
    this.cacheTtlMs = opts.cacheTtlMs;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`文档 API 请求失败 (HTTP ${res.status}): ${this.baseUrl}${path}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`文档 API 请求超时（${this.timeoutMs / 1000}s）: ${this.baseUrl}${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 获取 LLM 检索索引（llms.json），带 TTL 缓存。 */
  async getLlms(): Promise<{ total: number; docs: LlmsDoc[] }> {
    const now = Date.now();
    if (this.llmsCache && now - this.llmsCache.at < this.cacheTtlMs) {
      return { total: this.llmsCache.total, docs: this.llmsCache.docs };
    }
    const data = await this.request<{ total: number; docs: LlmsDoc[] }>(
      "/api/docs/llms.json",
    );
    this.llmsCache = { at: now, total: data.total, docs: data.docs };
    return { total: data.total, docs: data.docs };
  }

  /** 获取单篇文档（含正文）。 */
  async getDoc(docId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/docs/${docId}.json`);
  }

  /** 按关键词检索：按命中的关键词数量降序（多关键词优先，至少命中一个即返回）。 */
  async searchDocs(query: string): Promise<LlmsDoc[]> {
    const { docs } = await this.getLlms();
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    const hay = (d: LlmsDoc): string =>
      [d.title, d.description, d.preview, d.section, d.id, d.path]
        .join(" ")
        .toLowerCase();
    const count = (d: LlmsDoc): number => tokens.reduce((n, t) => n + (hay(d).includes(t) ? 1 : 0), 0);

    return docs
      .map((doc, index) => ({ doc, score: count(doc), index }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.doc);
  }
}

// ── 工具 / 资源响应辅助 ───────────────────────────────────────────────

function textResult(payload: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { content: [{ type: "text", text: `错误: ${message}` }], isError: true };
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? 10;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function clampOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(offset ?? 0));
}

// ── 服务器主入口 ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const client = new DocsApiClient(opts);

  const server = new McpServer({
    name: "mofox-docs-mcp",
    version: PACKAGE_VERSION,
  });

  // ── 工具 ──

  server.tool(
    "search_docs",
    "按关键词检索 Neo-MoFox 官方文档。查询按空白拆分为多个关键词，" +
      "按「命中关键词数量」降序返回（命中全部关键词的文档排最前，至少命中一个即返回）。" +
      "匹配标题 / 简介 / 正文预览 / 分类 / id / 路径。结果不含完整正文，" +
      "需要全文时再用 get_doc 获取。",
    {
      query: z.string().describe("检索关键词，如 \"Windows 部署 安装\" 或 \"docker\""),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认 10，最大 100"),
      offset: z.number().int().min(0).optional().describe("结果偏移量，用于分页，默认 0"),
    },
    async ({ query, limit, offset }) => {
      try {
        const results = await client.searchDocs(query);
        const page = results.slice(clampOffset(offset), clampOffset(offset) + clampLimit(limit));
        return textResult({
          type: "docs_search_result",
          action: "search",
          query,
          total: results.length,
          offset: clampOffset(offset),
          count: page.length,
          results: page,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "list_docs",
    "列出 Neo-MoFox 官方文档。按 section 排序，部署指南（guides/deployment）排最前，" +
      "每篇含 title / description / preview / section。支持 offset 分页。",
    {
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认 10，最大 100"),
      offset: z.number().int().min(0).optional().describe("结果偏移量，用于分页，默认 0"),
    },
    async ({ limit, offset }) => {
      try {
        const { total, docs } = await client.getLlms();
        const page = docs.slice(clampOffset(offset), clampOffset(offset) + clampLimit(limit));
        return textResult({
          type: "docs_index",
          action: "list",
          total,
          offset: clampOffset(offset),
          count: page.length,
          docs: page,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    "get_doc",
    "获取指定文档的完整正文（纯文本）。doc_id 形如 guides/deployment/deployment_guide，" +
      "可从 search_docs / list_docs 结果的 id 字段获取。",
    {
      doc_id: z.string().describe("文档唯一标识，如 guides/configuration/bot_config_guide"),
    },
    async ({ doc_id }) => {
      try {
        const doc = await client.getDoc(doc_id);
        return textResult({ type: "docs_doc", action: "get", doc });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── 资源 ──

  server.resource(
    "docs-index",
    "mofox://docs",
    async (uri) => {
      const { total, docs } = await client.getLlms();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ total, docs }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "docs-doc",
    new ResourceTemplate("mofox://docs/{+id}", {
      list: async () => {
        const { docs } = await client.getLlms();
        return {
          resources: docs.map((d) => ({
            uri: `mofox://docs/${d.id}`,
            name: d.title || d.id,
            description: d.description,
          })),
        };
      },
    }),
    async (uri, { id }) => {
      try {
        const doc = await client.getDoc(id as string);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(doc, null, 2),
            },
          ],
        };
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mofox-docs-mcp v${PACKAGE_VERSION} 已启动，文档源: ${opts.baseUrl}`);
}

main().catch((err) => {
  console.error("mofox-docs-mcp 启动失败:", err);
  process.exit(1);
});