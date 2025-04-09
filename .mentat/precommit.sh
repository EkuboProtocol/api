#!/bin/bash
# Format code with Prettier
npx prettier --write .

# Check TypeScript types
npm run check-ts
