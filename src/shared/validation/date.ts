import { z } from "zod";

export const DateType = z
  .string({
    description: "An ISO date",
  })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format");
