import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAllTimeRefreshScheduler } from "./allTimeRefreshScheduler.js";
import { ApeBondClient } from "./apeBondClient.js";
import { BuildingError, DashboardService } from "./dashboardService.js";
import { parseScope, parseWhaleQuery } from "./query.js";

export function createServer(service = new DashboardService(new ApeBondClient())) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      progress: service.getProgress()
    });
  });

  app.get("/api/whales", async (request, response, next) => {
    try {
      const query = parseWhaleQuery(request.query);
      const result = await service.getWhales(query, false);
      response.status(result.status === "building" ? 202 : 200).json(result);
    } catch (error) {
      if (error instanceof BuildingError) {
        response.status(202).json({
          status: "building",
          scope: request.query.scope ?? "all",
          rows: [],
          totalRows: 0,
          summary: null,
          progress: error.progress,
          warnings: []
        });
        return;
      }
      next(error);
    }
  });

  app.get("/api/summary", async (request, response, next) => {
    try {
      const query = parseWhaleQuery({ ...request.query, limit: 1, offset: 0 });
      const summary = await service.getSummary(query.scope, query);
      response.json({
        status: "ready",
        summary,
        progress: query.scope === "all" ? service.getProgress() : undefined
      });
    } catch (error) {
      if (error instanceof BuildingError) {
        response.status(202).json({
          status: "building",
          scope: parseScope(request.query.scope),
          summary: null,
          progress: error.progress
        });
        return;
      }
      next(error);
    }
  });

  app.get("/api/acquisition/monthly", async (_request, response, next) => {
    try {
      response.json(await service.getMonthlyAcquisition());
    } catch (error) {
      if (error instanceof BuildingError) {
        response.status(202).json({
          status: "building",
          rows: [],
          summary: null,
          progress: error.progress,
          warnings: []
        });
        return;
      }
      next(error);
    }
  });

  app.get("/api/wallet/:address", async (request, response, next) => {
    try {
      response.json(await service.getWalletDetail(request.params.address));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/partners", async (_request, response, next) => {
    try {
      response.json(await service.getPartners());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/partner/:chainId/:token", async (request, response, next) => {
    try {
      response.json(await service.getPartnerDetail(request.params.chainId, decodeURIComponent(request.params.token)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/bond/:address", async (request, response, next) => {
    try {
      response.json(await service.getBondDetail(request.params.address));
    } catch (error) {
      next(error);
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = resolveDistPath();
    if (distPath) {
      app.use(express.static(distPath));
      app.get("*", (request, response, next) => {
        if (request.path.startsWith("/api/")) {
          next();
          return;
        }
        response.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error(error);
    const status = message.startsWith("Invalid") ? 400 : 500;
    response.status(status).json({ error: message });
  });

  return app;
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntry) {
  const port = Number(process.env.PORT) || (process.env.NODE_ENV === "production" ? 3000 : 8787);
  const service = new DashboardService(new ApeBondClient());
  startAllTimeRefreshScheduler(service);
  createServer(service).listen(port, () => {
    console.log(`ApeBond Wallet Dashboard listening on http://localhost:${port}`);
  });
}

function resolveDistPath(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const candidates = [
    path.resolve(process.cwd(), "dist"),
    path.resolve(currentDir, "..", "dist")
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}
