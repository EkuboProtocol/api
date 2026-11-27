import { bindings, defineConfig } from "cf/config";

export default defineConfig((ctx) => {
  switch (ctx.mode) {
    case "prod": {
      return {
        worker: {
          name: "ekubo-api-prod",
          compatibilityDate: "2024-09-23",
          compatibilityFlags: ["nodejs_compat"],
          entrypoint: "src/index.ts",
          placement: {
            region: "aws:us-east-1",
          },
          limits: {
            cpuMs: 5000,
          },
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          domains: ["prod-api.ekubo.org"],
          env: {
            HYPERDRIVE: bindings.hyperdrive({
              id: "c6bd83f26cc840e3aa09870557f286f4",
            }),
          },
        },
      };
    }
    default: {
      return {
        worker: {
          name: "ekubo-api",
          compatibilityDate: "2024-09-23",
          compatibilityFlags: ["nodejs_compat"],
          entrypoint: "src/index.ts",
          placement: {
            region: "aws:us-east-1",
          },
          limits: {
            cpuMs: 5000,
          },
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            PG_CONNECTION_STRING: bindings.text(
              "postgresql://postgres:postgres@localhost:5432/postgres",
            ),
          },
        },
      };
    }
  }
});
