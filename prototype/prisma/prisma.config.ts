import { defineConfig } from "@prisma/internals";

export default defineConfig({
  datasources: {
    db: {
      url: `file:${process.cwd()}/prisma/dev.db`,
    },
  },
});
